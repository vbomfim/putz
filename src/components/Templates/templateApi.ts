/**
 * Template API — wraps Tauri IPC invoke calls for template operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/templates.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  TemplateMeta,
  TemplateWithContent,
  SaveTemplateInput,
  ExecuteTemplateInput,
} from "./types";

/** Lists all saved templates (metadata only). */
export async function templateList(): Promise<TemplateMeta[]> {
  return invoke<TemplateMeta[]>("template_list");
}

/** Gets a template's metadata, content, and variables by ID. */
export async function templateGet(id: string): Promise<TemplateWithContent> {
  return invoke<TemplateWithContent>("template_get", { id });
}

/** Creates or updates a template. Returns the template ID. */
export async function templateCreate(input: SaveTemplateInput): Promise<string> {
  return invoke<string>("template_create", { input });
}

/** Deletes a template by ID (built-in templates cannot be deleted). */
export async function templateDelete(id: string): Promise<void> {
  return invoke<void>("template_delete", { id });
}

/** Executes a template by substituting variables. Returns the rendered text. */
export async function templateExecute(
  input: ExecuteTemplateInput,
): Promise<string> {
  return invoke<string>("template_execute", { input });
}
