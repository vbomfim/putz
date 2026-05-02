/**
 * Unit tests for the BroadcastBar component.
 *
 * Tests cover: rendering, hide when inactive, target count display,
 * checkbox toggles, stop button, accessibility, tab filtering.
 *
 * Tags: [TDD], [AC-broadcast]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BroadcastBar } from "../components/BroadcastBar";
import type { Tab } from "../types";

// Mock state values
let mockBroadcastState = {
  isActive: false,
  targetTabIds: new Set<string>(),
  addTab: vi.fn(),
  removeTab: vi.fn(),
  deactivate: vi.fn(),
};

let mockTabState = {
  tabs: [] as Tab[],
  activeTabId: "",
};

// Mock broadcastStore
vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    return selector(mockBroadcastState);
  }),
}));

// Mock tabStore
vi.mock("../stores/tabStore", () => ({
  useTabStore: vi.fn((selector: (state: unknown) => unknown) => {
    return selector(mockTabState);
  }),
  MAX_TITLE_LENGTH: 100,
}));

function createMockTab(id: string, title: string): Tab {
  return {
    id,
    title,
    layout: { type: "leaf", terminalSessionId: `session-${id}` },
    createdAt: Date.now(),
  };
}

describe("BroadcastBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBroadcastState = {
      isActive: false,
      targetTabIds: new Set<string>(),
      addTab: vi.fn(),
      removeTab: vi.fn(),
      deactivate: vi.fn(),
    };

    mockTabState = {
      tabs: [
        createMockTab("tab-1", "Terminal 1"),
        createMockTab("tab-2", "Terminal 2"),
        createMockTab("tab-3", "Terminal 3"),
      ],
      activeTabId: "tab-1",
    };
  });

  describe("visibility", () => {
    it("does not render when broadcast is inactive", () => {
      mockBroadcastState.isActive = false;

      render(<BroadcastBar />);

      expect(screen.queryByTestId("broadcast-bar")).not.toBeInTheDocument();
    });

    it("renders when broadcast is active", () => {
      mockBroadcastState.isActive = true;
      mockBroadcastState.targetTabIds = new Set(["tab-2", "tab-3"]);

      render(<BroadcastBar />);

      expect(screen.getByTestId("broadcast-bar")).toBeInTheDocument();
    });
  });

  describe("display", () => {
    beforeEach(() => {
      mockBroadcastState.isActive = true;
      mockBroadcastState.targetTabIds = new Set(["tab-2", "tab-3"]);
    });

    it("shows broadcast icon", () => {
      render(<BroadcastBar />);

      expect(screen.getByTestId("broadcast-icon")).toBeInTheDocument();
    });

    it("displays correct target count (plural)", () => {
      render(<BroadcastBar />);

      expect(screen.getByTestId("broadcast-label")).toHaveTextContent(
        "Broadcasting to 2 tabs",
      );
    });

    it("displays correct target count (singular)", () => {
      mockBroadcastState.targetTabIds = new Set(["tab-2"]);

      render(<BroadcastBar />);

      expect(screen.getByTestId("broadcast-label")).toHaveTextContent(
        "Broadcasting to 1 tab",
      );
    });

    it("shows keyboard shortcut hint", () => {
      render(<BroadcastBar />);

      expect(screen.getByText("Ctrl+Shift+A")).toBeInTheDocument();
    });

    it("shows stop button", () => {
      render(<BroadcastBar />);

      expect(screen.getByTestId("broadcast-stop")).toBeInTheDocument();
      expect(screen.getByLabelText("Stop broadcasting")).toBeInTheDocument();
    });
  });

  describe("target checkboxes", () => {
    beforeEach(() => {
      mockBroadcastState.isActive = true;
      mockBroadcastState.targetTabIds = new Set(["tab-2"]);
    });

    it("shows checkboxes for non-active tabs only", () => {
      render(<BroadcastBar />);

      // Should show tab-2 and tab-3 (not tab-1 which is active)
      expect(screen.getByTestId("broadcast-target-tab-2")).toBeInTheDocument();
      expect(screen.getByTestId("broadcast-target-tab-3")).toBeInTheDocument();
      expect(
        screen.queryByTestId("broadcast-target-tab-1"),
      ).not.toBeInTheDocument();
    });

    it("checked state reflects targetTabIds", () => {
      render(<BroadcastBar />);

      const target2 = screen.getByTestId("broadcast-target-tab-2");
      const target3 = screen.getByTestId("broadcast-target-tab-3");

      const checkbox2 = within(target2).getByRole("checkbox");
      const checkbox3 = within(target3).getByRole("checkbox");

      expect(checkbox2).toBeChecked();
      expect(checkbox3).not.toBeChecked();
    });

    it("calls addTab when unchecked checkbox is checked", async () => {
      const user = userEvent.setup();
      render(<BroadcastBar />);

      const target3 = screen.getByTestId("broadcast-target-tab-3");
      const checkbox3 = within(target3).getByRole("checkbox");

      await user.click(checkbox3);

      expect(mockBroadcastState.addTab).toHaveBeenCalledWith("tab-3");
    });

    it("calls removeTab when checked checkbox is unchecked", async () => {
      const user = userEvent.setup();
      render(<BroadcastBar />);

      const target2 = screen.getByTestId("broadcast-target-tab-2");
      const checkbox2 = within(target2).getByRole("checkbox");

      await user.click(checkbox2);

      expect(mockBroadcastState.removeTab).toHaveBeenCalledWith("tab-2");
    });

    it("shows tab titles in checkboxes", () => {
      render(<BroadcastBar />);

      expect(screen.getByText("Terminal 2")).toBeInTheDocument();
      expect(screen.getByText("Terminal 3")).toBeInTheDocument();
    });
  });

  describe("stop button", () => {
    it("calls deactivate when stop button is clicked", async () => {
      mockBroadcastState.isActive = true;
      mockBroadcastState.targetTabIds = new Set(["tab-2"]);

      const user = userEvent.setup();
      render(<BroadcastBar />);

      await user.click(screen.getByTestId("broadcast-stop"));

      expect(mockBroadcastState.deactivate).toHaveBeenCalledTimes(1);
    });
  });

  describe("accessibility", () => {
    beforeEach(() => {
      mockBroadcastState.isActive = true;
      mockBroadcastState.targetTabIds = new Set(["tab-2"]);
    });

    it("has role=status for screen readers", () => {
      render(<BroadcastBar />);

      const bar = screen.getByTestId("broadcast-bar");
      expect(bar).toHaveAttribute("role", "status");
    });

    it("has aria-live=polite for dynamic updates", () => {
      render(<BroadcastBar />);

      const bar = screen.getByTestId("broadcast-bar");
      expect(bar).toHaveAttribute("aria-live", "polite");
    });

    it("checkboxes have aria-labels", () => {
      render(<BroadcastBar />);

      expect(
        screen.getByLabelText("Broadcast to Terminal 2"),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Broadcast to Terminal 3"),
      ).toBeInTheDocument();
    });
  });
});
