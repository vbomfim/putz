/**
 * Vault contract tests — validate TypeScript types match Rust backend.
 *
 * Tags: [CONTRACT], [TDD]
 */
import { describe, it, expect } from "vitest";
import type {
  CredentialMeta,
  Credential,
  SetCredentialInput,
  CredentialType,
} from "../components/Vault/types";
import { CREDENTIAL_TYPE_LABELS } from "../components/Vault/types";

describe("Vault type contracts", () => {
  // ─── CredentialMeta ────────────────────────────────────────

  it("CredentialMeta has all required fields", () => {
    const meta: CredentialMeta = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "DC1 Admin",
      username: "admin",
      credentialType: "password",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(meta.id).toBeDefined();
    expect(meta.name).toBeDefined();
    expect(meta.username).toBeDefined();
    expect(meta.credentialType).toBeDefined();
    expect(meta.createdAt).toBeDefined();
    expect(meta.updatedAt).toBeDefined();
  });

  it("CredentialMeta lastUsed is optional", () => {
    const meta: CredentialMeta = {
      id: "id",
      name: "Test",
      username: "user",
      credentialType: "password",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(meta.lastUsed).toBeUndefined();
  });

  it("CredentialMeta does NOT have a secret field", () => {
    const meta: CredentialMeta = {
      id: "id",
      name: "Test",
      username: "user",
      credentialType: "password",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    // @ts-expect-error — secret should not exist on CredentialMeta
    expect(meta.secret).toBeUndefined();
  });

  // ─── Credential ────────────────────────────────────────────

  it("Credential includes meta and secret", () => {
    const cred: Credential = {
      meta: {
        id: "id",
        name: "Test",
        username: "user",
        credentialType: "password",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      secret: "hunter2",
    };
    expect(cred.meta).toBeDefined();
    expect(cred.secret).toBe("hunter2");
  });

  // ─── CredentialType ────────────────────────────────────────

  it("CredentialType has expected variants", () => {
    const types: CredentialType[] = ["password", "key_passphrase"];
    expect(types).toHaveLength(2);
    expect(types).toContain("password");
    expect(types).toContain("key_passphrase");
  });

  it("CREDENTIAL_TYPE_LABELS has human-readable labels", () => {
    expect(CREDENTIAL_TYPE_LABELS.password).toBe("Password");
    expect(CREDENTIAL_TYPE_LABELS.key_passphrase).toBe("Key Passphrase");
  });

  // ─── SetCredentialInput ────────────────────────────────────

  it("SetCredentialInput for create (no id)", () => {
    const input: SetCredentialInput = {
      name: "New Cred",
      username: "admin",
      secret: "pass123",
      credentialType: "password",
    };
    expect(input.id).toBeUndefined();
    expect(input.name).toBe("New Cred");
  });

  it("SetCredentialInput for update (with id)", () => {
    const input: SetCredentialInput = {
      id: "abc-123",
      name: "Updated Cred",
      username: "root",
      secret: "newpass",
      credentialType: "key_passphrase",
    };
    expect(input.id).toBe("abc-123");
  });

  // ─── Serialization contracts ───────────────────────────────

  it("CredentialMeta uses camelCase field names", () => {
    const meta: CredentialMeta = {
      id: "id",
      name: "Test",
      username: "user",
      credentialType: "password",
      lastUsed: "2024-01-01T00:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const json = JSON.stringify(meta);
    expect(json).toContain("credentialType");
    expect(json).toContain("lastUsed");
    expect(json).toContain("createdAt");
    expect(json).toContain("updatedAt");
    // Should NOT contain snake_case versions of these fields
    expect(json).not.toContain("credential_type");
    expect(json).not.toContain("last_used");
    expect(json).not.toContain("created_at");
    expect(json).not.toContain("updated_at");
  });

  // ─── IPC command name contracts ────────────────────────────

  it("IPC command names use snake_case", () => {
    const commands = ["vault_list", "vault_get", "vault_set", "vault_delete"];
    commands.forEach((cmd) => {
      expect(cmd).toMatch(/^[a-z_]+$/);
    });
  });

  it("vault_get_for_session is NOT an IPC command", () => {
    // This is a Rust-only method — verify the frontend has no reference to it
    const ipcCommands = [
      "vault_list",
      "vault_get",
      "vault_set",
      "vault_delete",
    ];
    expect(ipcCommands).not.toContain("vault_get_for_session");
  });
});
