/**
 * Type definitions for the SSH key manager IPC layer.
 *
 * These types mirror the Rust backend's keys models.
 * Keep in sync with src-tauri/src/keys/models.rs.
 */

/** Supported SSH key algorithms. */
export type KeyAlgorithm = "ed25519" | "rsa-4096";

/** Metadata for a stored SSH key — NO private key material. */
export interface SSHKeyMeta {
  id: string;
  name: string;
  algorithm: KeyAlgorithm;
  fingerprint: string;
  publicKey: string;
  hasPassphrase: boolean;
  passphraseCredentialId?: string;
  importedFrom?: string;
  createdAt: string;
}

/** Input for generating a new SSH key via IPC. */
export interface GenerateKeyInput {
  name: string;
  algorithm: KeyAlgorithm;
  passphrase?: string;
}

/** Input for importing an existing SSH key via IPC. */
export interface ImportKeyInput {
  name: string;
  privateKeyPem: string;
  passphrase?: string;
}

/** Human-readable labels for key algorithms. */
export const KEY_ALGORITHM_LABELS: Record<KeyAlgorithm, string> = {
  ed25519: "Ed25519",
  "rsa-4096": "RSA-4096",
};
