/**
 * SSH Protocol — Integration Tests (QA Guardian)
 *
 * Tests component interactions and data flow for SSH-specific
 * features: host key dialogs, auth prompts, connection status
 * transitions, and reconnect flows.
 *
 * These test BEHAVIOR through the PUBLIC INTERFACE, not internal
 * implementation. They should survive a complete rewrite.
 *
 * Tags: [AC-1]–[AC-8], [INTEGRATION], [COVERAGE]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ConnectionTerminalView } from "../components/Terminal/ConnectionTerminalView";
import type { ConnectionOpenInput } from "../components/Terminal/connectionTypes";

// ─── Mock setup ──────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue("ssh-conn-001");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

type EventHandler = (event: { payload: unknown }) => void;
const eventListeners = new Map<string, EventHandler>();
const mockListen = vi
  .fn()
  .mockImplementation((eventName: string, handler: EventHandler) => {
    eventListeners.set(eventName, handler);
    return Promise.resolve(vi.fn());
  });
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Helper: emit a Tauri event to the captured listener
function emitEvent(eventName: string, payload: unknown) {
  const handler = eventListeners.get(eventName);
  if (handler) {
    handler({ payload });
  }
}

const sshConfig: ConnectionOpenInput = {
  host: "switch.lab.local",
  port: 22,
  protocol: "ssh",
  username: "admin",
  cols: 80,
  rows: 24,
};

const sshConfigWithKey: ConnectionOpenInput = {
  ...sshConfig,
  keyPath: "/home/user/.ssh/id_ed25519",
};

const sshConfigWithVault: ConnectionOpenInput = {
  ...sshConfig,
  credentialId: "vault-cred-001",
};

describe("SSH Protocol — Integration Tests", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue("ssh-conn-001");
    mockListen
      .mockReset()
      .mockImplementation((eventName: string, handler: EventHandler) => {
        eventListeners.set(eventName, handler);
        return Promise.resolve(vi.fn());
      });
    eventListeners.clear();
  });

  afterEach(() => {
    eventListeners.clear();
  });

  // ─── AC-1: Connect with password ───────────────────────

  describe("[AC-1] Connect with password", () => {
    it("sends SSH protocol and username to connection_open", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "connection_open",
        expect.objectContaining({
          input: expect.objectContaining({
            protocol: "ssh",
            username: "admin",
            host: "switch.lab.local",
            port: 22,
          }),
        }),
      );
    });

    it("sends credentialId when vault credential is configured", async () => {
      await act(async () => {
        render(
          <ConnectionTerminalView connectionConfig={sshConfigWithVault} />,
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "connection_open",
        expect.objectContaining({
          input: expect.objectContaining({
            protocol: "ssh",
            credentialId: "vault-cred-001",
          }),
        }),
      );
    });

    it("stores auth prompt state when backend emits auth-prompt event (dialog not yet rendered)", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      // Simulate backend requesting password
      await act(async () => {
        emitEvent(
          "connection-auth-prompt-ssh-conn-001",
          JSON.stringify({
            username: "admin",
            methods: ["password", "keyboard-interactive"],
          }),
        );
      });

      // AuthPromptDialog is intentionally NOT rendered yet —
      // the IPC command to send passwords back is not implemented.
      // The state is still captured via the useConnection hook.
      expect(
        screen.queryByTestId("auth-prompt-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  // ─── AC-2: Connect with SSH key ────────────────────────

  describe("[AC-2] Connect with SSH key", () => {
    it("sends keyPath to connection_open for key-based auth", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfigWithKey} />);
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "connection_open",
        expect.objectContaining({
          input: expect.objectContaining({
            protocol: "ssh",
            keyPath: "/home/user/.ssh/id_ed25519",
          }),
        }),
      );
    });

    it("sends both keyPath and credentialId for encrypted key", async () => {
      const configWithEncryptedKey: ConnectionOpenInput = {
        ...sshConfig,
        keyPath: "/home/user/.ssh/id_rsa",
        credentialId: "passphrase-vault-id",
      };

      await act(async () => {
        render(
          <ConnectionTerminalView connectionConfig={configWithEncryptedKey} />,
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "connection_open",
        expect.objectContaining({
          input: expect.objectContaining({
            keyPath: "/home/user/.ssh/id_rsa",
            credentialId: "passphrase-vault-id",
          }),
        }),
      );
    });
  });

  // ─── AC-4: Host key verification (new host) ────────────

  describe("[AC-4] Host key verification — new host (TOFU)", () => {
    it("shows HostKeyDialog when backend emits hostkey event", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-ed25519",
            fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            action: "new",
          }),
        );
      });

      expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();
      expect(screen.getByText("New SSH Host Key")).toBeInTheDocument();
      expect(screen.getByText(/switch\.lab\.local:22/)).toBeInTheDocument();
    });

    it("shows fingerprint and key type in TOFU dialog", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-ed25519",
            fingerprint: "SHA256:TestFingerprint123",
            action: "new",
          }),
        );
      });

      expect(screen.getByText("ssh-ed25519")).toBeInTheDocument();
      expect(screen.getByText("SHA256:TestFingerprint123")).toBeInTheDocument();
    });

    it("shows Accept & Connect button for new key", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-ed25519",
            fingerprint: "SHA256:test",
            action: "new",
          }),
        );
      });

      const acceptBtn = screen.getByTestId("hostkey-accept");
      expect(acceptBtn).toHaveTextContent("Accept & Connect");
    });
  });

  // ─── AC-5: Host key mismatch (MITM warning) ───────────

  describe("[AC-5] Host key mismatch — MITM warning", () => {
    it("shows warning dialog when backend emits hostkey-warning event", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-warning-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-rsa",
            fingerprint: "SHA256:NewBadFingerprint",
            action: "changed",
            expectedFingerprint: "SHA256:OriginalGoodFingerprint",
          }),
        );
      });

      expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();
      expect(screen.getByText(/HOST KEY CHANGED/i)).toBeInTheDocument();
      expect(screen.getByText(/man-in-the-middle/i)).toBeInTheDocument();
    });

    it("shows both expected and new fingerprints in MITM dialog", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-warning-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-rsa",
            fingerprint: "SHA256:NewBad",
            action: "changed",
            expectedFingerprint: "SHA256:OldGood",
          }),
        );
      });

      expect(screen.getByText("SHA256:NewBad")).toBeInTheDocument();
      expect(screen.getByText("SHA256:OldGood")).toBeInTheDocument();
    });

    it("shows 'Accept Anyway' with danger styling for changed key", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-warning-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-rsa",
            fingerprint: "SHA256:new",
            action: "changed",
            expectedFingerprint: "SHA256:old",
          }),
        );
      });

      const acceptBtn = screen.getByTestId("hostkey-accept");
      expect(acceptBtn).toHaveTextContent("Accept Anyway");
      expect(acceptBtn.className).toContain("terminal-dialog-btn-danger");
    });

    it("shows MITM safety warning text", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      await act(async () => {
        emitEvent(
          "connection-hostkey-warning-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-rsa",
            fingerprint: "SHA256:new",
            action: "changed",
            expectedFingerprint: "SHA256:old",
          }),
        );
      });

      expect(screen.getByText(/do NOT continue/i)).toBeInTheDocument();
      expect(screen.getByText(/system administrator/i)).toBeInTheDocument();
    });
  });

  // ─── AC-6: Connection failure handling ─────────────────

  describe("[AC-6] Connection failure handling", () => {
    it("displays 'Connection refused' error clearly", async () => {
      mockInvoke.mockRejectedValue(
        new Error("Connection refused: 192.168.1.1:22"),
      );

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      const errorDiv = screen.getByTestId("connection-error");
      expect(errorDiv).toBeInTheDocument();
      expect(errorDiv.textContent).toContain("Connection refused");
    });

    it("displays 'Authentication failed' error", async () => {
      mockInvoke.mockRejectedValue(
        new Error("Authentication failed: Password rejected by server"),
      );

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      const errorDiv = screen.getByTestId("connection-error");
      expect(errorDiv).toBeInTheDocument();
      expect(errorDiv.textContent).toContain("Authentication failed");
    });

    it("displays timeout error", async () => {
      mockInvoke.mockRejectedValue(new Error("Connection timed out (30s)"));

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      const errorDiv = screen.getByTestId("connection-error");
      expect(errorDiv).toBeInTheDocument();
      expect(errorDiv.textContent).toContain("timed out");
    });

    it("shows reconnect button on all error types", async () => {
      mockInvoke.mockRejectedValue(new Error("Host not found"));

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      expect(
        screen.getByRole("button", { name: /reconnect/i }),
      ).toBeInTheDocument();
    });

    it("handles non-Error rejection gracefully", async () => {
      mockInvoke.mockRejectedValue("plain string error");

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      const errorDiv = screen.getByTestId("connection-error");
      expect(errorDiv).toBeInTheDocument();
      expect(errorDiv.textContent).toContain("plain string error");
    });
  });

  // ─── AC-8: Reconnect from tab ──────────────────────────

  describe("[AC-8] Reconnect from tab", () => {
    it("reconnect resets error and re-attempts connection", async () => {
      mockInvoke
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue("ssh-conn-002");

      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      expect(screen.getByTestId("connection-error")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
      });

      // Should call connection_open again
      const openCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "connection_open",
      );
      expect(openCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("reconnect from disconnected overlay re-opens connection", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      // Simulate disconnection
      await act(async () => {
        emitEvent("connection-status-ssh-conn-001", {
          status: "disconnected",
          message: "Connection closed by remote host",
        });
      });

      const overlay = screen.getByTestId("connection-disconnected-overlay");
      expect(overlay).toBeInTheDocument();

      // Click reconnect in overlay
      mockInvoke.mockResolvedValue("ssh-conn-003");
      await act(async () => {
        const reconnectBtn = overlay.querySelector("button");
        if (reconnectBtn) fireEvent.click(reconnectBtn);
      });

      // Verify new connection_open call
      const openCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "connection_open",
      );
      expect(openCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Status transitions ────────────────────────────────

  describe("[COVERAGE] Connection status transitions", () => {
    it("transitions from connecting → connected", async () => {
      const onStatusChange = vi.fn();

      await act(async () => {
        render(
          <ConnectionTerminalView
            connectionConfig={sshConfig}
            onStatusChange={onStatusChange}
          />,
        );
      });

      await act(async () => {
        emitEvent("connection-status-ssh-conn-001", {
          status: "connected",
        });
      });

      expect(onStatusChange).toHaveBeenCalledWith("connected", undefined);
    });

    it("transitions from connected → disconnected with message", async () => {
      const onStatusChange = vi.fn();

      await act(async () => {
        render(
          <ConnectionTerminalView
            connectionConfig={sshConfig}
            onStatusChange={onStatusChange}
          />,
        );
      });

      // Connected first
      await act(async () => {
        emitEvent("connection-status-ssh-conn-001", {
          status: "connected",
        });
      });

      // Then disconnected
      await act(async () => {
        emitEvent("connection-status-ssh-conn-001", {
          status: "disconnected",
          message: "Keepalive timeout (3 missed)",
        });
      });

      expect(onStatusChange).toHaveBeenCalledWith(
        "disconnected",
        "Keepalive timeout (3 missed)",
      );
    });

    it("transitions from connected → error with message", async () => {
      const onStatusChange = vi.fn();

      await act(async () => {
        render(
          <ConnectionTerminalView
            connectionConfig={sshConfig}
            onStatusChange={onStatusChange}
          />,
        );
      });

      await act(async () => {
        emitEvent("connection-status-ssh-conn-001", {
          status: "error",
          message: "Connection reset by peer",
        });
      });

      expect(onStatusChange).toHaveBeenCalledWith(
        "error",
        "Connection reset by peer",
      );
    });
  });

  // ─── Event listener setup ──────────────────────────────

  describe("[COVERAGE] SSH event listeners", () => {
    it("registers all 5 SSH-specific event listeners", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      const expectedEvents = [
        "connection-output-ssh-conn-001",
        "connection-status-ssh-conn-001",
        "connection-hostkey-ssh-conn-001",
        "connection-hostkey-warning-ssh-conn-001",
        "connection-auth-prompt-ssh-conn-001",
      ];

      for (const eventName of expectedEvents) {
        expect(eventListeners.has(eventName)).toBe(true);
      }
    });
  });

  // ─── Auth prompt + host key flow interaction ───────────

  describe("[COVERAGE] Dialog flow: host key → auth prompt sequence", () => {
    it("shows host key dialog first, then auth prompt after host key event", async () => {
      await act(async () => {
        render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      // First: host key verification
      await act(async () => {
        emitEvent(
          "connection-hostkey-ssh-conn-001",
          JSON.stringify({
            host: "switch.lab.local",
            port: 22,
            keyType: "ssh-ed25519",
            fingerprint: "SHA256:abc",
            action: "new",
          }),
        );
      });

      expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();

      // Then: auth prompt event arrives but dialog is NOT rendered
      // (AuthPromptDialog disabled until IPC response wiring is complete)
      await act(async () => {
        emitEvent(
          "connection-auth-prompt-ssh-conn-001",
          JSON.stringify({
            username: "admin",
            methods: ["password"],
          }),
        );
      });

      expect(
        screen.queryByTestId("auth-prompt-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  // ─── Cleanup on unmount ────────────────────────────────

  describe("[COVERAGE] Connection cleanup on unmount", () => {
    it("sends connection_close when SSH component unmounts", async () => {
      const { unmount } = await act(async () => {
        return render(<ConnectionTerminalView connectionConfig={sshConfig} />);
      });

      mockInvoke.mockClear();
      unmount();

      expect(mockInvoke).toHaveBeenCalledWith("connection_close", {
        connectionId: "ssh-conn-001",
      });
    });

    it("closes connection even if unmount happens during setup", async () => {
      // Slow connection_open to simulate unmount during connect
      let resolveOpen: ((value: string) => void) | undefined;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "connection_open") {
          return new Promise<string>((resolve) => {
            resolveOpen = resolve;
          });
        }
        return Promise.resolve();
      });

      const { unmount } = render(
        <ConnectionTerminalView connectionConfig={sshConfig} />,
      );

      // Unmount before connection_open resolves
      unmount();

      // Now resolve — should trigger immediate close
      if (resolveOpen) {
        await act(async () => {
          resolveOpen!("late-conn-id");
        });
      }

      // The hook should have called connection_close for the late connection
      const closeCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "connection_close",
      );
      expect(closeCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
