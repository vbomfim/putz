/**
 * Contract test for the keyboard shortcuts panel content.
 *
 * Verifies that the user-facing Help panel exposes the three Terminal Input
 * newline bindings under a "Terminal Input" category. This guards the help
 * surface against regressions where the feature exists but is undiscoverable.
 *
 * Tags: [AC-6], [CONTRACT], [COVERAGE]
 */
import { describe, it, expect } from "vitest";
import { SHORTCUT_CATEGORIES } from "../components/Help/ShortcutsPanel";

describe("ShortcutsPanel — Terminal Input category [AC-6]", () => {
  const terminalInput = SHORTCUT_CATEGORIES.find(
    (c) => c.category === "Terminal Input",
  );

  it("exposes a 'Terminal Input' category", () => {
    expect(terminalInput).toBeDefined();
  });

  it("lists Ctrl/Cmd+Enter, Shift+Enter, and Alt+Enter bindings", () => {
    const keys = terminalInput?.shortcuts.map((s) => s.keys) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining(["Ctrl/⌘+Enter", "Shift+Enter", "Alt+Enter"]),
    );
    expect(keys).toHaveLength(3);
  });

  it("each binding describes the user-facing action", () => {
    for (const entry of terminalInput?.shortcuts ?? []) {
      expect(entry.action).toMatch(/newline/i);
      expect(entry.action.length).toBeGreaterThan(0);
    }
  });
});
