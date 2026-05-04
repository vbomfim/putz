import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  InboxPanel,
  formatRelativeTime,
} from "../components/Swarm/InboxPanel";
import {
  useSwarmInboxStore,
  _resetSwarmInboxStoreForTests,
} from "../stores/swarmInboxStore";

describe("formatRelativeTime", () => {
  it("returns 'just now' for ≤1s delta", () => {
    expect(formatRelativeTime(1000, 1500)).toBe("just now");
  });
  it("returns seconds", () => {
    expect(formatRelativeTime(0, 30_000)).toBe("30s ago");
  });
  it("returns minutes", () => {
    expect(formatRelativeTime(0, 120_000)).toBe("2m ago");
  });
  it("returns hours", () => {
    expect(formatRelativeTime(0, 3 * 3600 * 1000)).toBe("3h ago");
  });
  it("returns days", () => {
    expect(formatRelativeTime(0, 2 * 86_400_000)).toBe("2d ago");
  });
  it("clamps future timestamps to just now", () => {
    expect(formatRelativeTime(2000, 1000)).toBe("just now");
  });
});

describe("InboxPanel", () => {
  beforeEach(() => {
    _resetSwarmInboxStoreForTests();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <InboxPanel open={false} onClose={vi.fn()} onFocusTab={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders empty state with no entries", () => {
    render(<InboxPanel open={true} onClose={vi.fn()} onFocusTab={vi.fn()} />);
    expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
  });

  it("groups entries by colleague", () => {
    const s = useSwarmInboxStore.getState();
    s.addNotification({
      colleagueId: "alice",
      tabId: "t1",
      severity: "normal",
      message: "from alice",
      timestampMs: 1,
    });
    s.addNotification({
      colleagueId: "bob",
      tabId: "t2",
      severity: "normal",
      message: "from bob",
      timestampMs: 2,
    });
    render(
      <InboxPanel
        open={true}
        onClose={vi.fn()}
        onFocusTab={vi.fn()}
        nowMs={10_000}
      />,
    );
    expect(screen.getByTestId("inbox-group-alice")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-group-bob")).toBeInTheDocument();
    expect(screen.getByText("from alice")).toBeInTheDocument();
    expect(screen.getByText("from bob")).toBeInTheDocument();
  });

  it("clicking entry focuses tab and marks read", () => {
    const onFocusTab = vi.fn();
    useSwarmInboxStore.getState().addNotification({
      colleagueId: "a",
      tabId: "tab-1",
      severity: "normal",
      message: "hi",
      timestampMs: 1,
    });
    render(
      <InboxPanel open={true} onClose={vi.fn()} onFocusTab={onFocusTab} />,
    );
    fireEvent.click(screen.getByTestId("inbox-entry"));
    expect(onFocusTab).toHaveBeenCalledWith("tab-1");
    expect(useSwarmInboxStore.getState().entries[0].read).toBe(true);
  });

  it("Mark all read flips every entry", () => {
    const s = useSwarmInboxStore.getState();
    s.addNotification({
      colleagueId: "a",
      tabId: "t1",
      severity: "normal",
      message: "x",
      timestampMs: 1,
    });
    s.addNotification({
      colleagueId: "b",
      tabId: "t2",
      severity: "urgent",
      message: "y",
      timestampMs: 2,
    });
    render(
      <InboxPanel open={true} onClose={vi.fn()} onFocusTab={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("inbox-mark-all-read"));
    expect(useSwarmInboxStore.getState().entries.every((e) => e.read)).toBe(true);
  });

  it("ESC key closes the panel", () => {
    const onClose = vi.fn();
    render(<InboxPanel open={true} onClose={onClose} onFocusTab={vi.fn()} />);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("close button closes the panel", () => {
    const onClose = vi.fn();
    render(<InboxPanel open={true} onClose={onClose} onFocusTab={vi.fn()} />);
    fireEvent.click(screen.getByTestId("inbox-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking overlay closes the panel", () => {
    const onClose = vi.fn();
    render(<InboxPanel open={true} onClose={onClose} onFocusTab={vi.fn()} />);
    fireEvent.click(screen.getByTestId("swarm-inbox-overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("dialog element has role=dialog and aria-modal", () => {
    render(<InboxPanel open={true} onClose={vi.fn()} onFocusTab={vi.fn()} />);
    const dialog = screen.getByTestId("swarm-inbox-panel");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
