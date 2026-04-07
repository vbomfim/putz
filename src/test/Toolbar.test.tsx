/**
 * Unit tests for Toolbar component.
 *
 * Tags: [TDD], [AC-toolbar-render], [AC-toolbar-click], [AC-toolbar-visibility]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "../components/Toolbar";

// ─── Mocks ───────────────────────────────────────────────────────────

const mockAddTab = vi.fn();
const mockSplitActivePane = vi.fn();
const mockToggleSearch = vi.fn();
const mockToggleLogging = vi.fn();
const mockToggleBroadcast = vi.fn();
const mockToggleShortcutsPanel = vi.fn();

let mockToolbarVisible = true;

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toolbarVisible: mockToolbarVisible,
      toggleShortcutsPanel: mockToggleShortcutsPanel,
    };
    return selector(state);
  }),
}));

vi.mock("../stores/tabStore", () => ({
  useTabStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      addTab: mockAddTab,
      splitActivePane: mockSplitActivePane,
      toggleSearch: mockToggleSearch,
      toggleLogging: mockToggleLogging,
      tabs: [{ id: "tab-1" }, { id: "tab-2" }],
      activeTabId: "tab-1",
    };
    return selector(state);
  }),
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggle: mockToggleBroadcast,
    };
    return selector(state);
  }),
}));

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToolbarVisible = true;
  });

  it("renders when toolbarVisible is true", () => {
    render(<Toolbar />);
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  it("does not render when toolbarVisible is false", () => {
    mockToolbarVisible = false;
    render(<Toolbar />);
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
  });

  it("has role=toolbar and aria-label", () => {
    render(<Toolbar />);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar).toHaveAttribute("role", "toolbar");
    expect(toolbar).toHaveAttribute("aria-label", "Quick actions");
  });

  it("renders all button groups with separators", () => {
    render(<Toolbar />);
    const separators = screen
      .getByTestId("toolbar")
      .querySelectorAll('[role="separator"]');
    expect(separators.length).toBe(4); // 4 separators between 5 groups
  });

  // ─── Click handlers ────────────────────────────────────────────

  it("New Tab button calls addTab", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-new-tab"));
    expect(mockAddTab).toHaveBeenCalledTimes(1);
  });

  it("Split Vertical button calls splitActivePane('vertical')", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-split-v"));
    expect(mockSplitActivePane).toHaveBeenCalledWith("vertical");
  });

  it("Split Horizontal button calls splitActivePane('horizontal')", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-split-h"));
    expect(mockSplitActivePane).toHaveBeenCalledWith("horizontal");
  });

  it("Find button calls toggleSearch", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-find"));
    expect(mockToggleSearch).toHaveBeenCalledTimes(1);
  });

  it("Log button calls toggleLogging", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-log"));
    expect(mockToggleLogging).toHaveBeenCalledTimes(1);
  });

  it("Broadcast button calls toggle with tab IDs", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-broadcast"));
    expect(mockToggleBroadcast).toHaveBeenCalledWith(
      ["tab-1", "tab-2"],
      "tab-1",
    );
  });

  it("Settings button calls toggleShortcutsPanel", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-settings"));
    expect(mockToggleShortcutsPanel).toHaveBeenCalledTimes(1);
  });

  // ─── Button tooltips ───────────────────────────────────────────

  it("all buttons have title (tooltip) attributes", () => {
    render(<Toolbar />);
    const buttons = screen
      .getByTestId("toolbar")
      .querySelectorAll(".toolbar__button");
    for (const button of buttons) {
      expect(button).toHaveAttribute("title");
      expect(button.getAttribute("title")).not.toBe("");
    }
  });

  it("all buttons have aria-label attributes", () => {
    render(<Toolbar />);
    const buttons = screen
      .getByTestId("toolbar")
      .querySelectorAll(".toolbar__button");
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-label");
    }
  });
});
