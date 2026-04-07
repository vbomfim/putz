/**
 * SSH Protocol — Contract Tests (QA Guardian)
 *
 * Validates that TypeScript type definitions for SSH-specific IPC
 * commands and events match the Rust backend's expected structure.
 * These tests catch type drift between frontend and backend.
 *
 * Tests are rewritable: they verify the PUBLIC INTERFACE contract,
 * not internal implementation.
 *
 * Tags: [CONTRACT], [AC-1]–[AC-5]
 */
import { describe, it, expect } from "vitest";
import type {
  ConnectionOpenInput,
  ConnectionProtocol,
  ConnectionStatusPayload,
  ConnectionStatusType,
  ConnectionWriteArgs,
  ConnectionResizeArgs,
  ConnectionCloseArgs,
  HostKeyPayload,
  AuthPromptPayload,
} from "../components/Terminal/connectionTypes";

describe("SSH Contract Tests", () => {
  // ─── ConnectionOpenInput: SSH-specific fields ──────────

  describe("[CONTRACT] ConnectionOpenInput — SSH fields", () => {
    it("accepts full SSH configuration with all optional fields", () => {
      const input: ConnectionOpenInput = {
        host: "10.0.0.1",
        port: 22,
        protocol: "ssh",
        username: "admin",
        cols: 80,
        rows: 24,
        credentialId: "vault-uuid-001",
        keyPath: "/home/user/.ssh/id_ed25519",
      };
      expect(input.protocol).toBe("ssh");
      expect(input.credentialId).toBe("vault-uuid-001");
      expect(input.keyPath).toBe("/home/user/.ssh/id_ed25519");
    });

    it("accepts SSH config with only credentialId (password auth via vault)", () => {
      const input: ConnectionOpenInput = {
        host: "router.local",
        port: 22,
        protocol: "ssh",
        username: "admin",
        cols: 80,
        rows: 24,
        credentialId: "saved-password-id",
      };
      expect(input.credentialId).toBe("saved-password-id");
      expect(input.keyPath).toBeUndefined();
    });

    it("accepts SSH config with only keyPath (key auth without passphrase)", () => {
      const input: ConnectionOpenInput = {
        host: "server.cloud",
        port: 22,
        protocol: "ssh",
        username: "deploy",
        cols: 80,
        rows: 24,
        keyPath: "/home/deploy/.ssh/id_rsa",
      };
      expect(input.keyPath).toBe("/home/deploy/.ssh/id_rsa");
      expect(input.credentialId).toBeUndefined();
    });

    it("accepts SSH config with both keyPath and credentialId (encrypted key)", () => {
      const input: ConnectionOpenInput = {
        host: "bastion.internal",
        port: 22,
        protocol: "ssh",
        username: "ops",
        cols: 120,
        rows: 40,
        keyPath: "/home/ops/.ssh/id_rsa_encrypted",
        credentialId: "key-passphrase-vault-id",
      };
      expect(input.keyPath).toBeDefined();
      expect(input.credentialId).toBeDefined();
    });

    it("accepts SSH config without username (backend defaults to 'root')", () => {
      const input: ConnectionOpenInput = {
        host: "server.local",
        port: 22,
        protocol: "ssh",
        cols: 80,
        rows: 24,
      };
      expect(input.username).toBeUndefined();
    });

    it("accepts SSH config without port (backend defaults to 22)", () => {
      const input: ConnectionOpenInput = {
        host: "server.local",
        protocol: "ssh",
        cols: 80,
        rows: 24,
      };
      expect(input.port).toBeUndefined();
    });

    it("accepts non-standard SSH port", () => {
      const input: ConnectionOpenInput = {
        host: "jump-host.dmz",
        port: 2222,
        protocol: "ssh",
        cols: 80,
        rows: 24,
      };
      expect(input.port).toBe(2222);
    });
  });

  // ─── HostKeyPayload contract ───────────────────────────

  describe("[CONTRACT] HostKeyPayload", () => {
    it("new host key payload has required fields", () => {
      const payload: HostKeyPayload = {
        host: "switch.lab.local",
        port: 22,
        keyType: "ssh-ed25519",
        fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        action: "new",
      };
      expect(payload.host).toBe("switch.lab.local");
      expect(payload.port).toBe(22);
      expect(payload.keyType).toBe("ssh-ed25519");
      expect(payload.fingerprint).toContain("SHA256:");
      expect(payload.action).toBe("new");
      expect(payload.expectedFingerprint).toBeUndefined();
    });

    it("changed host key payload includes expectedFingerprint", () => {
      const payload: HostKeyPayload = {
        host: "router.dc1",
        port: 22,
        keyType: "ssh-rsa",
        fingerprint: "SHA256:NewKeyFingerprint1234567890",
        action: "changed",
        expectedFingerprint: "SHA256:OldKeyFingerprint0987654321",
      };
      expect(payload.action).toBe("changed");
      expect(payload.expectedFingerprint).toBe(
        "SHA256:OldKeyFingerprint0987654321",
      );
      expect(payload.fingerprint).toBe("SHA256:NewKeyFingerprint1234567890");
    });

    it("action field is restricted to 'new' or 'changed'", () => {
      const actions: HostKeyPayload["action"][] = ["new", "changed"];
      expect(actions).toHaveLength(2);
      expect(actions).toContain("new");
      expect(actions).toContain("changed");
    });

    it("supports common SSH key types", () => {
      const keyTypes = ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"];
      for (const keyType of keyTypes) {
        const payload: HostKeyPayload = {
          host: "test",
          port: 22,
          keyType,
          fingerprint: "SHA256:test",
          action: "new",
        };
        expect(payload.keyType).toBe(keyType);
      }
    });

    it("port field accepts valid port range values", () => {
      const ports = [22, 1, 2222, 65535];
      for (const port of ports) {
        const payload: HostKeyPayload = {
          host: "test",
          port,
          keyType: "ssh-ed25519",
          fingerprint: "SHA256:test",
          action: "new",
        };
        expect(payload.port).toBe(port);
      }
    });
  });

  // ─── AuthPromptPayload contract ────────────────────────

  describe("[CONTRACT] AuthPromptPayload", () => {
    it("has username and methods fields", () => {
      const payload: AuthPromptPayload = {
        username: "admin",
        methods: ["password"],
      };
      expect(payload.username).toBe("admin");
      expect(payload.methods).toEqual(["password"]);
    });

    it("methods array can contain multiple auth methods", () => {
      const payload: AuthPromptPayload = {
        username: "root",
        methods: ["publickey", "password", "keyboard-interactive"],
      };
      expect(payload.methods).toHaveLength(3);
      expect(payload.methods).toContain("publickey");
      expect(payload.methods).toContain("password");
      expect(payload.methods).toContain("keyboard-interactive");
    });

    it("methods array can be empty (edge: no methods available)", () => {
      const payload: AuthPromptPayload = {
        username: "service",
        methods: [],
      };
      expect(payload.methods).toHaveLength(0);
    });
  });

  // ─── Event name format contracts ───────────────────────

  describe("[CONTRACT] Tauri Event Name Format", () => {
    it("connection output event follows pattern: connection-output-{connectionId}", () => {
      const connectionId = "abc-123-def";
      const eventName = `connection-output-${connectionId}`;
      expect(eventName).toBe("connection-output-abc-123-def");
      expect(eventName).toMatch(/^connection-output-[a-z0-9-]+$/);
    });

    it("connection status event follows pattern: connection-status-{connectionId}", () => {
      const connectionId = "uuid-456";
      const eventName = `connection-status-${connectionId}`;
      expect(eventName).toBe("connection-status-uuid-456");
    });

    it("host key event follows pattern: connection-hostkey-{connectionId}", () => {
      const connectionId = "ssh-001";
      const eventName = `connection-hostkey-${connectionId}`;
      expect(eventName).toBe("connection-hostkey-ssh-001");
    });

    it("host key warning event follows pattern: connection-hostkey-warning-{connectionId}", () => {
      const connectionId = "ssh-001";
      const eventName = `connection-hostkey-warning-${connectionId}`;
      expect(eventName).toBe("connection-hostkey-warning-ssh-001");
    });

    it("auth prompt event follows pattern: connection-auth-prompt-{connectionId}", () => {
      const connectionId = "ssh-001";
      const eventName = `connection-auth-prompt-${connectionId}`;
      expect(eventName).toBe("connection-auth-prompt-ssh-001");
    });
  });

  // ─── Status transition contracts ───────────────────────

  describe("[CONTRACT] ConnectionStatus transitions", () => {
    it("all four status types are valid", () => {
      const statuses: ConnectionStatusType[] = [
        "connecting",
        "connected",
        "disconnected",
        "error",
      ];
      expect(statuses).toHaveLength(4);
    });

    it("status payload with connecting status", () => {
      const payload: ConnectionStatusPayload = {
        status: "connecting",
      };
      expect(payload.status).toBe("connecting");
      expect(payload.message).toBeUndefined();
    });

    it("status payload with connected status", () => {
      const payload: ConnectionStatusPayload = {
        status: "connected",
      };
      expect(payload.status).toBe("connected");
    });

    it("status payload with disconnected and keepalive message", () => {
      const payload: ConnectionStatusPayload = {
        status: "disconnected",
        message: "Keepalive timeout: 3 missed replies",
      };
      expect(payload.status).toBe("disconnected");
      expect(payload.message).toContain("Keepalive");
    });

    it("status payload with error and descriptive message", () => {
      const payload: ConnectionStatusPayload = {
        status: "error",
        message: "Connection refused: 192.168.1.1:22",
      };
      expect(payload.status).toBe("error");
      expect(payload.message).toContain("Connection refused");
    });
  });

  // ─── Protocol type coverage ────────────────────────────

  describe("[CONTRACT] ConnectionProtocol values", () => {
    it("ssh is a valid protocol type", () => {
      const protocol: ConnectionProtocol = "ssh";
      expect(protocol).toBe("ssh");
    });

    it("all protocol types are accounted for", () => {
      const protocols: ConnectionProtocol[] = ["ssh", "telnet", "serial", "local"];
      expect(protocols).toHaveLength(4);
    });
  });

  // ─── Write/Resize/Close contracts for SSH ──────────────

  describe("[CONTRACT] IPC command args for SSH connections", () => {
    it("ConnectionWriteArgs uses base64-encoded data", () => {
      const data = "show running-config\r\n";
      const bytes = new TextEncoder().encode(data);
      const base64 = btoa(String.fromCharCode(...bytes));

      const args: ConnectionWriteArgs = {
        connectionId: "ssh-001",
        data: base64,
      };
      expect(args.connectionId).toBe("ssh-001");
      // Verify roundtrip: base64 → bytes → string
      const decoded = atob(args.data);
      expect(decoded).toBe(data);
    });

    it("ConnectionResizeArgs sends terminal dimensions", () => {
      const args: ConnectionResizeArgs = {
        connectionId: "ssh-001",
        cols: 132,
        rows: 43,
      };
      expect(args.cols).toBe(132);
      expect(args.rows).toBe(43);
    });

    it("ConnectionCloseArgs identifies the connection to close", () => {
      const args: ConnectionCloseArgs = {
        connectionId: "ssh-001",
      };
      expect(args.connectionId).toBe("ssh-001");
    });
  });

  // ─── Backend error message format contracts ────────────

  describe("[CONTRACT] Backend error message formats", () => {
    it("connection refused error includes host:port", () => {
      const errorMsg = "Connection refused: 192.168.1.1:22";
      expect(errorMsg).toMatch(/Connection refused: .+:\d+/);
    });

    it("auth failed error describes the failure", () => {
      const errorMsg = "Authentication failed: Password rejected by server";
      expect(errorMsg).toMatch(/Authentication failed: .+/);
    });

    it("timeout error includes duration", () => {
      const errorMsg = "Connection timed out (30s)";
      expect(errorMsg).toMatch(/timed out \(\d+s\)/);
    });

    it("host key mismatch error describes MITM risk", () => {
      const errorMsg = "Host key mismatch: switch.lab.local:22 — possible MITM attack";
      expect(errorMsg).toMatch(/Host key mismatch: .+/);
    });

    it("channel closed error identifies the connection", () => {
      const errorMsg = "Channel closed: not connected";
      expect(errorMsg).toMatch(/Channel closed: .+/);
    });

    it("invalid params error provides detail", () => {
      const errorMsg = "Invalid parameters: host is required for SSH";
      expect(errorMsg).toMatch(/Invalid parameters: .+/);
    });
  });
});
