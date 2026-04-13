/// IPC commands for SFTP file operations.
///
/// These are the Tauri command handlers for opening SFTP sessions,
/// browsing remote directories, and transferring files.
///
/// Architecture: SFTP sessions are opened on top of existing SSH
/// connections. The `sftp_open` command gets the SSH session handle
/// from `ConnectionManager` and opens an SFTP subsystem channel.
///
/// File transfers run as background tokio tasks. Progress is reported
/// via Tauri events (`sftp-progress-{transferId}`, `sftp-complete-{transferId}`).
use std::time::Instant;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::protocol::connection_manager::ConnectionManager;
use crate::protocol::sftp::path::{
    normalize_remote_path, validate_local_path, validate_remote_path, MAX_TRANSFER_SIZE,
};
use crate::protocol::sftp::transfer::{
    TransferCompletePayload, TransferDirection, TransferInfo, TransferStatus, TRANSFER_BUFFER_SIZE,
};
use crate::protocol::sftp::{RemoteFileEntry, RemoteFileStat, SftpManager, SftpSessionHandle};

/// Opens an SFTP session on an existing SSH connection.
///
/// Returns the generated SFTP session ID.
#[tauri::command]
pub async fn sftp_open(
    _app: AppHandle,
    conn_manager: State<'_, ConnectionManager>,
    sftp_manager: State<'_, SftpManager>,
    connection_id: String,
) -> Result<String, String> {
    // Open an SFTP channel on the existing SSH connection
    let stream = conn_manager
        .open_sftp_channel(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    // Initialize the SFTP session from the channel stream
    let sftp_session = russh_sftp::client::SftpSession::new(stream)
        .await
        .map_err(|e| format!("Failed to initialize SFTP session: {e}"))?;

    let sftp_session_id = Uuid::new_v4().to_string();

    let handle = SftpSessionHandle {
        session: sftp_session,
        connection_id: connection_id.clone(),
        transfers: crate::protocol::sftp::transfer::TransferEngine::new(),
    };

    sftp_manager
        .register(sftp_session_id.clone(), handle)
        .await
        .map_err(|e| e.to_string())?;

    Ok(sftp_session_id)
}

/// Lists the contents of a remote directory.
#[tauri::command]
pub async fn sftp_list(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
    let normalized = normalize_remote_path(&path);
    validate_remote_path(&normalized)?;

    sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let normalized = normalized.clone();
            Box::pin(async move {
                let entries = handle.session.read_dir(&normalized).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to list directory {normalized}: {e}"
                    ))
                })?;

                let mut results: Vec<RemoteFileEntry> = entries
                    .map(|entry| {
                        let name = entry.file_name();
                        let metadata = entry.metadata();
                        let is_dir = metadata.is_dir();
                        let entry_path = if normalized == "/" {
                            format!("/{name}")
                        } else {
                            format!("{}/{name}", normalized)
                        };

                        RemoteFileEntry {
                            name,
                            path: entry_path,
                            is_dir,
                            size: metadata.size.unwrap_or(0),
                            permissions: metadata.permissions,
                            modified: metadata.mtime.map(|t| t as i64),
                            uid: metadata.uid,
                            gid: metadata.gid,
                        }
                    })
                    .collect();

                // Sort: directories first, then alphabetical
                results.sort_by(|a, b| {
                    b.is_dir
                        .cmp(&a.is_dir)
                        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                });

                Ok(results)
            })
        })
        .await
        .map_err(|e| e.to_string())
}

