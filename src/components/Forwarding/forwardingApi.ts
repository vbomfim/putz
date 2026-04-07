/**
 * Forwarding API — wraps Tauri IPC invoke calls for forwarding operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/forwarding.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 *
 * @module forwardingApi
 */
import { invoke } from "@tauri-apps/api/core";
import type { ForwardingRuleInput, ForwardingStatus } from "./types";

/** Adds a forwarding rule to an active SSH connection. Returns tunnel ID. */
export async function forwardingAdd(
  connectionId: string,
  rule: ForwardingRuleInput,
): Promise<string> {
  return invoke<string>("forwarding_add", { connectionId, rule });
}

/** Removes a forwarding tunnel by ID. */
export async function forwardingRemove(tunnelId: string): Promise<void> {
  return invoke<void>("forwarding_remove", { tunnelId });
}

/** Lists all forwarding tunnels for an SSH connection. */
export async function forwardingList(
  connectionId: string,
): Promise<ForwardingStatus[]> {
  return invoke<ForwardingStatus[]>("forwarding_list", { connectionId });
}

/** Gets status of all forwarding tunnels across all connections. */
export async function forwardingStatus(): Promise<ForwardingStatus[]> {
  return invoke<ForwardingStatus[]>("forwarding_status");
}
