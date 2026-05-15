import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../hooks/useSwarmRoster", async () => {
  const actual = await vi.importActual<
    typeof import("../hooks/useSwarmRoster")
  >("../hooks/useSwarmRoster");
  return {
    ...actual,
    useSwarmRoster: () => [],
  };
});

import { SwarmSidebar } from "../components/Swarm/SwarmSidebar";
import type { Colleague } from "../hooks/useSwarmRoster";

function makeColleague(
  id: string,
  overrides: Partial<Colleague> = {},
): Colleague {
  return {
    id,
    name: id,
    tab_id: `tab-${id}`,
    cwd: "/x/y",
    status: "Idle",
    command_status: "idle",
    last_ten_exit_codes: [],
    last_heartbeat_ms: Date.now(),
    ...overrides,
  };
}

describe("SwarmSidebar", () => {
  it("renders nothing when position is hidden", () => {
    const { container } = render(
      <SwarmSidebar
        position="hidden"
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders empty state when roster is empty", () => {
    render(<SwarmSidebar rosterOverride={[]} onFocusTab={vi.fn()} />);
    expect(screen.getByTestId("swarm-sidebar-empty")).toBeInTheDocument();
  });

  it("lists colleagues from the override", () => {
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice"), makeColleague("bob")]}
        onFocusTab={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("colleague-row");
    expect(rows).toHaveLength(2);
  });

  it("renders count in header", () => {
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("a"), makeColleague("b")]}
        onFocusTab={vi.fn()}
      />,
    );
    expect(screen.getByText("Swarm (2)")).toBeInTheDocument();
  });

  it("uses position prop on data-position attribute", () => {
    render(
      <SwarmSidebar
        position="right"
        rosterOverride={[]}
        onFocusTab={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swarm-sidebar")).toHaveAttribute(
      "data-position",
      "right",
    );
  });

  it("invokes collapse callback", () => {
    const onToggle = vi.fn();
    render(
      <SwarmSidebar
        rosterOverride={[]}
        onFocusTab={vi.fn()}
        onToggleCollapsed={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("swarm-sidebar-collapse"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("opens context menu on right-click", () => {
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("colleague-row"));
    expect(screen.getByTestId("swarm-colleague-menu")).toBeInTheDocument();
    expect(screen.getByTestId("menu-send-notify")).toBeInTheDocument();
    expect(screen.getByTestId("menu-disconnect")).toBeInTheDocument();
    expect(screen.getByTestId("menu-copy-id")).toBeInTheDocument();
  });

  it("invokes onDisconnect from context menu", () => {
    const onDisconnect = vi.fn();
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={vi.fn()}
        onDisconnect={onDisconnect}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("colleague-row"));
    fireEvent.click(screen.getByTestId("menu-disconnect"));
    expect(onDisconnect).toHaveBeenCalled();
    expect(onDisconnect.mock.calls[0][0].id).toBe("alice");
  });

  it("submits a notify message via the inline form", () => {
    const onSendNotify = vi.fn();
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={vi.fn()}
        onSendNotify={onSendNotify}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("colleague-row"));
    fireEvent.click(screen.getByTestId("menu-send-notify"));
    const input = screen.getByTestId("menu-notify-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ping" } });
    fireEvent.click(screen.getByTestId("menu-notify-submit"));
    expect(onSendNotify).toHaveBeenCalled();
    expect(onSendNotify.mock.calls[0][0].id).toBe("alice");
    expect(onSendNotify.mock.calls[0][1]).toBe("ping");
  });

  it("copies colleague id to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("colleague-row"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("menu-copy-id"));
    });
    expect(writeText).toHaveBeenCalledWith("alice");
  });

  it("invokes onFocusTab when row clicked", () => {
    const onFocusTab = vi.fn();
    render(
      <SwarmSidebar
        rosterOverride={[makeColleague("alice")]}
        onFocusTab={onFocusTab}
      />,
    );
    fireEvent.click(screen.getByTestId("colleague-row"));
    expect(onFocusTab).toHaveBeenCalledWith("tab-alice");
  });
});
