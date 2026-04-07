/**
 * Compliance API — wraps Tauri IPC invoke calls for change window operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/compliance.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ChangeWindow,
  ChangeWindowCheckResult,
  SetChangeWindowInput,
} from "./types";

/** Checks whether a command is allowed under the current change window policy. */
export async function changeWindowCheck(
  command: string,
): Promise<ChangeWindowCheckResult> {
  return invoke<ChangeWindowCheckResult>("change_window_check", { command });
}

/** Lists all defined change windows. */
export async function changeWindowList(): Promise<ChangeWindow[]> {
  return invoke<ChangeWindow[]>("change_window_list");
}

/** Creates or updates a change window. Returns the window ID. */
export async function changeWindowSet(
  input: SetChangeWindowInput,
): Promise<string> {
  return invoke<string>("change_window_set", { input });
}

/** Deletes a change window by ID. */
export async function changeWindowDelete(id: string): Promise<void> {
  return invoke<void>("change_window_delete", { id });
}

/** Returns whether any change window is currently active. */
export async function changeWindowActive(): Promise<boolean> {
  return invoke<boolean>("change_window_active");
}
