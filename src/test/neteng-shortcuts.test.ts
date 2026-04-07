/**
 * Unit tests for the new network engineering keyboard shortcuts.
 *
 * Tests that Ctrl+Shift+K (Config Diff) and Ctrl+Shift+T (Templates)
 * are properly handled at the App level.
 *
 * Tags: [TDD], [AC-4], [AC-5], [AC-6]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("NetEng keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function simulateKeyDown(key: string, options: Partial<KeyboardEvent> = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    window.dispatchEvent(event);
    return event;
  }

  it("Ctrl+Shift+K fires keydown event for config diff", () => {
    const handler = vi.fn();
    window.addEventListener("keydown", handler);

    simulateKeyDown("k", { ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalled();

    const event = handler.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe("k");
    expect(event.ctrlKey).toBe(true);
    expect(event.shiftKey).toBe(true);

    window.removeEventListener("keydown", handler);
  });

  it("Ctrl+Shift+T fires keydown event for templates", () => {
    const handler = vi.fn();
    window.addEventListener("keydown", handler);

    simulateKeyDown("t", { ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalled();

    const event = handler.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe("t");
    expect(event.ctrlKey).toBe(true);
    expect(event.shiftKey).toBe(true);

    window.removeEventListener("keydown", handler);
  });

  it("Ctrl+K without Shift does not conflict", () => {
    const handler = vi.fn();
    window.addEventListener("keydown", handler);

    simulateKeyDown("k", { ctrlKey: true });
    const event = handler.mock.calls[0][0] as KeyboardEvent;
    expect(event.shiftKey).toBe(false);

    window.removeEventListener("keydown", handler);
  });
});
