import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColleagueRow } from "../components/Swarm/ColleagueRow";
import { truncateCwd } from "../lib/swarm/formatters";
import type { Colleague } from "../hooks/useSwarmRoster";

function makeColleague(overrides: Partial<Colleague> = {}): Colleague {
  return {
    id: "c1",
    name: "alice",
    tab_id: "tab-1",
    cwd: "/Users/alice/dev/putz",
    status: "Idle",
    command_status: "idle",
    last_ten_exit_codes: [0, 0, 1],
    last_heartbeat_ms: Date.now(),
    ...overrides,
  };
}

describe("truncateCwd", () => {
  it("returns last 2 segments with leading ellipsis", () => {
    expect(truncateCwd("/a/b/c/d/e")).toBe("…/d/e");
  });

  it("returns full cwd when ≤ n segments", () => {
    expect(truncateCwd("/a/b")).toBe("/a/b");
  });

  it("normalizes Windows backslashes", () => {
    expect(truncateCwd("C:\\Users\\alice\\dev\\putz")).toBe("…/dev/putz");
  });

  it("returns empty for null", () => {
    expect(truncateCwd(null)).toBe("");
    expect(truncateCwd(undefined)).toBe("");
  });
});

describe("ColleagueRow", () => {
  it("renders name, status badge, exit dots, heartbeat", () => {
    render(<ColleagueRow colleague={makeColleague()} onFocus={vi.fn()} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByTestId("swarm-status-badge")).toBeInTheDocument();
    expect(screen.getByTestId("swarm-exit-dots")).toBeInTheDocument();
    expect(screen.getByTestId("swarm-heartbeat")).toBeInTheDocument();
  });

  it("invokes onFocus with tab id on click", () => {
    const onFocus = vi.fn();
    render(<ColleagueRow colleague={makeColleague()} onFocus={onFocus} />);
    fireEvent.click(screen.getByTestId("colleague-row"));
    expect(onFocus).toHaveBeenCalledWith("tab-1");
  });

  it("invokes onFocus on Enter and Space keys", () => {
    const onFocus = vi.fn();
    render(<ColleagueRow colleague={makeColleague()} onFocus={onFocus} />);
    const row = screen.getByTestId("colleague-row");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it("invokes onContextMenu and preventsDefault", () => {
    const onContextMenu = vi.fn();
    render(
      <ColleagueRow
        colleague={makeColleague()}
        onFocus={vi.fn()}
        onContextMenu={onContextMenu}
      />,
    );
    const row = screen.getByTestId("colleague-row");
    fireEvent.contextMenu(row);
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("renders compact form when collapsed", () => {
    render(
      <ColleagueRow colleague={makeColleague()} onFocus={vi.fn()} collapsed />,
    );
    // Collapsed mode is a button with the first letter only.
    const row = screen.getByTestId("colleague-row");
    expect(row.tagName).toBe("BUTTON");
    expect(row.textContent).toContain("A");
    // Status badge and full name not rendered in collapsed mode.
    expect(screen.queryByTestId("swarm-status-badge")).not.toBeInTheDocument();
  });

  it("displays truncated cwd as text", () => {
    render(
      <ColleagueRow
        colleague={makeColleague({ cwd: "/x/y/z/inner/deep" })}
        onFocus={vi.fn()}
      />,
    );
    const cwdEl = screen.getByTestId("colleague-row-cwd");
    expect(cwdEl.textContent).toBe("…/inner/deep");
    expect(cwdEl).toHaveAttribute("title", "/x/y/z/inner/deep");
  });
});
