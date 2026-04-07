/**
 * Type definitions for the credential vault IPC layer.
 *
 * These types mirror the Rust backend's vault models.
 * Keep in sync with src-tauri/src/vault/models.rs.
 */

/** The type of credential stored. */
export type CredentialType = "password" | "key_passphrase";

/** Metadata for a stored credential — NO secrets. */
export interface CredentialMeta {
  id: string;
  name: string;
  username: string;
  credentialType: CredentialType;
  lastUsed?: string;
  createdAt: string;
  updatedAt: string;
}

/** Full credential including the secret (for editor form). */
export interface Credential {
  meta: CredentialMeta;
  secret: string;
}

/** Input for creating or updating a credential via IPC. */
export interface SetCredentialInput {
  /** If provided, updates existing credential. If omitted, creates new. */
  id?: string;
  name: string;
  username: string;
  secret: string;
  credentialType: CredentialType;
}

/** Human-readable labels for credential types. */
export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  password: "Password",
  key_passphrase: "Key Passphrase",
};
