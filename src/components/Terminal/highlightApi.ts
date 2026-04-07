/**
 * Highlight API — wraps Tauri IPC invoke calls for highlight operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/highlight.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  HighlightSet,
  CreateHighlightSetInput,
  UpdateHighlightSetInput,
} from "./highlightTypes";

/** Lists all highlight sets (including built-in presets). */
export async function highlightListSets(): Promise<HighlightSet[]> {
  return invoke<HighlightSet[]>("highlight_list_sets");
}

/** Gets a single highlight set by ID. */
export async function highlightGetSet(id: string): Promise<HighlightSet> {
  return invoke<HighlightSet>("highlight_get_set", { id });
}

/**
 * Creates a new highlight set.
 * Returns the generated UUID.
 */
export async function highlightCreateSet(
  input: CreateHighlightSetInput,
): Promise<string> {
  return invoke<string>("highlight_create_set", { input });
}

/** Updates an existing highlight set with partial fields. */
export async function highlightUpdateSet(
  id: string,
  input: UpdateHighlightSetInput,
): Promise<void> {
  return invoke<void>("highlight_update_set", { id, input });
}

/** Deletes a highlight set by ID. */
export async function highlightDeleteSet(id: string): Promise<void> {
  return invoke<void>("highlight_delete_set", { id });
}
