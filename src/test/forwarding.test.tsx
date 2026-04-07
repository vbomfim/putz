/**
 * Forwarding Components — Unit Tests
 *
 * Tests for ForwardingConfig, ForwardingPanel rendering,
 * forwarding types, and utility functions.
 *
 * Tags: [UNIT], [AC-1]–[AC-6]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForwardingConfig } from "../components/Forwarding/ForwardingConfig";
import { ForwardingPanel } from "../components/Forwarding/ForwardingPanel";
import type {
  ForwardingRuleInput,
  ForwardingStatus,
} from "../components/Forwarding/types";
import {
  formatBytes,
  formatForwardingRule,
  statusIndicator,
  FORWARDING_TYPE_LABELS,
} from "../components/Forwarding/types";

// ─── Mock setup ────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// ── Type / Utility Tests ─────────────────────────────────────────

describe("Forwarding Types", () => {
  describe("formatBytes", () => {
    it("formats bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2560)).toBe("2.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1048576)).toBe("1.0 MB");
      expect(formatBytes(5242880)).toBe("5.0 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(1073741824)).toBe("1.0 GB");
    });
  });

  describe("formatForwardingRule", () => {
    it("formats local forward", () => {
      const rule: ForwardingRuleInput = {
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "db.internal",
        remotePort: 5432,
      };
      expect(formatForwardingRule(rule)).toBe(
        "127.0.0.1:8080 → db.internal:5432",
      );
    });

    it("formats remote forward", () => {
      const rule: ForwardingRuleInput = {
        forwardingType: "remote",
        localPort: 3000,
        remoteHost: "0.0.0.0",
        remotePort: 8080,
      };
      expect(formatForwardingRule(rule)).toBe(
        "0.0.0.0:8080 → 127.0.0.1:3000",
      );
    });

    it("formats dynamic forward", () => {
      const rule: ForwardingRuleInput = {
        forwardingType: "dynamic",
        localPort: 1080,
      };
      expect(formatForwardingRule(rule)).toBe("127.0.0.1:1080 (SOCKS5)");
    });

    it("uses custom bind address", () => {
      const rule: ForwardingRuleInput = {
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "web",
        remotePort: 80,
        bindAddress: "192.168.1.1",
      };
      expect(formatForwardingRule(rule)).toBe(
        "192.168.1.1:8080 → web:80",
      );
    });
  });

  describe("statusIndicator", () => {
    it("returns correct indicator for each status", () => {
      expect(statusIndicator("starting")).toBe("⏳");
      expect(statusIndicator("active")).toBe("🟢");
      expect(statusIndicator("stopped")).toBe("⚪");
      expect(statusIndicator("error")).toBe("🔴");
    });
  });

  describe("FORWARDING_TYPE_LABELS", () => {
    it("has labels for all types", () => {
      expect(FORWARDING_TYPE_LABELS.local).toBe("Local (-L)");
      expect(FORWARDING_TYPE_LABELS.remote).toBe("Remote (-R)");
      expect(FORWARDING_TYPE_LABELS.dynamic).toBe("Dynamic (-D)");
    });
  });
});

// ── ForwardingConfig Tests ───────────────────────────────────────

describe("ForwardingConfig", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  it("renders with empty rules list", () => {
    render(<ForwardingConfig rules={[]} onChange={onChange} />);
    expect(screen.getByText("Port Forwarding")).toBeDefined();
    expect(screen.getByTestId("forwarding-add-form")).toBeDefined();
  });

  it("renders existing rules", () => {
    const rules: ForwardingRuleInput[] = [
      {
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "db.internal",
        remotePort: 5432,
      },
      {
        forwardingType: "dynamic",
        localPort: 1080,
      },
    ];
    render(<ForwardingConfig rules={rules} onChange={onChange} />);
    expect(screen.getByTestId("forwarding-rules-list")).toBeDefined();
    expect(screen.getAllByText("Local (-L)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Dynamic (-D)").length).toBeGreaterThanOrEqual(1);
  });

  it("removes a rule when remove button is clicked", async () => {
    const rules: ForwardingRuleInput[] = [
      {
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "db",
        remotePort: 5432,
      },
    ];
    render(<ForwardingConfig rules={rules} onChange={onChange} />);

    const removeBtn = screen.getByTestId("remove-rule-0");
    await userEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("hides add form when disabled", () => {
    render(
      <ForwardingConfig rules={[]} onChange={onChange} disabled={true} />,
    );
    expect(screen.queryByTestId("forwarding-add-form")).toBeNull();
  });

  it("hides remove buttons when disabled", () => {
    const rules: ForwardingRuleInput[] = [
      {
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "h",
        remotePort: 80,
      },
    ];
    render(
      <ForwardingConfig rules={rules} onChange={onChange} disabled={true} />,
    );
    expect(screen.queryByTestId("remove-rule-0")).toBeNull();
  });

  it("shows remote fields for local forwarding type", () => {
    render(<ForwardingConfig rules={[]} onChange={onChange} />);
    expect(screen.getByTestId("remote-host-input")).toBeDefined();
    expect(screen.getByTestId("remote-port-input")).toBeDefined();
  });

  it("hides remote fields for dynamic forwarding type", async () => {
    render(<ForwardingConfig rules={[]} onChange={onChange} />);
    const select = screen.getByTestId("forwarding-type-select");
    await userEvent.selectOptions(select, "dynamic");
    expect(screen.queryByTestId("remote-host-input")).toBeNull();
    expect(screen.queryByTestId("remote-port-input")).toBeNull();
  });

  it("shows security warning for 0.0.0.0 bind address", async () => {
    render(<ForwardingConfig rules={[]} onChange={onChange} />);

    // Fill in required fields
    await userEvent.type(screen.getByTestId("local-port-input"), "8080");
    await userEvent.type(screen.getByTestId("remote-host-input"), "db");
    await userEvent.type(screen.getByTestId("remote-port-input"), "5432");
    await userEvent.type(screen.getByTestId("bind-address-input"), "0.0.0.0");

    // First click shows warning
    await userEvent.click(screen.getByTestId("add-rule-btn"));
    expect(screen.getByTestId("security-warning")).toBeDefined();

    // Second click adds the rule
    await userEvent.click(screen.getByTestId("add-rule-btn"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ── ForwardingPanel Tests ────────────────────────────────────────

describe("ForwardingPanel", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ForwardingPanel connectionId="conn-1" />);
    expect(screen.getByText(/Loading/)).toBeDefined();
  });

  it("shows empty state when no tunnels", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ForwardingPanel connectionId="conn-1" />);
    expect(
      await screen.findByTestId("empty-state"),
    ).toBeDefined();
  });

  it("renders tunnel table with data", async () => {
    const tunnels: ForwardingStatus[] = [
      {
        id: "t1",
        connectionId: "conn-1",
        forwardingType: "local",
        localPort: 8080,
        remoteHost: "db.internal",
        remotePort: 5432,
        bindAddress: "127.0.0.1",
        bytesTx: 1048576,
        bytesRx: 2097152,
        activeConnections: 2,
        status: "active",
      },
    ];
    mockInvoke.mockResolvedValue(tunnels);

    render(<ForwardingPanel connectionId="conn-1" />);

    const table = await screen.findByTestId("tunnel-table");
    expect(table).toBeDefined();
    expect(screen.getByText("Local (-L)")).toBeDefined();
    expect(screen.getByText("127.0.0.1:8080")).toBeDefined();
    expect(screen.getByText("db.internal:5432")).toBeDefined();
    expect(screen.getByText("1.0 MB")).toBeDefined();
    expect(screen.getByText("2.0 MB")).toBeDefined();
  });

  it("shows tunnel count", async () => {
    const tunnels: ForwardingStatus[] = [
      {
        id: "t1",
        connectionId: "conn-1",
        forwardingType: "dynamic",
        localPort: 1080,
        bindAddress: "127.0.0.1",
        bytesTx: 0,
        bytesRx: 0,
        activeConnections: 0,
        status: "active",
      },
      {
        id: "t2",
        connectionId: "conn-1",
        forwardingType: "local",
        localPort: 3306,
        remoteHost: "mysql",
        remotePort: 3306,
        bindAddress: "127.0.0.1",
        bytesTx: 0,
        bytesRx: 0,
        activeConnections: 0,
        status: "active",
      },
    ];
    mockInvoke.mockResolvedValue(tunnels);

    render(<ForwardingPanel connectionId="conn-1" />);
    expect(await screen.findByText("2 tunnels")).toBeDefined();
  });

  it("toggles add form on button click", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ForwardingPanel connectionId="conn-1" />);

    await screen.findByTestId("empty-state");
    const btn = screen.getByTestId("toggle-add-form");

    await userEvent.click(btn);
    expect(screen.getByTestId("adhoc-form")).toBeDefined();

    await userEvent.click(btn);
    expect(screen.queryByTestId("adhoc-form")).toBeNull();
  });

  it("calls onClose when close button clicked", async () => {
    mockInvoke.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<ForwardingPanel connectionId="conn-1" onClose={onClose} />);

    await screen.findByTestId("empty-state");
    const closeBtn = screen.getByTitle("Close panel");
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("shows error banner on API failure", async () => {
    mockInvoke.mockRejectedValue("Connection lost");
    render(<ForwardingPanel connectionId="conn-1" />);

    expect(await screen.findByTestId("error-banner")).toBeDefined();
    expect(screen.getByText("Connection lost")).toBeDefined();
  });
});

// ── Contract Tests (IPC Serialization) ───────────────────────────

describe("Forwarding IPC Contract", () => {
  it("ForwardingRuleInput has correct shape for local forward", () => {
    const rule: ForwardingRuleInput = {
      forwardingType: "local",
      localPort: 8080,
      remoteHost: "db.internal",
      remotePort: 5432,
    };
    expect(rule.forwardingType).toBe("local");
    expect(rule.localPort).toBe(8080);
    expect(rule.remoteHost).toBe("db.internal");
    expect(rule.remotePort).toBe(5432);
    expect(rule.bindAddress).toBeUndefined();
  });

  it("ForwardingRuleInput allows optional fields", () => {
    const rule: ForwardingRuleInput = {
      forwardingType: "dynamic",
      localPort: 1080,
    };
    expect(rule.remoteHost).toBeUndefined();
    expect(rule.remotePort).toBeUndefined();
  });

  it("ForwardingStatus has all required fields", () => {
    const status: ForwardingStatus = {
      id: "uuid",
      connectionId: "conn-uuid",
      forwardingType: "local",
      localPort: 8080,
      remoteHost: "host",
      remotePort: 80,
      bindAddress: "127.0.0.1",
      bytesTx: 0,
      bytesRx: 0,
      activeConnections: 0,
      status: "active",
    };
    expect(status.id).toBe("uuid");
    expect(status.error).toBeUndefined();
  });

  it("ForwardingStatus error field is optional", () => {
    const status: ForwardingStatus = {
      id: "uuid",
      connectionId: "conn-uuid",
      forwardingType: "local",
      localPort: 8080,
      bindAddress: "127.0.0.1",
      bytesTx: 0,
      bytesRx: 0,
      activeConnections: 0,
      status: "error",
      error: "port in use",
    };
    expect(status.error).toBe("port in use");
  });
});
