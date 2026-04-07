/**
 * Ping API — wraps Tauri IPC invoke calls for ping operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/nettools.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PingRequest } from "./types";

/** Starts a ping session. Returns the session ID. */
export async function pingStart(request: PingRequest): Promise<string> {
  return invoke<string>("ping_start", { request });
}

/** Stops a running ping session. */
export async function pingStop(id: string): Promise<void> {
  return invoke<void>("ping_stop", { id });
}
