/// IPC command handlers for the scripting engine.
///
/// Exposes script CRUD, execution, and recording as Tauri commands.
/// Script runs are asynchronous — `script_run` returns a run ID
/// immediately and the script executes in the background.
use tauri::{AppHandle, Manager, State};

use crate::pty::PtyManager;
use crate::scripting::engine::ScriptCommand;
use crate::scripting::models::*;
use crate::scripting::ScriptManager;

/// Lists all saved scripts (metadata only).
#[tauri::command]
pub fn script_list(state: State<'_, ScriptManager>) -> Vec<ScriptMeta> {
    state.list()
}

/// Gets a script's metadata and content by ID.
#[tauri::command]
pub fn script_get(
    state: State<'_, ScriptManager>,
    id: String,
) -> Result<ScriptWithContent, String> {
    state.get(&id).map_err(|e| e.to_string())
}

/// Saves a script (create or update). Returns the script ID.
#[tauri::command]
pub fn script_save(
    state: State<'_, ScriptManager>,
    input: SaveScriptInput,
) -> Result<String, String> {
    state.save(input).map_err(|e| e.to_string())
}

/// Deletes a script by ID.
#[tauri::command]
pub fn script_delete(state: State<'_, ScriptManager>, id: String) -> Result<(), String> {
    state.delete(&id).map_err(|e| e.to_string())
}

/// Runs a script against a session. Returns the run ID.
///
/// The script executes asynchronously. Use `script_status` to check progress.
/// Uses `AppHandle` to access managed state inside the command handler closure,
/// since Tauri `State<'_>` references can't be moved into 'static closures.
#[tauri::command]
pub async fn script_run(
    app: AppHandle,
    state: State<'_, ScriptManager>,
    input: RunScriptInput,
) -> Result<String, String> {
    let session_id = input.session_id.clone();
    let app_for_handler = app.clone();

    // Build the command handler that routes script commands to managers.
    // Uses AppHandle to access managed state (PtyManager).
    // Connection and Vault features have been removed (epic #86).
    let handler = move |cmd: ScriptCommand| {
        let app = app_for_handler.clone();
        let session_id = session_id.clone();

        Box::pin(async move {
            match cmd {
                ScriptCommand::Send {
                    session_id,
                    data,
                    result_tx,
                } => {
                    let data_bytes = format!("{data}\r\n").into_bytes();
                    let pty = app.state::<PtyManager>();
                    match pty.write(&session_id, &data_bytes) {
                        Ok(()) => {
                            let _ = result_tx.send(Ok(()));
                        }
                        Err(e) => {
                            let _ = result_tx.send(Err(format!(
                                "Failed to send to session {}: {}",
                                session_id, e
                            )));
                        }
                    }
                }
                ScriptCommand::Disconnect {
                    session_id,
                    result_tx,
                } => {
                    let pty = app.state::<PtyManager>();
                    match pty.close(&session_id) {
                        Ok(()) => {
                            let _ = result_tx.send(Ok(()));
                        }
                        Err(e) => {
                            let _ = result_tx.send(Err(format!("Failed to disconnect: {e}")));
                        }
                    }
                }
                ScriptCommand::Log { entry } => {
                    let _ =
                        tauri::Emitter::emit(&app, &format!("script-log-{}", session_id), &entry);
                }
            }
        }) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
    };

    state
        .run(input, handler, app.clone())
        .await
        .map_err(|e| e.to_string())
}

/// Runs a script across multiple sessions in parallel.
/// Returns a list of run IDs.
#[tauri::command]
pub async fn script_run_multi(
    app: AppHandle,
    state: State<'_, ScriptManager>,
    input: RunMultiInput,
) -> Result<Vec<String>, String> {
    let mut run_ids = Vec::new();

    for session_id in &input.session_ids {
        let single_input = RunScriptInput {
            script_id: input.script_id.clone(),
            session_id: session_id.clone(),
        };

        let app_clone = app.clone();
        let session_id_for_handler = session_id.clone();
        let app_for_handler = app.clone();

        let handler = move |cmd: ScriptCommand| {
            let app = app_for_handler.clone();
            let session_id = session_id_for_handler.clone();

            Box::pin(async move {
                match cmd {
                    ScriptCommand::Send {
                        session_id,
                        data,
                        result_tx,
                    } => {
                        let data_bytes = format!("{data}\r\n").into_bytes();
                        let pty = app.state::<PtyManager>();
                        match pty.write(&session_id, &data_bytes) {
                            Ok(()) => {
                                let _ = result_tx.send(Ok(()));
                            }
                            Err(e) => {
                                let _ = result_tx.send(Err(e.to_string()));
                            }
                        }
                    }
                    ScriptCommand::Disconnect {
                        session_id,
                        result_tx,
                    } => {
                        let pty = app.state::<PtyManager>();
                        match pty.close(&session_id) {
                            Ok(()) => {
                                let _ = result_tx.send(Ok(()));
                            }
                            Err(e) => {
                                let _ = result_tx.send(Err(format!("Failed to disconnect: {e}")));
                            }
                        }
                    }
                    ScriptCommand::Log { entry } => {
                        let _ = tauri::Emitter::emit(
                            &app,
                            &format!("script-log-{}", session_id),
                            &entry,
                        );
                    }
                }
            }) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
        };

        let run_id = state
            .run(single_input, handler, app_clone)
            .await
            .map_err(|e| format!("Failed to start script for session {session_id}: {e}"))?;
        run_ids.push(run_id);
    }

    Ok(run_ids)
}

/// Gets the status of a running/completed script.
#[tauri::command]
pub async fn script_status(
    state: State<'_, ScriptManager>,
    run_id: String,
) -> Result<ScriptRunResult, String> {
    state
        .get_run_status(&run_id)
        .await
        .map_err(|e| e.to_string())
}

/// Stops a running script.
#[tauri::command]
pub async fn script_stop(state: State<'_, ScriptManager>, run_id: String) -> Result<(), String> {
    state.stop(&run_id).await.map_err(|e| e.to_string())
}

/// Starts recording keystrokes for a session.
#[tauri::command]
pub fn script_record_start(
    state: State<'_, ScriptManager>,
    session_id: String,
) -> Result<(), String> {
    state.record_start(&session_id).map_err(|e| e.to_string())
}

/// Stops recording and returns the generated script content.
#[tauri::command]
pub fn script_record_stop(
    state: State<'_, ScriptManager>,
    session_id: String,
) -> Result<String, String> {
    state.record_stop(&session_id).map_err(|e| e.to_string())
}
