/**
 * History API — wraps Tauri IPC invoke calls for command history operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/history.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  CommandEntry,
  AddCommandInput,
  SearchHistoryInput,
  GetRecentInput,
} from "./types";

/** Adds a command to the history. Returns the row ID. */
export async function historyAdd(input: AddCommandInput): Promise<number> {
  return invoke<number>("history_add", { input });
}

/** Searches command history by substring match. */
export async function historySearch(
  input: SearchHistoryInput,
): Promise<CommandEntry[]> {
  return invoke<CommandEntry[]>("history_search", { input });
}

/** Gets the most recent commands for a specific session. */
export async function historyGetRecent(
  input: GetRecentInput,
): Promise<CommandEntry[]> {
  return invoke<CommandEntry[]>("history_get_recent", { input });
}

/** Clears all command history. */
export async function historyClear(): Promise<void> {
  return invoke<void>("history_clear");
}
