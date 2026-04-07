/**
 * Component tests for the PingDashboard, InterfaceStatus, and MacArpViewer.
 *
 * Tests rendering, user interactions, and state management.
 *
 * Tags: [TDD], [COMPONENT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock Tauri invoke and listen
const mockInvoke = vi.fn();
const mockListen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { PingDashboard } from "../components/Ping/PingDashboard";
import { InterfaceStatus } from "../components/InterfaceStatus/InterfaceStatus";
import { MacArpViewer } from "../components/MacArpViewer/MacArpViewer";
import { BackupButton } from "../components/Backup/BackupButton";

describe("PingDashboard", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockListen.mockResolvedValue(vi.fn()); // unlisten function
  });

  it("renders with title and input", () => {
    render(<PingDashboard />);
    expect(screen.getByText("Ping Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("ping-target-input")).toBeInTheDocument();
    expect(screen.getByTestId("ping-add-btn")).toBeInTheDocument();
  });

  it("adds a target when Add is clicked", () => {
    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));

    expect(screen.getByText("8.8.8.8")).toBeInTheDocument();
  });

  it("adds a target on Enter key", () => {
    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "1.1.1.1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
  });

  it("does not add duplicate targets", () => {
    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");

    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));

    // Should have exactly one 8.8.8.8
    const tags = screen.getAllByText("8.8.8.8");
    expect(tags).toHaveLength(1);
  });

  it("removes a target when × is clicked", () => {
    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));

    const removeBtn = screen.getByLabelText("Remove 8.8.8.8");
    fireEvent.click(removeBtn);

    expect(screen.queryByText("8.8.8.8")).not.toBeInTheDocument();
  });

  it("disables Start when no targets", () => {
    render(<PingDashboard />);
    expect(screen.getByTestId("ping-start-btn")).toBeDisabled();
  });

  it("enables Start when targets exist", () => {
    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));

    expect(screen.getByTestId("ping-start-btn")).not.toBeDisabled();
  });

  it("calls pingStart on Start click", async () => {
    mockInvoke.mockResolvedValue("session-123");

    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));
    fireEvent.click(screen.getByTestId("ping-start-btn"));

    // Wait for the invoke to be called
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("ping_start", {
        request: {
          targets: ["8.8.8.8"],
          count: 4,
          interval: 1.0,
        },
      });
    });
  });

  it("shows error on start failure", async () => {
    mockInvoke.mockRejectedValue("Invalid target");

    render(<PingDashboard />);
    const input = screen.getByTestId("ping-target-input");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByTestId("ping-add-btn"));
    fireEvent.click(screen.getByTestId("ping-start-btn"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("ping-error")).toBeInTheDocument();
    });
  });
});

describe("InterfaceStatus", () => {
  it("renders with title and textarea", () => {
    render(<InterfaceStatus />);
    expect(screen.getByText("Interface Status")).toBeInTheDocument();
    expect(screen.getByTestId("intf-textarea")).toBeInTheDocument();
  });

  it("parses Cisco output and shows table", () => {
    render(<InterfaceStatus />);
    const textarea = screen.getByTestId("intf-textarea");
    const ciscoOutput = `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0     192.168.1.1     YES manual up                    up
GigabitEthernet0/1     unassigned      YES unset  administratively down down`;

    fireEvent.change(textarea, { target: { value: ciscoOutput } });
    fireEvent.click(screen.getByTestId("intf-parse-btn"));

    expect(screen.getByTestId("intf-table")).toBeInTheDocument();
    expect(screen.getByTestId("intf-vendor")).toHaveTextContent("CISCO");
  });

  it("shows no results for garbage input", () => {
    render(<InterfaceStatus />);
    const textarea = screen.getByTestId("intf-textarea");
    fireEvent.change(textarea, { target: { value: "some random text\nwith no structure" } });
    fireEvent.click(screen.getByTestId("intf-parse-btn"));

    // Should not show table since vendor is "unknown" and parse returns []
    expect(screen.queryByTestId("intf-table")).not.toBeInTheDocument();
  });

  it("clears output on Clear click", () => {
    render(<InterfaceStatus />);
    const textarea = screen.getByTestId("intf-textarea");
    fireEvent.change(textarea, { target: { value: "some text" } });
    fireEvent.click(screen.getByTestId("intf-clear-btn"));

    expect(textarea).toHaveValue("");
  });

  it("disables Parse when textarea is empty", () => {
    render(<InterfaceStatus />);
    expect(screen.getByTestId("intf-parse-btn")).toBeDisabled();
  });
});

describe("MacArpViewer", () => {
  it("renders with title and textarea", () => {
    render(<MacArpViewer />);
    expect(screen.getByText("MAC / ARP Table Viewer")).toBeInTheDocument();
    expect(screen.getByTestId("macarp-textarea")).toBeInTheDocument();
  });

  it("parses MAC table and shows results", () => {
    render(<MacArpViewer />);
    const textarea = screen.getByTestId("macarp-textarea");
    const macOutput = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
  10    0050.7966.6800    DYNAMIC     Gi0/1
  20    000c.29ab.cdef    DYNAMIC     Gi0/2`;

    fireEvent.change(textarea, { target: { value: macOutput } });
    fireEvent.click(screen.getByTestId("macarp-parse-btn"));

    expect(screen.getByTestId("macarp-table")).toBeInTheDocument();
    expect(screen.getByTestId("macarp-mode")).toHaveTextContent("MAC TABLE");
  });

  it("parses ARP table and shows results", () => {
    render(<MacArpViewer />);
    const textarea = screen.getByTestId("macarp-textarea");
    const arpOutput = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   0050.7966.6800  ARPA   GigabitEthernet0/0`;

    fireEvent.change(textarea, { target: { value: arpOutput } });
    fireEvent.click(screen.getByTestId("macarp-parse-btn"));

    expect(screen.getByTestId("macarp-table")).toBeInTheDocument();
    expect(screen.getByTestId("macarp-mode")).toHaveTextContent("ARP TABLE");
  });

  it("filters entries with search", () => {
    render(<MacArpViewer />);
    const textarea = screen.getByTestId("macarp-textarea");
    const macOutput = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
  10    0050.7966.6800    DYNAMIC     Gi0/1
  20    000c.29ab.cdef    DYNAMIC     Gi0/2`;

    fireEvent.change(textarea, { target: { value: macOutput } });
    fireEvent.click(screen.getByTestId("macarp-parse-btn"));

    const searchInput = screen.getByTestId("macarp-search");
    fireEvent.change(searchInput, { target: { value: "VMware" } });

    // Should show only VMware entry
    const rows = screen.getByTestId("macarp-table").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
  });

  it("clears on Clear click", () => {
    render(<MacArpViewer />);
    const textarea = screen.getByTestId("macarp-textarea");
    fireEvent.change(textarea, { target: { value: "some text" } });
    fireEvent.click(screen.getByTestId("macarp-clear-btn"));

    expect(textarea).toHaveValue("");
  });
});

describe("BackupButton", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders backup button", () => {
    render(<BackupButton getTerminalContent={() => ""} />);
    expect(screen.getByTestId("backup-btn")).toBeInTheDocument();
    expect(screen.getByTestId("backup-btn")).toHaveTextContent("💾 Backup");
  });

  it("shows error on empty content", async () => {
    render(<BackupButton getTerminalContent={() => ""} />);
    fireEvent.click(screen.getByTestId("backup-btn"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("backup-error")).toHaveTextContent(
        "No terminal content to backup",
      );
    });
  });

  it("calls save_backup on click with content", async () => {
    mockInvoke.mockResolvedValue({ path: "/test/backup.txt", size: 100 });

    render(
      <BackupButton
        getTerminalContent={() => "hostname router1"}
        hostname="router1"
      />,
    );
    fireEvent.click(screen.getByTestId("backup-btn"));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_backup", {
        request: {
          hostname: "router1",
          content: "hostname router1",
        },
      });
    });
  });

  it("shows success after backup", async () => {
    mockInvoke.mockResolvedValue({ path: "/test/backup.txt", size: 2048 });

    render(
      <BackupButton
        getTerminalContent={() => "some config"}
        hostname="switch1"
      />,
    );
    fireEvent.click(screen.getByTestId("backup-btn"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("backup-success")).toBeInTheDocument();
    });
  });

  it("shows error on backend failure", async () => {
    mockInvoke.mockRejectedValue("Failed to write backup file");

    render(
      <BackupButton
        getTerminalContent={() => "some config"}
        hostname="router1"
      />,
    );
    fireEvent.click(screen.getByTestId("backup-btn"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("backup-error")).toHaveTextContent(
        "Failed to write backup file",
      );
    });
  });
});