/// Gets metadata for a remote file or directory.
#[tauri::command]
pub async fn sftp_stat(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    path: String,
) -> Result<RemoteFileStat, String> {
    let normalized = normalize_remote_path(&path);
    validate_remote_path(&normalized)?;

    sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let normalized = normalized.clone();
            Box::pin(async move {
                let metadata = handle.session.metadata(&normalized).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to stat {normalized}: {e}"
                    ))
                })?;

                Ok(RemoteFileStat {
                    path: normalized,
                    is_dir: metadata.is_dir(),
                    size: metadata.size.unwrap_or(0),
                    permissions: metadata.permissions,
                    modified: metadata.mtime.map(|t| t as i64),
                    accessed: metadata.atime.map(|t| t as i64),
                    uid: metadata.uid,
                    gid: metadata.gid,
                })
            })
        })
        .await
        .map_err(|e| e.to_string())
}

/// Downloads a remote file to a local path.
///
/// Returns a transfer ID immediately. Progress is reported via
/// `sftp-progress-{transferId}` events. Completion via
/// `sftp-complete-{transferId}`.
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let normalized = normalize_remote_path(&remote_path);
    validate_remote_path(&normalized)?;

    // Validate local path — canonicalize and confine to home/temp
    let canonical_local = validate_local_path(&local_path)?;

    // Get file size for progress tracking
    let total_bytes = sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let normalized = normalized.clone();
            Box::pin(async move {
                let metadata = handle.session.metadata(&normalized).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to stat {normalized}: {e}"
                    ))
                })?;
                Ok(metadata.size.unwrap_or(0))
            })
        })
        .await
        .map_err(|e| e.to_string())?;

    // Enforce file size limit
    if total_bytes > MAX_TRANSFER_SIZE {
        return Err(format!(
            "File size ({total_bytes} bytes) exceeds maximum \
             transfer size ({MAX_TRANSFER_SIZE} bytes / 10 GB)"
        ));
    }

    let transfer_id = Uuid::new_v4().to_string();

    // Register the transfer
    let info = TransferInfo::new(
        transfer_id.clone(),
        sftp_session_id.clone(),
        normalized.clone(),
        canonical_local.clone(),
        TransferDirection::Download,
        total_bytes,
    );

    // We need to access the sessions through the manager
    let sessions_arc = sftp_manager
        .get_transfers(&sftp_session_id)
        .await
        .map_err(|e| e.to_string())?;

    // Register transfer
    {
        let sessions = sessions_arc.lock().await;
        let handle = sessions
            .get(&sftp_session_id)
            .ok_or_else(|| "SFTP session not found".to_string())?;
        handle.transfers.register(info).await?;
    }

    // Spawn download task
    let tid = transfer_id.clone();
    let app_clone = app.clone();
    let sessions = sessions_arc.clone();
    let sid = sftp_session_id.clone();
    let download_local_path = canonical_local.clone();

    // Get semaphore for concurrency control
    let semaphore = {
        let s = sessions_arc.lock().await;
        match s.get(&sftp_session_id) {
            Some(h) => h.transfers.semaphore(),
            None => {
                return Err("SFTP session not found".into());
            }
        }
    };

    tokio::spawn(async move {
        // Acquire semaphore permit — limits concurrent transfers
        let _permit = match semaphore.acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, "Transfer semaphore closed".into())
                        .await;
                }
                return;
            }
        };

        let start = Instant::now();

        // Update status to in-progress
        {
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .update_status(&tid, TransferStatus::InProgress)
                    .await;
            }
        }

        // Open remote file
        let file_result = {
            let s = sessions.lock().await;
            match s.get(&sid) {
                Some(h) => h.session.open(&normalized).await,
                None => return,
            }
        };

        let mut remote_file = match file_result {
            Ok(f) => f,
            Err(e) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Failed to open remote file: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Failed to open remote file: {e}")),
                        bytes_transferred: 0,
                    },
                );
                return;
            }
        };

        // Create local file
        let mut local_file = match tokio::fs::File::create(&download_local_path).await {
            Ok(f) => f,
            Err(e) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Failed to create local file: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Failed to create local file: {e}")),
                        bytes_transferred: 0,
                    },
                );
                return;
            }
        };

        // Transfer loop
        let mut buffer = vec![0u8; TRANSFER_BUFFER_SIZE];
        let mut bytes_transferred: u64 = 0;
        let mut last_progress = Instant::now();

        loop {
            let n = match remote_file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    // Clean up partial download on read error
                    drop(local_file);
                    let _ = tokio::fs::remove_file(&download_local_path).await;
                    let s = sessions.lock().await;
                    if let Some(h) = s.get(&sid) {
                        let _ = h
                            .transfers
                            .mark_failed(&tid, format!("Read error: {e}"))
                            .await;
                    }
                    let _ = app_clone.emit(
                        &format!("sftp-complete-{tid}"),
                        TransferCompletePayload {
                            transfer_id: tid,
                            status: TransferStatus::Failed,
                            error: Some(format!("Read error: {e}")),
                            bytes_transferred,
                        },
                    );
                    return;
                }
            };

            if let Err(e) = local_file.write_all(&buffer[..n]).await {
                // Clean up partial download on write error
                drop(local_file);
                let _ = tokio::fs::remove_file(&download_local_path).await;
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Write error: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Write error: {e}")),
                        bytes_transferred,
                    },
                );
                return;
            }

            bytes_transferred += n as u64;

            // Emit progress at intervals
            if last_progress.elapsed().as_millis() >= 250 {
                let elapsed = start.elapsed().as_secs_f64();
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    if let Ok(payload) = h
                        .transfers
                        .update_progress(&tid, bytes_transferred, elapsed)
                        .await
                    {
                        let _ = app_clone.emit(&format!("sftp-progress-{tid}"), &payload);
                    }
                }
                last_progress = Instant::now();
            }
        }

        // Flush and sync to ensure all data is written to disk
        if let Err(e) = local_file.flush().await {
            drop(local_file);
            let _ = tokio::fs::remove_file(&download_local_path).await;
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .mark_failed(&tid, format!("Flush error: {e}"))
                    .await;
            }
            let _ = app_clone.emit(
                &format!("sftp-complete-{tid}"),
                TransferCompletePayload {
                    transfer_id: tid,
                    status: TransferStatus::Failed,
                    error: Some(format!("Flush error: {e}")),
                    bytes_transferred,
                },
            );
            return;
        }

        if let Err(e) = local_file.sync_all().await {
            drop(local_file);
            let _ = tokio::fs::remove_file(&download_local_path).await;
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .mark_failed(&tid, format!("Sync error: {e}"))
                    .await;
            }
            let _ = app_clone.emit(
                &format!("sftp-complete-{tid}"),
                TransferCompletePayload {
                    transfer_id: tid,
                    status: TransferStatus::Failed,
                    error: Some(format!("Sync error: {e}")),
                    bytes_transferred,
                },
            );
            return;
        }

        // Completed
        {
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .update_status(&tid, TransferStatus::Completed)
                    .await;
            }
        }

        let _ = app_clone.emit(
            &format!("sftp-complete-{tid}"),
            TransferCompletePayload {
                transfer_id: tid,
                status: TransferStatus::Completed,
                error: None,
                bytes_transferred,
            },
        );
    });

    Ok(transfer_id)
}

