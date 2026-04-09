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
export function detectLanguage(filePath: string, content?: string): EditorLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ios":
    case "cfg":
    case "conf":
    case "config":
    case "acl":
      return "cisco-ios";
    case "js":
    case "ts":
    case "mjs":
      return "javascript";
    default:
      break;
  }

  // Content-based detection: check first 20 lines for Cisco IOS patterns
  if (content) {
    const head = content.slice(0, 2000);
    const iosPatterns = [
      /^!/m,
      /^hostname\s/m,
      /^interface\s/m,
      /^router\s/m,
      /^ip route\s/m,
      /^access-list\s/m,
      /^snmp-server\s/m,
      /^line\s+(con|vty|aux)\s/m,
      /show running-config/i,
      /Building configuration/i,
      /^version\s+\d/m,
      /^boot system/m,
      /^vlan\s+\d/m,
      /^spanning-tree\s/m,
      /^crypto\s/m,
      /^ntp\s/m,
      /^logging\s/m,
      /^enable\s/m,
    ];
    const matchCount = iosPatterns.filter((p) => p.test(head)).length;
    if (matchCount >= 2) return "cisco-ios";
  }

  return "javascript";
}
