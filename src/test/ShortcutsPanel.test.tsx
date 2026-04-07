/**
 * Unit tests for ShortcutsPanel component.
 *
 * Tags: [TDD], [AC-shortcuts-render], [AC-shortcuts-close], [AC-shortcuts-categories]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ShortcutsPanel,
  SHORTCUT_CATEGORIES,
} from "../components/Help/ShortcutsPanel";

// ─── Mocks ───────────────────────────────────────────────────────────

let mockIsOpen = true;
const mockSetOpen = vi.fn();

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      shortcutsPanelOpen: mockIsOpen,
      setShortcutsPanelOpen: mockSetOpen,
    };
    return selector(state);
  }),
}));

describe("ShortcutsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOpen = true;
  });

  it("renders when open", () => {
    render(<ShortcutsPanel />);
    expect(screen.getByTestId("shortcuts-panel")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    mockIsOpen = false;
    render(<ShortcutsPanel />);
    expect(screen.queryByTestId("shortcuts-panel")).not.toBeInTheDocument();
  });

  it("has role=dialog and aria-modal", () => {
    render(<ShortcutsPanel />);
    const panel = screen.getByTestId("shortcuts-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
  });

  it("displays title 'Keyboard Shortcuts'", () => {
    render(<ShortcutsPanel />);
    const title = screen.getByTestId("shortcuts-panel").querySelector("h2");
    expect(title).toHaveTextContent("Keyboard Shortcuts");
  });

  it("renders all shortcut categories", () => {
    render(<ShortcutsPanel />);
    for (const cat of SHORTCUT_CATEGORIES) {
      expect(screen.getByText(cat.category)).toBeInTheDocument();
    }
  });

  it("renders all shortcut actions", () => {
    render(<ShortcutsPanel />);
    for (const cat of SHORTCUT_CATEGORIES) {
      for (const shortcut of cat.shortcuts) {
        // Use getAllByText since some actions appear in multiple categories
        const matches = screen.getAllByText(shortcut.action);
        expect(matches.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("renders all shortcut key combinations in kbd elements", () => {
    render(<ShortcutsPanel />);
    const kbds = screen.getByTestId("shortcuts-panel").querySelectorAll("kbd");
    const totalShortcuts = SHORTCUT_CATEGORIES.reduce(
      (sum, cat) => sum + cat.shortcuts.length,
      0,
    );
    expect(kbds.length).toBe(totalShortcuts);
  });

  it("shows macOS note", () => {
    render(<ShortcutsPanel />);
    expect(
      screen.getByText(/On macOS, use ⌘ \(Cmd\) instead of Ctrl/),
    ).toBeInTheDocument();
  });

  // ─── Close behavior ────────────────────────────────────────────

  it("close button calls setShortcutsPanelOpen(false)", () => {
    render(<ShortcutsPanel />);
    fireEvent.click(screen.getByTestId("shortcuts-panel-close"));
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  it("clicking backdrop calls setShortcutsPanelOpen(false)", () => {
    render(<ShortcutsPanel />);
    fireEvent.click(screen.getByTestId("shortcuts-panel-backdrop"));
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  it("clicking inside panel does NOT close", () => {
    render(<ShortcutsPanel />);
    fireEvent.click(screen.getByTestId("shortcuts-panel"));
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  it("Escape key closes the panel", () => {
    render(<ShortcutsPanel />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  // ─── Data integrity ────────────────────────────────────────────

  it("SHORTCUT_CATEGORIES has at least 5 categories", () => {
    expect(SHORTCUT_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });

  it("every category has at least one shortcut", () => {
    for (const cat of SHORTCUT_CATEGORIES) {
      expect(cat.shortcuts.length).toBeGreaterThanOrEqual(1);
    }
  });
});