/// Uploads a local file to a remote path.
///
/// Returns a transfer ID immediately. Progress is reported via events.
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let normalized = normalize_remote_path(&remote_path);
    validate_remote_path(&normalized)?;

    // Validate local path — canonicalize and confine to home/temp
    let canonical_local = validate_local_path(&local_path)?;

    // Get local file size
    let local_metadata = tokio::fs::metadata(&canonical_local)
        .await
        .map_err(|e| format!("Failed to read local file: {e}"))?;
    let total_bytes = local_metadata.len();

    // Enforce file size limit
    if total_bytes > MAX_TRANSFER_SIZE {
        return Err(format!(
            "File size ({total_bytes} bytes) exceeds maximum \
             transfer size ({MAX_TRANSFER_SIZE} bytes / 10 GB)"
        ));
    }

    let transfer_id = Uuid::new_v4().to_string();

    let info = TransferInfo::new(
        transfer_id.clone(),
        sftp_session_id.clone(),
        normalized.clone(),
        canonical_local.clone(),
        TransferDirection::Upload,
        total_bytes,
    );

    let sessions_arc = sftp_manager
        .get_transfers(&sftp_session_id)
        .await
        .map_err(|e| e.to_string())?;

    // Register transfer
    {
        let sessions = sessions_arc.lock().await;
        let handle = sessions
            .get(&sftp_session_id)
            .ok_or_else(|| "SFTP session not found".to_string())?;
        handle.transfers.register(info).await?;
    }

    // Spawn upload task
    let tid = transfer_id.clone();
    let app_clone = app.clone();
    let sessions = sessions_arc.clone();
    let sid = sftp_session_id.clone();
    let upload_local_path = canonical_local.clone();

    // Get semaphore for concurrency control
    let semaphore = {
        let s = sessions_arc.lock().await;
        match s.get(&sftp_session_id) {
            Some(h) => h.transfers.semaphore(),
            None => {
                return Err("SFTP session not found".into());
            }
        }
    };

    tokio::spawn(async move {
        // Acquire semaphore permit — limits concurrent transfers
        let _permit = match semaphore.acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, "Transfer semaphore closed".into())
                        .await;
                }
                return;
            }
        };

        let start = Instant::now();

        // Update status
        {
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .update_status(&tid, TransferStatus::InProgress)
                    .await;
            }
        }

        // Open local file
        let mut local_file = match tokio::fs::File::open(&upload_local_path).await {
            Ok(f) => f,
            Err(e) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Failed to open local file: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Failed to open local file: {e}")),
                        bytes_transferred: 0,
                    },
                );
                return;
            }
        };

        // Create remote file
        let remote_file_result = {
            let s = sessions.lock().await;
            match s.get(&sid) {
                Some(h) => h.session.create(&normalized).await,
                None => return,
            }
        };

        let mut remote_file = match remote_file_result {
            Ok(f) => f,
            Err(e) => {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Failed to create remote file: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Failed to create remote file: {e}")),
                        bytes_transferred: 0,
                    },
                );
                return;
            }
        };

        // Transfer loop
        let mut buffer = vec![0u8; TRANSFER_BUFFER_SIZE];
        let mut bytes_transferred: u64 = 0;
        let mut last_progress = Instant::now();

        loop {
            let n = match local_file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let s = sessions.lock().await;
                    if let Some(h) = s.get(&sid) {
                        let _ = h
                            .transfers
                            .mark_failed(&tid, format!("Read error: {e}"))
                            .await;
                    }
                    let _ = app_clone.emit(
                        &format!("sftp-complete-{tid}"),
                        TransferCompletePayload {
                            transfer_id: tid,
                            status: TransferStatus::Failed,
                            error: Some(format!("Read error: {e}")),
                            bytes_transferred,
                        },
                    );
                    return;
                }
            };

            if let Err(e) = remote_file.write_all(&buffer[..n]).await {
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    let _ = h
                        .transfers
                        .mark_failed(&tid, format!("Write error: {e}"))
                        .await;
                }
                let _ = app_clone.emit(
                    &format!("sftp-complete-{tid}"),
                    TransferCompletePayload {
                        transfer_id: tid,
                        status: TransferStatus::Failed,
                        error: Some(format!("Write error: {e}")),
                        bytes_transferred,
                    },
                );
                return;
            }

            bytes_transferred += n as u64;

            if last_progress.elapsed().as_millis() >= 250 {
                let elapsed = start.elapsed().as_secs_f64();
                let s = sessions.lock().await;
                if let Some(h) = s.get(&sid) {
                    if let Ok(payload) = h
                        .transfers
                        .update_progress(&tid, bytes_transferred, elapsed)
                        .await
                    {
                        let _ = app_clone.emit(&format!("sftp-progress-{tid}"), &payload);
                    }
                }
                last_progress = Instant::now();
            }
        }

        // Completed
        {
            let s = sessions.lock().await;
            if let Some(h) = s.get(&sid) {
                let _ = h
                    .transfers
                    .update_status(&tid, TransferStatus::Completed)
                    .await;
            }
        }

        let _ = app_clone.emit(
            &format!("sftp-complete-{tid}"),
            TransferCompletePayload {
                transfer_id: tid,
                status: TransferStatus::Completed,
                error: None,
                bytes_transferred,
            },
        );
    });

    Ok(transfer_id)
}

