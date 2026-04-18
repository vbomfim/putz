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

/** Get a file's modification time (ms since epoch). */
export async function fileMtime(path: string): Promise<number> {
  return invoke<number>("file_mtime", { path });
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
    case "py":
    case "pyw":
      return "python";
    case "tf":
    case "tfvars":
    case "hcl":
      return "terraform";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "j2":
    case "jinja":
    case "jinja2":
      return "jinja2";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "txt":
    case "log":
    case "csv":
    case "tsv":
    case "":
      return "text";
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

    // Terraform/HCL detection
    const tfPatterns = [
      /^(resource|data|variable|output|locals|module|provider|terraform)\s+"/m,
      /^\s*source\s*=\s*"/m,
      /^\s*version\s*=\s*"/m,
      /\b(aws_|azurerm_|google_)\w+/,
    ];
    const tfCount = tfPatterns.filter((p) => p.test(head)).length;
    if (tfCount >= 2) return "terraform";

    // ARM template detection (JSON with deployment schema)
    if (/deploymentTemplate/i.test(head) && /\$schema/i.test(head)) return "json";

    // Jinja2 detection ({{ }}, {% %} patterns)
    const jinjaExprCount = (head.match(/\{\{/g) || []).length;
    const jinjaTagCount = (head.match(/\{%/g) || []).length;
    if (jinjaExprCount + jinjaTagCount >= 2) return "jinja2";
  }

  // Unknown extension and no content signal — treat as plain text rather
  // than misidentifying it as JavaScript.
  return "text";
}
