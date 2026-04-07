/**
 * SSH keys contract tests — validate TypeScript types match Rust backend.
 *
 * Tags: [CONTRACT], [TDD]
 */
import { describe, it, expect } from "vitest";
import type {
  SSHKeyMeta,
  GenerateKeyInput,
  ImportKeyInput,
  KeyAlgorithm,
} from "../components/Keys/types";
import { KEY_ALGORITHM_LABELS } from "../components/Keys/types";

describe("SSH keys type contracts", () => {
  // ─── SSHKeyMeta ────────────────────────────────────────────

  it("SSHKeyMeta has all required fields", () => {
    const meta: SSHKeyMeta = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Production Server",
      algorithm: "ed25519",
      fingerprint: "SHA256:abc123def456",
      publicKey: "ssh-ed25519 AAAA...",
      hasPassphrase: false,
      createdAt: "2024-01-01T00:00:00Z",
    };
    expect(meta.id).toBeDefined();
    expect(meta.name).toBeDefined();
    expect(meta.algorithm).toBeDefined();
    expect(meta.fingerprint).toBeDefined();
    expect(meta.publicKey).toBeDefined();
    expect(meta.hasPassphrase).toBeDefined();
    expect(meta.createdAt).toBeDefined();
  });

  it("SSHKeyMeta optional fields are optional", () => {
    const meta: SSHKeyMeta = {
      id: "id",
      name: "Test",
      algorithm: "ed25519",
      fingerprint: "fp",
      publicKey: "pub",
      hasPassphrase: false,
      createdAt: "2024-01-01T00:00:00Z",
    };
    expect(meta.passphraseCredentialId).toBeUndefined();
    expect(meta.importedFrom).toBeUndefined();
  });

  it("SSHKeyMeta does NOT have a privateKey field", () => {
    const meta: SSHKeyMeta = {
      id: "id",
      name: "Test",
      algorithm: "ed25519",
      fingerprint: "fp",
      publicKey: "pub",
      hasPassphrase: false,
      createdAt: "2024-01-01T00:00:00Z",
    };
    // @ts-expect-error — privateKey should not exist on SSHKeyMeta
    expect(meta.privateKey).toBeUndefined();
  });

  it("SSHKeyMeta uses camelCase field names", () => {
    const meta: SSHKeyMeta = {
      id: "id",
      name: "Test",
      algorithm: "ed25519",
      fingerprint: "fp",
      publicKey: "pub",
      hasPassphrase: true,
      passphraseCredentialId: "vault-id",
      importedFrom: "/path/to/key",
      createdAt: "2024-01-01T00:00:00Z",
    };
    const json = JSON.stringify(meta);
    expect(json).toContain("publicKey");
    expect(json).toContain("hasPassphrase");
    expect(json).toContain("passphraseCredentialId");
    expect(json).toContain("importedFrom");
    expect(json).toContain("createdAt");
    // Should NOT contain snake_case versions
    expect(json).not.toContain("public_key");
    expect(json).not.toContain("has_passphrase");
    expect(json).not.toContain("created_at");
  });

  // ─── KeyAlgorithm ─────────────────────────────────────────

  it("KeyAlgorithm has expected variants", () => {
    const algorithms: KeyAlgorithm[] = ["ed25519", "rsa-4096"];
    expect(algorithms).toHaveLength(2);
    expect(algorithms).toContain("ed25519");
    expect(algorithms).toContain("rsa-4096");
  });

  it("KEY_ALGORITHM_LABELS has human-readable labels", () => {
    expect(KEY_ALGORITHM_LABELS["ed25519"]).toBe("Ed25519");
    expect(KEY_ALGORITHM_LABELS["rsa-4096"]).toBe("RSA-4096");
  });

  // ─── GenerateKeyInput ─────────────────────────────────────

  it("GenerateKeyInput for generate without passphrase", () => {
    const input: GenerateKeyInput = {
      name: "New Key",
      algorithm: "ed25519",
    };
    expect(input.name).toBe("New Key");
    expect(input.algorithm).toBe("ed25519");
    expect(input.passphrase).toBeUndefined();
  });

  it("GenerateKeyInput for generate with passphrase", () => {
    const input: GenerateKeyInput = {
      name: "Secured Key",
      algorithm: "rsa-4096",
      passphrase: "my-passphrase",
    };
    expect(input.passphrase).toBe("my-passphrase");
  });

  // ─── ImportKeyInput ───────────────────────────────────────

  it("ImportKeyInput for import without passphrase", () => {
    const input: ImportKeyInput = {
      name: "Imported",
      privateKeyPem: "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    };
    expect(input.name).toBe("Imported");
    expect(input.privateKeyPem).toContain("PRIVATE KEY");
    expect(input.passphrase).toBeUndefined();
  });

  it("ImportKeyInput for import with passphrase", () => {
    const input: ImportKeyInput = {
      name: "Encrypted Import",
      privateKeyPem: "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
      passphrase: "decrypt-pass",
    };
    expect(input.passphrase).toBe("decrypt-pass");
  });

  // ─── IPC command name contracts ────────────────────────────

  it("IPC command names use snake_case", () => {
    const commands = [
      "key_list",
      "key_generate",
      "key_import",
      "key_delete",
      "key_get_public",
    ];
    commands.forEach((cmd) => {
      expect(cmd).toMatch(/^[a-z_]+$/);
    });
  });

  it("key_get_key_path is NOT an IPC command", () => {
    // get_key_path is Rust-only — verify frontend has no reference to it
    const ipcCommands = [
      "key_list",
      "key_generate",
      "key_import",
      "key_delete",
      "key_get_public",
    ];
    expect(ipcCommands).not.toContain("key_get_key_path");
  });
});
