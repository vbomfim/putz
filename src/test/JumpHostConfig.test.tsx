/**
 * JumpHostConfig component tests.
 *
 * Tests the jump host selection dropdown, chain visualization,
 * and integration with SessionEditor.
 *
 * Tags: [AC-3], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JumpHostConfig } from "../components/SessionManager/JumpHostConfig";
import type { SessionNode } from "../components/SessionManager/types";

// ── Mock Tauri IPC ──────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Test fixtures ───────────────────────────────────────────────────

const mockSessionTree: SessionNode[] = [
  {
    type: "session",
    id: "bastion-1",
    name: "Bastion-1",
    protocol: "ssh",
    host: "10.0.0.1",
    port: 22,
    username: "admin",
  },
  {
    type: "session",
    id: "jumpbox-2",
    name: "JumpBox-2",
    protocol: "ssh",
    host: "10.0.1.1",
    port: 22,
    username: "admin",
  },
  {
    type: "session",
    id: "telnet-host",
    name: "Telnet-Host",
    protocol: "telnet",
    host: "10.0.2.1",
    port: 23,
    username: "admin",
  },
  {
    type: "folder",
    id: "folder-1",
    name: "Production",
    parentId: "root",
    sortOrder: 0,
    expanded: true,
    children: [
      {
        type: "session",
        id: "prod-bastion",
        name: "Prod-Bastion",
        protocol: "ssh",
        host: "10.1.0.1",
        port: 22,
        username: "ops",
      },
    ],
  },
];

describe("JumpHostConfig", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    mockInvoke.mockReset();
    // Default: return mock tree for session_list
    mockInvoke.mockResolvedValue(mockSessionTree);
  });

  // ─── Rendering ───────────────────────────────────────────

  it("renders loading state initially", () => {
    // Don't resolve the promise immediately
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<JumpHostConfig onChange={onChange} />);

    expect(screen.getByTestId("jump-host-loading")).toBeInTheDocument();
  });

  it("renders dropdown after loading sessions", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });
  });

  it("shows 'None' as default option", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      const select = screen.getByTestId(
        "jump-host-select",
      ) as HTMLSelectElement;
      expect(select.value).toBe("");
      expect(screen.getByText("None (direct connection)")).toBeInTheDocument();
    });
  });

  // ─── SSH filtering ───────────────────────────────────────

  it("only shows SSH sessions in dropdown", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select") as HTMLSelectElement;
    const options = Array.from(select.options);
    const optionTexts = options.map((o) => o.textContent);

    // SSH sessions should be present
    expect(optionTexts.some((t) => t?.includes("Bastion-1"))).toBe(true);
    expect(optionTexts.some((t) => t?.includes("JumpBox-2"))).toBe(true);

    // Telnet session should NOT be present
    expect(optionTexts.some((t) => t?.includes("Telnet-Host"))).toBe(false);
  });

  it("includes SSH sessions from nested folders", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select") as HTMLSelectElement;
    const options = Array.from(select.options);
    const optionTexts = options.map((o) => o.textContent);

    expect(optionTexts.some((t) => t?.includes("Prod-Bastion"))).toBe(true);
  });

  it("excludes the current session from dropdown", async () => {
    render(<JumpHostConfig onChange={onChange} currentSessionId="bastion-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select") as HTMLSelectElement;
    const options = Array.from(select.options);
    const optionTexts = options.map((o) => o.textContent);

    // Bastion-1 should NOT be present (it's the current session)
    expect(optionTexts.some((t) => t?.includes("Bastion-1"))).toBe(false);

    // Other SSH sessions should still be present
    expect(optionTexts.some((t) => t?.includes("JumpBox-2"))).toBe(true);
  });

  // ─── Selection ───────────────────────────────────────────

  it("calls onChange when jump host is selected", async () => {
    const user = userEvent.setup();
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select");
    await user.selectOptions(select, "bastion-1");

    expect(onChange).toHaveBeenCalledWith("bastion-1");
  });

  it("calls onChange with undefined when 'None' is selected", async () => {
    const user = userEvent.setup();
    render(<JumpHostConfig jumpHostId="bastion-1" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select");
    await user.selectOptions(select, "");

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("pre-selects the provided jumpHostId", async () => {
    render(<JumpHostConfig jumpHostId="bastion-1" onChange={onChange} />);

    await waitFor(() => {
      const select = screen.getByTestId(
        "jump-host-select",
      ) as HTMLSelectElement;
      expect(select.value).toBe("bastion-1");
    });
  });

  // ─── Chain visualization ─────────────────────────────────

  it("shows chain visualization when jump host is selected", async () => {
    render(<JumpHostConfig jumpHostId="bastion-1" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-chain")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection path:")).toBeInTheDocument();
    expect(screen.getByText("Bastion-1")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("does not show chain when no jump host selected", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("jump-host-chain")).not.toBeInTheDocument();
  });

  // ─── Error handling ──────────────────────────────────────

  it("handles IPC error gracefully", async () => {
    mockInvoke.mockRejectedValue(new Error("IPC error"));

    render(<JumpHostConfig onChange={onChange} />);

    // Should eventually show the dropdown even on error
    await waitFor(() => {
      expect(screen.getByTestId("jump-host-config")).toBeInTheDocument();
    });
  });

  it("shows host in dropdown option label", async () => {
    render(<JumpHostConfig onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("jump-host-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("jump-host-select") as HTMLSelectElement;
    const options = Array.from(select.options);

    // Find the Bastion-1 option
    const bastionOption = options.find((o) =>
      o.textContent?.includes("Bastion-1"),
    );
    expect(bastionOption?.textContent).toContain("10.0.0.1");
  });
});
