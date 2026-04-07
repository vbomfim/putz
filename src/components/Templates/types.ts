/**
 * Type definitions for the Command Templates IPC layer.
 *
 * These types mirror the Rust backend's template types.
 * Keep in sync with src-tauri/src/templates/models.rs.
 *
 * @module templateTypes
 */

/** A variable placeholder extracted from a template. */
export interface TemplateVariable {
  /** Variable name (e.g., "hostname" from {{hostname}}). */
  name: string;
  /** Optional default value. */
  defaultValue: string;
}

/** Metadata for a saved command template. */
export interface TemplateMeta {
  /** Unique identifier (UUID v4). */
  id: string;
  /** User-facing display name. */
  name: string;
  /** Optional description of what the template does. */
  description: string;
  /** Whether this is a built-in template (cannot be deleted). */
  isBuiltin: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-modified timestamp. */
  updatedAt: string;
}

/** Full template data (metadata + content) returned by `template_get`. */
export interface TemplateWithContent {
  /** Template metadata. */
  meta: TemplateMeta;
  /** Template content with {{variable}} placeholders. */
  content: string;
  /** Extracted variables from the template content. */
  variables: TemplateVariable[];
}

/** IPC input for creating or updating a template. */
export interface SaveTemplateInput {
  /** Template ID for updates; undefined for new templates. */
  id?: string;
  /** User-facing display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Template content with {{variable}} placeholders. */
  content: string;
}

/** IPC input for executing a template. */
export interface ExecuteTemplateInput {
  /** ID of the template to execute. */
  templateId: string;
  /** Variable values to substitute (name → value map). */
  variables: Record<string, string>;
}

/** Maximum template content size in bytes. */
export const MAX_TEMPLATE_SIZE = 64_000;

/** Maximum template name length. */
export const MAX_TEMPLATE_NAME_LENGTH = 100;
