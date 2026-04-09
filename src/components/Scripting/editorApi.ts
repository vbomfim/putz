/**
 * File I/O API for the editor tab.
 *
 * Wraps Tauri IPC commands for reading and writing files,
 * and detecting file language from extension.
 *
 * @module editorApi
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditorLanguage } from "./MonacoEditor";

/** Read a file's content by absolute path. */
export async function fileRead(path: string): Promise<string> {
  return invoke<string>("file_read", { path });
}

/** Write content to a file by absolute path. */
export async function fileWrite(path: string, content: string): Promise<void> {
  return invoke("file_write", { path, content });
}

/** Detect editor language from file extension. */
export function detectLanguage(filePath: string): EditorLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ios":
    case "cfg":
    case "conf":
    case "config":
    case "acl":
      return "cisco-ios";
    default:
      return "javascript";
  }
}
