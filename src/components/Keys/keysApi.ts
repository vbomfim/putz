/**
 * Keys API — wraps Tauri IPC invoke calls for SSH key operations.
 *
 * Each function maps 1:1 to a Rust #[tauri::command] in ipc/keys.rs.
 * Centralizes IPC calls so components don't depend on invoke directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SSHKeyMeta, GenerateKeyInput, ImportKeyInput } from "./types";

/** Lists all stored SSH keys (metadata only — NO private keys). */
export async function keyList(): Promise<SSHKeyMeta[]> {
  return invoke<SSHKeyMeta[]>("key_list");
}

/**
 * Generates a new SSH key pair.
 * Returns the key metadata (public key, fingerprint, algorithm).
 * The private key is stored on disk — NEVER returned via IPC.
 */
export async function keyGenerate(
  input: GenerateKeyInput,
): Promise<SSHKeyMeta> {
  return invoke<SSHKeyMeta>("key_generate", { input });
}

/**
 * Imports an existing SSH private key.
 * Accepts PEM-encoded private key data.
 */
export async function keyImport(input: ImportKeyInput): Promise<SSHKeyMeta> {
  return invoke<SSHKeyMeta>("key_import", { input });
}

/** Deletes an SSH key from both the index and disk. */
export async function keyDelete(id: string): Promise<void> {
  return invoke<void>("key_delete", { id });
}

/** Gets the public key in OpenSSH format for a given key ID. */
export async function keyGetPublic(id: string): Promise<string> {
  return invoke<string>("key_get_public", { id });
}
