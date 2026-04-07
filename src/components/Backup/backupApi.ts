/**
 * Backup API — wraps Tauri IPC invoke calls for config backup.
 *
 * Maps to the Rust save_backup command in ipc/nettools.rs.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SaveBackupRequest, SaveBackupResponse } from "./types";

/** Saves captured command output as a backup file. */
export async function saveBackup(
  request: SaveBackupRequest,
): Promise<SaveBackupResponse> {
  return invoke<SaveBackupResponse>("save_backup", { request });
}