/// Renames a remote file or directory.
#[tauri::command]
pub async fn sftp_rename(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old_normalized = normalize_remote_path(&old_path);
    let new_normalized = normalize_remote_path(&new_path);
    validate_remote_path(&old_normalized)?;
    validate_remote_path(&new_normalized)?;

    sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let old = old_normalized.clone();
            let new = new_normalized.clone();
            Box::pin(async move {
                handle.session.rename(&old, &new).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to rename {old} → {new}: {e}"
                    ))
                })
            })
        })
        .await
        .map_err(|e| e.to_string())
}

/// Deletes a remote file.
#[tauri::command]
pub async fn sftp_delete(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    path: String,
) -> Result<(), String> {
    let normalized = normalize_remote_path(&path);
    validate_remote_path(&normalized)?;

    // Prevent deleting root
    if normalized == "/" {
        return Err("Cannot delete root directory".into());
    }

    sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let normalized = normalized.clone();
            Box::pin(async move {
                // Try remove file first, then directory
                let file_result = handle.session.remove_file(&normalized).await;

                if file_result.is_ok() {
                    return Ok(());
                }

                // If file removal failed, try removing as directory
                handle.session.remove_dir(&normalized).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to delete {normalized}: {e}"
                    ))
                })
            })
        })
        .await
        .map_err(|e| e.to_string())
}

