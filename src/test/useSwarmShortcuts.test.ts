import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwarmShortcuts } from "../hooks/useSwarmShortcuts";

describe("useSwarmShortcuts", () => {
  it("invokes onToggleInbox on Cmd+J", () => {
    const onToggleInbox = vi.fn();
    const onTogglePalette = vi.fn();
    renderHook(() => useSwarmShortcuts({ onToggleInbox, onTogglePalette }));
    const ev = new KeyboardEvent("keydown", { key: "j", metaKey: true });
    window.dispatchEvent(ev);
    expect(onToggleInbox).toHaveBeenCalledTimes(1);
    expect(onTogglePalette).not.toHaveBeenCalled();
  });

  it("invokes onTogglePalette on Ctrl+K", () => {
    const onToggleInbox = vi.fn();
    const onTogglePalette = vi.fn();
    renderHook(() => useSwarmShortcuts({ onToggleInbox, onTogglePalette }));
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
    window.dispatchEvent(ev);
    expect(onTogglePalette).toHaveBeenCalledTimes(1);
    expect(onToggleInbox).not.toHaveBeenCalled();
  });

  it("ignores keys without modifier", () => {
    const onToggleInbox = vi.fn();
    const onTogglePalette = vi.fn();
    renderHook(() => useSwarmShortcuts({ onToggleInbox, onTogglePalette }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    expect(onToggleInbox).not.toHaveBeenCalled();
    expect(onTogglePalette).not.toHaveBeenCalled();
  });

  it("ignores Cmd+Shift+J (different chord)", () => {
    const onToggleInbox = vi.fn();
    renderHook(() =>
      useSwarmShortcuts({ onToggleInbox, onTogglePalette: vi.fn() }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true, shiftKey: true }),
    );
    expect(onToggleInbox).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const onToggleInbox = vi.fn();
    const { unmount } = renderHook(() =>
      useSwarmShortcuts({ onToggleInbox, onTogglePalette: vi.fn() }),
    );
    unmount();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true }),
    );
    expect(onToggleInbox).not.toHaveBeenCalled();
  });
});
