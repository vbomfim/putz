/**
 * Session manager API — wraps Tauri IPC invoke calls for session operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/session.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  SessionNode,
  SessionProfile,
  CreateSessionInput,
  UpdateSessionInput,
  MoveSessionInput,
} from "./types";

/** Lists all sessions and folders as a tree structure. */
export async function sessionList(): Promise<SessionNode[]> {
  return invoke<SessionNode[]>("session_list");
}

/** Gets a single session profile by ID. */
export async function sessionGet(id: string): Promise<SessionProfile> {
  return invoke<SessionProfile>("session_get", { id });
}

/** Creates a new session profile. Returns the generated UUID. */
export async function sessionCreate(
  input: CreateSessionInput,
): Promise<string> {
  return invoke<string>("session_create", { input });
}

/** Updates an existing session profile with partial fields. */
export async function sessionUpdate(
  id: string,
  input: UpdateSessionInput,
): Promise<void> {
  return invoke<void>("session_update", { id, input });
}

/** Deletes a session profile by ID. */
export async function sessionDelete(id: string): Promise<void> {
  return invoke<void>("session_delete", { id });
}

/** Moves a session to a different folder. */
export async function sessionMove(input: MoveSessionInput): Promise<void> {
  return invoke<void>("session_move", { input });
}

/** Duplicates a session with a new ID and "(copy)" suffix. */
export async function sessionDuplicate(id: string): Promise<string> {
  return invoke<string>("session_duplicate", { id });
}

/** Searches sessions by query string (name, host, username). */
export async function sessionSearch(query: string): Promise<SessionProfile[]> {
  return invoke<SessionProfile[]>("session_search", { query });
}

/** Exports the entire session store as a JSON string. */
export async function sessionExport(): Promise<string> {
  return invoke<string>("session_export");
}

/** Imports sessions from a JSON string. Returns count of imported sessions. */
export async function sessionImport(data: string): Promise<number> {
  return invoke<number>("session_import", { data });
}

/** Creates a new folder. Returns the generated UUID. */
export async function sessionCreateFolder(
  name: string,
  parentId: string,
): Promise<string> {
  return invoke<string>("session_create_folder", { name, parentId });
}

/** Deletes a folder by ID (must be empty). */
export async function sessionDeleteFolder(id: string): Promise<void> {
  return invoke<void>("session_delete_folder", { id });
}
