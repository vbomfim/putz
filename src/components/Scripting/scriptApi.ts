/**
 * Script API — wraps Tauri IPC invoke calls for scripting operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/scripting.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ScriptMeta,
  ScriptWithContent,
  ScriptRunResult,
  SaveScriptInput,
  RunScriptInput,
  RunMultiInput,
} from "./types";

/** Lists all saved scripts (metadata only). */
export async function scriptList(): Promise<ScriptMeta[]> {
  return invoke<ScriptMeta[]>("script_list");
}

/** Gets a script's metadata and content by ID. */
export async function scriptGet(id: string): Promise<ScriptWithContent> {
  return invoke<ScriptWithContent>("script_get", { id });
}

/** Saves a script (create or update). Returns the script ID. */
export async function scriptSave(input: SaveScriptInput): Promise<string> {
  return invoke<string>("script_save", { input });
}

/** Deletes a script by ID. */
export async function scriptDelete(id: string): Promise<void> {
  return invoke<void>("script_delete", { id });
}

/** Runs a script against a session. Returns the run ID. */
export async function scriptRun(input: RunScriptInput): Promise<string> {
  return invoke<string>("script_run", { input });
}

/** Runs a script across multiple sessions. Returns a list of run IDs. */
export async function scriptRunMulti(input: RunMultiInput): Promise<string[]> {
  return invoke<string[]>("script_run_multi", { input });
}

/** Gets the status of a running/completed script. */
export async function scriptStatus(runId: string): Promise<ScriptRunResult> {
  return invoke<ScriptRunResult>("script_status", { runId });
}

/** Stops a running script. */
export async function scriptStop(runId: string): Promise<void> {
  return invoke<void>("script_stop", { runId });
}

/** Starts recording keystrokes for a session. */
export async function scriptRecordStart(sessionId: string): Promise<void> {
  return invoke<void>("script_record_start", { sessionId });
}

/** Stops recording and returns the generated script content. */
export async function scriptRecordStop(sessionId: string): Promise<string> {
  return invoke<string>("script_record_stop", { sessionId });
}
