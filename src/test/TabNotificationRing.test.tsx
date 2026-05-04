import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabNotificationRing } from "../components/Swarm/TabNotificationRing";
import {
  useSwarmInboxStore,
  _resetSwarmInboxStoreForTests,
} from "../stores/swarmInboxStore";

describe("TabNotificationRing", () => {
  beforeEach(() => {
    _resetSwarmInboxStoreForTests();
  });

  it("renders nothing when there are no unread entries", () => {
    const { container } = render(<TabNotificationRing tabId="tab-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders count and severity for unread entries", () => {
    useSwarmInboxStore.getState().addNotification({
      colleagueId: "alice",
      tabId: "tab-1",
      severity: "normal",
      message: "hi",
      timestampMs: 1000,
    });
    render(<TabNotificationRing tabId="tab-1" />);
    const ring = screen.getByTestId("swarm-tab-ring");
    expect(ring).toHaveAttribute("data-count", "1");
    expect(ring).toHaveAttribute("data-severity", "normal");
    expect(ring.textContent).toBe("1");
  });

  it("escalates color to highest unread severity", () => {
    const s = useSwarmInboxStore.getState();
    s.addNotification({
      colleagueId: "a",
      tabId: "tab-1",
      severity: "ambient",
      message: "x",
      timestampMs: 1,
    });
    s.addNotification({
      colleagueId: "a",
      tabId: "tab-1",
      severity: "urgent",
      message: "y",
      timestampMs: 2,
    });
    render(<TabNotificationRing tabId="tab-1" />);
    expect(screen.getByTestId("swarm-tab-ring")).toHaveAttribute(
      "data-severity",
      "urgent",
    );
  });

  it("clamps display to 99+ when count exceeds 99", () => {
    const s = useSwarmInboxStore.getState();
    for (let i = 0; i < 105; i++) {
      s.addNotification({
        colleagueId: "a",
        tabId: "tab-1",
        severity: "normal",
        message: `m${i}`,
        timestampMs: i,
      });
    }
    render(<TabNotificationRing tabId="tab-1" />);
    expect(screen.getByTestId("swarm-tab-ring").textContent).toBe("99+");
  });

  it("ignores other tabs' entries", () => {
    useSwarmInboxStore.getState().addNotification({
      colleagueId: "a",
      tabId: "tab-other",
      severity: "urgent",
      message: "x",
      timestampMs: 1,
    });
    const { container } = render(<TabNotificationRing tabId="tab-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears when all entries for the tab are marked read", () => {
    const s = useSwarmInboxStore.getState();
    s.addNotification({
      colleagueId: "a",
      tabId: "tab-1",
      severity: "normal",
      message: "x",
      timestampMs: 1,
    });
    s.markAllReadForTab("tab-1");
    const { container } = render(<TabNotificationRing tabId="tab-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("provides accessible aria-label including count and severity", () => {
    useSwarmInboxStore.getState().addNotification({
      colleagueId: "a",
      tabId: "tab-1",
      severity: "urgent",
      message: "x",
      timestampMs: 1,
    });
    render(<TabNotificationRing tabId="tab-1" />);
    expect(
      screen.getByLabelText("1 unread urgent notification"),
    ).toBeInTheDocument();
  });
});