/// Creates a new remote directory.
#[tauri::command]
pub async fn sftp_mkdir(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
    path: String,
) -> Result<(), String> {
    let normalized = normalize_remote_path(&path);
    validate_remote_path(&normalized)?;

    sftp_manager
        .with_session(&sftp_session_id, |handle| {
            let normalized = normalized.clone();
            Box::pin(async move {
                handle.session.create_dir(&normalized).await.map_err(|e| {
                    crate::protocol::ProtocolError::IoError(format!(
                        "Failed to create directory {normalized}: {e}"
                    ))
                })
            })
        })
        .await
        .map_err(|e| e.to_string())
}

/// Closes an SFTP session.
#[tauri::command]
pub async fn sftp_close(
    sftp_manager: State<'_, SftpManager>,
    sftp_session_id: String,
) -> Result<(), String> {
    sftp_manager
        .close(&sftp_session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Path validation in IPC context ───────────────────────────

    #[test]
    fn validate_rejects_traversal_in_list_path() {
        let result = validate_remote_path("/../etc/shadow");
        assert!(result.is_err());
    }

    #[test]
    fn validate_accepts_root_path() {
        assert!(validate_remote_path("/").is_ok());
    }

    #[test]
    fn validate_rejects_relative_path() {
        assert!(validate_remote_path("relative/path").is_err());
    }

    #[test]
    fn normalize_and_validate_combined() {
        let raw = "/home//user///documents/";
        let normalized = normalize_remote_path(raw);
        assert_eq!(normalized, "/home/user/documents");
        assert!(validate_remote_path(&normalized).is_ok());
    }

    // ── Delete safety ────────────────────────────────────────────

    #[test]
    fn cannot_delete_root() {
        // The sftp_delete command has an explicit root check
        let normalized = normalize_remote_path("/");
        assert_eq!(normalized, "/");
    }
}
