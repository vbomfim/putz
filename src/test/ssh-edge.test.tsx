/**
 * SSH Protocol — Edge Case Tests (QA Guardian)
 *
 * Tests boundary values, error paths, unusual inputs, and
 * concurrent scenarios that acceptance criteria don't explicitly
 * cover but are critical for robustness.
 *
 * Tags: [EDGE], [BOUNDARY], [REGRESSION]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthPromptDialog } from "../components/Terminal/AuthPromptDialog";
import { HostKeyDialog } from "../components/Terminal/HostKeyDialog";
import { ConnectionTerminalView } from "../components/Terminal/ConnectionTerminalView";
import type {
  AuthPromptPayload,
  HostKeyPayload,
  ConnectionOpenInput,
} from "../components/Terminal/connectionTypes";

// ─── Mock setup ──────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue("edge-conn-001");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

type EventHandler = (event: { payload: unknown }) => void;
const eventListeners = new Map<string, EventHandler>();
const mockListen = vi.fn().mockImplementation(
  (eventName: string, handler: EventHandler) => {
    eventListeners.set(eventName, handler);
    return Promise.resolve(vi.fn());
  },
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

function emitEvent(eventName: string, payload: unknown) {
  const handler = eventListeners.get(eventName);
  if (handler) handler({ payload });
}

const sshConfig: ConnectionOpenInput = {
  host: "switch.lab.local",
  port: 22,
  protocol: "ssh",
  username: "admin",
  cols: 80,
  rows: 24,
};

// ─── AuthPromptDialog Edge Cases ─────────────────────────

describe("AuthPromptDialog — Edge Cases", () => {
  let onSubmit: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  const authPrompt: AuthPromptPayload = {
    username: "admin",
    methods: ["password"],
  };

  beforeEach(() => {
    onSubmit = vi.fn();
    onCancel = vi.fn();
  });

  it("[EDGE] handles special characters in password (quotes, backticks, angle brackets)", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const specialPassword = `P@ss'"w0rd<>&\``;
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, specialPassword);
    fireEvent.click(screen.getByTestId("auth-submit"));

    expect(onSubmit).toHaveBeenCalledWith(specialPassword);
  });

  it("[EDGE] handles unicode characters in password (emoji, CJK)", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "密码🔑pass");
    fireEvent.click(screen.getByTestId("auth-submit"));

    expect(onSubmit).toHaveBeenCalledWith("密码🔑pass");
  });

  it("[BOUNDARY] handles very long password (256 chars)", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const longPassword = "A".repeat(256);
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, longPassword);
    fireEvent.click(screen.getByTestId("auth-submit"));

    expect(onSubmit).toHaveBeenCalledWith(longPassword);
  });

  it("[EDGE] password field has type='password' to mask input", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it("[EDGE] displays multiple auth methods in prompt payload", () => {
    const multiMethodPrompt: AuthPromptPayload = {
      username: "netadmin",
      methods: ["publickey", "password", "keyboard-interactive"],
    };
    render(
      <AuthPromptDialog
        authPrompt={multiMethodPrompt}
        host="core-switch.dc1"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/netadmin@core-switch\.dc1/)).toBeInTheDocument();
  });

  it("[EDGE] displays username with special characters", () => {
    const specialUserPrompt: AuthPromptPayload = {
      username: "admin@domain",
      methods: ["password"],
    };
    render(
      <AuthPromptDialog
        authPrompt={specialUserPrompt}
        host="server.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/admin@domain@server\.local/)).toBeInTheDocument();
  });

  it("[EDGE] label element is associated with password input via htmlFor", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const label = screen.getByText("Password:");
    expect(label).toHaveAttribute("for", "ssh-password");
    const input = screen.getByTestId("auth-password-input");
    expect(input).toHaveAttribute("id", "ssh-password");
  });

  it("[EDGE] multiple rapid submit clicks only call onSubmit once", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "quick");
    const submitBtn = screen.getByTestId("auth-submit");
    fireEvent.click(submitBtn);

    // After first click, password is cleared → button disabled → second click is no-op
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ─── HostKeyDialog Edge Cases ────────────────────────────

describe("HostKeyDialog — Edge Cases", () => {
  let onAccept: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAccept = vi.fn();
    onReject = vi.fn();
  });

  it("[EDGE] falls back to hostKey.host when host prop is omitted", () => {
    const hostKey: HostKeyPayload = {
      host: "fallback.host.local",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(/fallback\.host\.local:22/)).toBeInTheDocument();
  });

  it("[EDGE] host prop overrides hostKey.host", () => {
    const hostKey: HostKeyPayload = {
      host: "internal.ip",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        host="display.name.local"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(/display\.name\.local:22/)).toBeInTheDocument();
  });

  it("[EDGE] displays non-standard port correctly", () => {
    const hostKey: HostKeyPayload = {
      host: "server.example.com",
      port: 2222,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(/server\.example\.com:2222/)).toBeInTheDocument();
  });

  it("[BOUNDARY] displays very long fingerprint without breaking", () => {
    const longFingerprint =
      "SHA256:" + "A".repeat(64);
    const hostKey: HostKeyPayload = {
      host: "server.local",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: longFingerprint,
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(longFingerprint)).toBeInTheDocument();
  });

  it("[EDGE] handles changed key without expectedFingerprint gracefully", () => {
    const hostKey: HostKeyPayload = {
      host: "server.local",
      port: 22,
      keyType: "ssh-rsa",
      fingerprint: "SHA256:new",
      action: "changed",
      // expectedFingerprint intentionally omitted
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );

    // Should still show warning
    expect(screen.getByText(/HOST KEY CHANGED/i)).toBeInTheDocument();
    // Should NOT crash when expectedFingerprint is missing
    expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();
  });

  it("[EDGE] button text is 'Accept & Connect' for new, 'Accept Anyway' for changed", () => {
    const newKey: HostKeyPayload = {
      host: "a.local",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:new",
      action: "new",
    };
    const { unmount } = render(
      <HostKeyDialog
        hostKey={newKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByTestId("hostkey-accept")).toHaveTextContent(
      "Accept & Connect",
    );
    unmount();

    const changedKey: HostKeyPayload = {
      host: "b.local",
      port: 22,
      keyType: "ssh-rsa",
      fingerprint: "SHA256:changed",
      action: "changed",
      expectedFingerprint: "SHA256:old",
    };
    render(
      <HostKeyDialog
        hostKey={changedKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByTestId("hostkey-accept")).toHaveTextContent(
      "Accept Anyway",
    );
  });

  it("[EDGE] accept button has primary class for new, danger class for changed", () => {
    const newKey: HostKeyPayload = {
      host: "a.local",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    const { unmount } = render(
      <HostKeyDialog
        hostKey={newKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByTestId("hostkey-accept").className,
    ).toContain("terminal-dialog-btn-primary");
    expect(
      screen.getByTestId("hostkey-accept").className,
    ).not.toContain("terminal-dialog-btn-danger");
    unmount();

    const changedKey: HostKeyPayload = {
      host: "b.local",
      port: 22,
      keyType: "ssh-rsa",
      fingerprint: "SHA256:test2",
      action: "changed",
      expectedFingerprint: "SHA256:old",
    };
    render(
      <HostKeyDialog
        hostKey={changedKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByTestId("hostkey-accept").className,
    ).toContain("terminal-dialog-btn-danger");
    expect(
      screen.getByTestId("hostkey-accept").className,
    ).not.toContain("terminal-dialog-btn-primary");
  });

  it("[EDGE] displays unknown key types without crashing", () => {
    const hostKey: HostKeyPayload = {
      host: "server.local",
      port: 22,
      keyType: "ssh-unknown-future-type",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText("ssh-unknown-future-type"),
    ).toBeInTheDocument();
  });

  it("[BOUNDARY] handles IPv6 host address display", () => {
    const hostKey: HostKeyPayload = {
      host: "::1",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(/::1:22/)).toBeInTheDocument();
  });
});

// ─── ConnectionTerminalView Edge Cases ───────────────────

describe("ConnectionTerminalView — Edge Cases", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue("edge-conn-001");
    mockListen.mockReset().mockImplementation(
      (eventName: string, handler: EventHandler) => {
        eventListeners.set(eventName, handler);
        return Promise.resolve(vi.fn());
      },
    );
    eventListeners.clear();
  });

  afterEach(() => {
    eventListeners.clear();
  });

  it("[EDGE] malformed JSON in hostkey event is silently ignored", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={sshConfig} />);
    });

    // Send malformed JSON — should not crash
    await act(async () => {
      emitEvent("connection-hostkey-edge-conn-001", "not-valid-json{{{");
    });

    // Component should still be rendered, no dialog shown
    expect(screen.getByTestId("connection-wrapper")).toBeInTheDocument();
    expect(screen.queryByTestId("hostkey-dialog")).not.toBeInTheDocument();
  });

  it("[EDGE] malformed JSON in auth-prompt event is silently ignored", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={sshConfig} />);
    });

    await act(async () => {
      emitEvent("connection-auth-prompt-edge-conn-001", "<<<INVALID>>>");
    });

    expect(screen.getByTestId("connection-wrapper")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-prompt-dialog")).not.toBeInTheDocument();
  });

  it("[EDGE] shows 'host' fallback when config.host is undefined", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const noHostConfig: ConnectionOpenInput = {
      protocol: "ssh",
      cols: 80,
      rows: 24,
    };
    render(<ConnectionTerminalView connectionConfig={noHostConfig} />);

    expect(screen.getByTestId("connection-loading")).toHaveTextContent(
      "Connecting to host",
    );
  });

  it("[EDGE] handles empty host string in config", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const emptyHostConfig: ConnectionOpenInput = {
      host: "",
      protocol: "ssh",
      cols: 80,
      rows: 24,
    };
    render(<ConnectionTerminalView connectionConfig={emptyHostConfig} />);

    // Empty string is falsy but not undefined — React shows empty
    const loading = screen.getByTestId("connection-loading");
    expect(loading).toBeInTheDocument();
  });

  it("[EDGE] error status event without message shows default text", async () => {
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
      emitEvent("connection-status-edge-conn-001", {
        status: "error",
        // no message field
      });
    });

    expect(onStatusChange).toHaveBeenCalledWith("error", undefined);
  });

  it("[EDGE] disconnect status without message uses default", async () => {
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
      emitEvent("connection-status-edge-conn-001", {
        status: "disconnected",
      });
    });

    expect(onStatusChange).toHaveBeenCalledWith("disconnected", undefined);
  });

  it("[EDGE] multiple reconnect attempts don't create orphan connections", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("First fail"))
      .mockRejectedValueOnce(new Error("Second fail"))
      .mockResolvedValue("edge-conn-success");

    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={sshConfig} />);
    });

    // First reconnect
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    });

    // Second reconnect
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    });

    // Should have called connection_open 3 times (initial + 2 reconnects)
    const openCalls = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === "connection_open",
    );
    expect(openCalls).toHaveLength(3);
  });

  it("[EDGE] host key dialog renders in hostkey-warning event (MITM path)", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={sshConfig} />);
    });

    // Use the warning-specific event (different from hostkey event)
    await act(async () => {
      emitEvent("connection-hostkey-warning-edge-conn-001", JSON.stringify({
        host: "switch.lab.local",
        port: 22,
        keyType: "ssh-rsa",
        fingerprint: "SHA256:bad",
        action: "changed",
        expectedFingerprint: "SHA256:good",
      }));
    });

    expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();
    expect(screen.getByText(/HOST KEY CHANGED/i)).toBeInTheDocument();
  });

  it("[BOUNDARY] handles port 0 in host key display", () => {
    const hostKey: HostKeyPayload = {
      host: "server",
      port: 0,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/server:0/)).toBeInTheDocument();
  });

  it("[BOUNDARY] handles max port (65535) in host key display", () => {
    const hostKey: HostKeyPayload = {
      host: "server",
      port: 65535,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:test",
      action: "new",
    };
    render(
      <HostKeyDialog
        hostKey={hostKey}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/server:65535/)).toBeInTheDocument();
  });
});
