/**
 * Vault API — wraps Tauri IPC invoke calls for credential vault operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/vault.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type { CredentialMeta, Credential, SetCredentialInput } from "./types";

/** Lists all stored credentials (metadata only — NO secrets). */
export async function vaultList(): Promise<CredentialMeta[]> {
  return invoke<CredentialMeta[]>("vault_list");
}

/** Gets a full credential (including secret) by ID — for editor only. */
export async function vaultGet(id: string): Promise<Credential> {
  return invoke<Credential>("vault_get", { id });
}

/**
 * Creates or updates a credential.
 * Returns the credential ID (generated for new, echoed for updates).
 */
export async function vaultSet(input: SetCredentialInput): Promise<string> {
  return invoke<string>("vault_set", { input });
}

/** Deletes a credential from both the index and the OS keychain. */
export async function vaultDelete(id: string): Promise<void> {
  return invoke<void>("vault_delete", { id });
}

/** Returns credentials that expire within the given number of days. */
export async function vaultCheckExpiring(
  daysAhead: number,
): Promise<CredentialMeta[]> {
  return invoke<CredentialMeta[]>("vault_check_expiring", { daysAhead });
}
