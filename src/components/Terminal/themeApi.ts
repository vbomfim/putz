/**
 * IPC wrappers for theme management commands.
 *
 * Each function wraps a Tauri `invoke()` call to the Rust backend.
 * Keep in sync with src-tauri/src/ipc/theme.rs.
 *
 * @module themeApi
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Theme,
  CreateThemeInput,
  UpdateThemeInput,
  ThemeExport,
} from "./themeTypes";

/** Lists all themes (built-in + custom). */
export async function themeList(): Promise<Theme[]> {
  return invoke<Theme[]>("theme_list");
}

/** Gets a single theme by ID. */
export async function themeGet(id: string): Promise<Theme> {
  return invoke<Theme>("theme_get", { id });
}

/** Creates a new custom theme. Returns the generated UUID. */
export async function themeCreate(input: CreateThemeInput): Promise<string> {
  return invoke<string>("theme_create", { input });
}

/** Updates an existing custom theme with partial fields. */
export async function themeUpdate(
  id: string,
  input: UpdateThemeInput,
): Promise<void> {
  return invoke<void>("theme_update", { id, input });
}

/** Deletes a custom theme by ID. */
export async function themeDelete(id: string): Promise<void> {
  return invoke<void>("theme_delete", { id });
}

/** Imports a theme from a ThemeExport JSON payload. */
export async function themeImport(data: ThemeExport): Promise<string> {
  return invoke<string>("theme_import", { data });
}

/** Exports a theme as a ThemeExport JSON payload. */
export async function themeExport(id: string): Promise<ThemeExport> {
  return invoke<ThemeExport>("theme_export", { id });
}
