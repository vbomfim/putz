/**
 * Unit tests for Toolbar component.
 *
 * Tags: [TDD], [AC-toolbar-render], [AC-toolbar-click], [AC-toolbar-visibility],
 *       [AC-toolbar-callbacks]
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

  it("Shortcuts button calls toggleShortcutsPanel", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTestId("toolbar-shortcuts"));
    expect(mockToggleShortcutsPanel).toHaveBeenCalledTimes(1);
  });

  // ─── Callback props for panel actions ──────────────────────────

  it("History button calls onOpenHistory callback", () => {
    const onOpenHistory = vi.fn();
    render(<Toolbar onOpenHistory={onOpenHistory} />);
    fireEvent.click(screen.getByTestId("toolbar-history"));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("Templates button calls onOpenTemplates callback", () => {
    const onOpenTemplates = vi.fn();
    render(<Toolbar onOpenTemplates={onOpenTemplates} />);
    fireEvent.click(screen.getByTestId("toolbar-templates"));
    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it("SFTP button calls onOpenSftp callback", () => {
    const onOpenSftp = vi.fn();
    render(<Toolbar onOpenSftp={onOpenSftp} />);
    fireEvent.click(screen.getByTestId("toolbar-sftp"));
    expect(onOpenSftp).toHaveBeenCalledTimes(1);
  });

  it("Ping button calls onOpenPing callback", () => {
    const onOpenPing = vi.fn();
    render(<Toolbar onOpenPing={onOpenPing} />);
    fireEvent.click(screen.getByTestId("toolbar-ping"));
    expect(onOpenPing).toHaveBeenCalledTimes(1);
  });

  it("Script button calls onOpenScript callback", () => {
    const onOpenScript = vi.fn();
    render(<Toolbar onOpenScript={onOpenScript} />);
    fireEvent.click(screen.getByTestId("toolbar-script"));
    expect(onOpenScript).toHaveBeenCalledTimes(1);
  });

  it("Theme Editor button calls onOpenThemeEditor callback", () => {
    const onOpenThemeEditor = vi.fn();
    render(<Toolbar onOpenThemeEditor={onOpenThemeEditor} />);
    fireEvent.click(screen.getByTestId("toolbar-theme-editor"));
    expect(onOpenThemeEditor).toHaveBeenCalledTimes(1);
  });

  it("Font Config button calls onOpenFontConfig callback", () => {
    const onOpenFontConfig = vi.fn();
    render(<Toolbar onOpenFontConfig={onOpenFontConfig} />);
    fireEvent.click(screen.getByTestId("toolbar-font-config"));
    expect(onOpenFontConfig).toHaveBeenCalledTimes(1);
  });

  it("Config Diff button calls onOpenConfigDiff callback", () => {
    const onOpenConfigDiff = vi.fn();
    render(<Toolbar onOpenConfigDiff={onOpenConfigDiff} />);
    fireEvent.click(screen.getByTestId("toolbar-config-diff"));
    expect(onOpenConfigDiff).toHaveBeenCalledTimes(1);
  });

  it("Vault button calls onOpenVault callback", () => {
    const onOpenVault = vi.fn();
    render(<Toolbar onOpenVault={onOpenVault} />);
    fireEvent.click(screen.getByTestId("toolbar-vault"));
    expect(onOpenVault).toHaveBeenCalledTimes(1);
  });

  it("Key Manager button calls onOpenKeyManager callback", () => {
    const onOpenKeyManager = vi.fn();
    render(<Toolbar onOpenKeyManager={onOpenKeyManager} />);
    fireEvent.click(screen.getByTestId("toolbar-key-manager"));
    expect(onOpenKeyManager).toHaveBeenCalledTimes(1);
  });

  it("callback buttons are no-ops when no callback is provided", () => {
    // Should not throw when callbacks are omitted
    render(<Toolbar />);
    expect(() => {
      fireEvent.click(screen.getByTestId("toolbar-history"));
      fireEvent.click(screen.getByTestId("toolbar-templates"));
      fireEvent.click(screen.getByTestId("toolbar-sftp"));
      fireEvent.click(screen.getByTestId("toolbar-ping"));
      fireEvent.click(screen.getByTestId("toolbar-script"));
      fireEvent.click(screen.getByTestId("toolbar-theme-editor"));
      fireEvent.click(screen.getByTestId("toolbar-font-config"));
      fireEvent.click(screen.getByTestId("toolbar-config-diff"));
      fireEvent.click(screen.getByTestId("toolbar-vault"));
      fireEvent.click(screen.getByTestId("toolbar-key-manager"));
    }).not.toThrow();
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
