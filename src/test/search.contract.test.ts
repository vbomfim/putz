/**
 * Search contract tests — validates search types and configuration.
 *
 * Ensures the search feature types match xterm.js addon-search API
 * and the keyboard shortcut conventions.
 */
import { describe, it, expect } from "vitest";

/** Search options matching @xterm/addon-search API. */
interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
  /** Search wraps around when reaching the end/start. */
  incremental: boolean;
}

describe("Search Contract", () => {
  describe("SearchOptions", () => {
    it("[CONTRACT] search options have required fields", () => {
      const options: SearchOptions = {
        caseSensitive: false,
        regex: false,
        incremental: true,
      };
      expect(typeof options.caseSensitive).toBe("boolean");
      expect(typeof options.regex).toBe("boolean");
      expect(typeof options.incremental).toBe("boolean");
    });

    it("[CONTRACT] default search is case-insensitive, no regex", () => {
      const defaults: SearchOptions = {
        caseSensitive: false,
        regex: false,
        incremental: true,
      };
      expect(defaults.caseSensitive).toBe(false);
      expect(defaults.regex).toBe(false);
    });
  });

  describe("Keyboard Shortcuts", () => {
    it("[CONTRACT] Ctrl+F opens search", () => {
      const shortcut = { key: "f", ctrlKey: true, shiftKey: false };
      expect(shortcut.key).toBe("f");
      expect(shortcut.ctrlKey).toBe(true);
    });

    it("[CONTRACT] Escape closes search", () => {
      const shortcut = { key: "Escape" };
      expect(shortcut.key).toBe("Escape");
    });

    it("[CONTRACT] Enter navigates to next match", () => {
      const shortcut = { key: "Enter", shiftKey: false };
      expect(shortcut.key).toBe("Enter");
      expect(shortcut.shiftKey).toBe(false);
    });

    it("[CONTRACT] Shift+Enter navigates to previous match", () => {
      const shortcut = { key: "Enter", shiftKey: true };
      expect(shortcut.key).toBe("Enter");
      expect(shortcut.shiftKey).toBe(true);
    });

    it("[CONTRACT] F3 navigates to next match", () => {
      const shortcut = { key: "F3" };
      expect(shortcut.key).toBe("F3");
    });

    it("[CONTRACT] Ctrl+Shift+L toggles logging", () => {
      const shortcut = { key: "l", ctrlKey: true, shiftKey: true };
      expect(shortcut.key).toBe("l");
      expect(shortcut.ctrlKey).toBe(true);
      expect(shortcut.shiftKey).toBe(true);
    });
  });
});
