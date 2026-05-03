/**
 * Bracketed paste mode + double-paste regression tests.
 *
 * Covers:
 *  - AC1: Single paste on right-click (no double fire)
 *  - AC2: Bracketed paste markers emitted when mode enabled
 *  - AC3: Ctrl+V + contextmenu race produces single paste
 *  - Multi-line paste delivers one wrapped event
 *
 * Tags: [TDD], [AC1], [AC2], [AC3], [REGRESSION]
 * Ticket: #99
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Import the paste helper and guard directly (unit-testable, no React needed)
// ---------------------------------------------------------------------------
import {
  pasteToTerminal,
  _resetPasteGuard,
} from "../components/Terminal/pasteHelper";

// ---------------------------------------------------------------------------
// Minimal xterm Terminal mock (sufficient for paste-path testing)
// ---------------------------------------------------------------------------
function createMockTerminal(bracketedPaste = false) {
  const onDataHandlers: Array<(data: string) => void> = [];

  return {
    modes: { bracketedPasteMode: bracketedPaste },
    paste: vi.fn((text: string) => {
      // Simulate what xterm.js does: when paste() is called, it fires
      // onData with the (possibly wrapped) text.
      let payload = text;
      if (bracketedPaste) {
        payload = `\x1b[200~${text}\x1b[201~`;
      }
      for (const handler of onDataHandlers) {
        handler(payload);
      }
    }),
    onData(handler: (data: string) => void) {
      onDataHandlers.push(handler);
      return { dispose: vi.fn() };
    },
    /** Expose for assertions */
    _onDataHandlers: onDataHandlers,
  };
}

// ---------------------------------------------------------------------------
// Clipboard mock
// ---------------------------------------------------------------------------
function mockClipboard(text: string) {
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: vi.fn().mockResolvedValue(text) },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pasteToTerminal — bracketed paste + deduplication", () => {
  beforeEach(() => {
    _resetPasteGuard();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // AC2: Bracketed paste markers emitted
  // -----------------------------------------------------------------------
  it("calls terminal.paste(text) which triggers onData with bracketed markers when mode is ON", async () => {
    const term = createMockTerminal(true);
    const received: string[] = [];
    term.onData((data) => received.push(data));
    mockClipboard("hello\nworld");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    expect(term.paste).toHaveBeenCalledTimes(1);
    expect(term.paste).toHaveBeenCalledWith("hello\nworld");
    // onData should have fired once with the bracketed-wrapped payload
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("\x1b[200~hello\nworld\x1b[201~");
  });

  // -----------------------------------------------------------------------
  // Bracketed paste OFF — raw text, no markers
  // -----------------------------------------------------------------------
  it("delivers raw text without markers when bracketed paste mode is OFF", async () => {
    const term = createMockTerminal(false);
    const received: string[] = [];
    term.onData((data) => received.push(data));
    mockClipboard("hello\nworld");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    expect(term.paste).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("hello\nworld");
  });

  // -----------------------------------------------------------------------
  // AC1 + AC3: Double-paste regression — same content within guard window
  // -----------------------------------------------------------------------
  it("rejects a second paste of the same content within the guard window", async () => {
    const term = createMockTerminal(false);
    mockClipboard("duplicate-text");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    // Only the first call should have pasted
    expect(term.paste).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Paste guard allows different content immediately
  // -----------------------------------------------------------------------
  it("allows a second paste with DIFFERENT content within the guard window", async () => {
    const term = createMockTerminal(false);

    mockClipboard("first-text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    mockClipboard("second-text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    expect(term.paste).toHaveBeenCalledTimes(2);
    expect(term.paste).toHaveBeenNthCalledWith(1, "first-text");
    expect(term.paste).toHaveBeenNthCalledWith(2, "second-text");
  });

  // -----------------------------------------------------------------------
  // Paste guard resets after the window expires
  // -----------------------------------------------------------------------
  it("allows the same content again after the guard window expires", async () => {
    vi.useFakeTimers();
    const term = createMockTerminal(false);
    mockClipboard("repeat-text");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");
    expect(term.paste).toHaveBeenCalledTimes(1);

    // Advance past the guard window (200ms)
    vi.advanceTimersByTime(250);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");
    expect(term.paste).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Multi-line paste — single event
  // -----------------------------------------------------------------------
  it("pastes multi-line content as one event (not line-by-line)", async () => {
    const term = createMockTerminal(true);
    const received: string[] = [];
    term.onData((data) => received.push(data));
    mockClipboard("line1\nline2\nline3");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    // Must be exactly one onData call with full multi-line text
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("\x1b[200~line1\nline2\nline3\x1b[201~");
  });

  // -----------------------------------------------------------------------
  // Empty clipboard — no paste
  // -----------------------------------------------------------------------
  it("does nothing when clipboard is empty", async () => {
    const term = createMockTerminal(false);
    mockClipboard("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pasteToTerminal(term as any, "session-1");

    expect(term.paste).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Clipboard permission denied — silent no-op
  // -----------------------------------------------------------------------
  it("silently handles clipboard permission denial", async () => {
    const term = createMockTerminal(false);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
      writable: true,
      configurable: true,
    });

    // Should not throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      pasteToTerminal(term as any, "session-1"),
    ).resolves.not.toThrow();
    expect(term.paste).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC3: Simulated race — contextmenu + Ctrl+V both fire for same gesture
  // -----------------------------------------------------------------------
  it("deduplicates when contextmenu and Ctrl+V fire simultaneously", async () => {
    const term = createMockTerminal(true);
    const received: string[] = [];
    term.onData((data) => received.push(data));
    mockClipboard("race-text");

    // Simulate both handlers firing concurrently (same event loop tick)
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pasteToTerminal(term as any, "session-1"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pasteToTerminal(term as any, "session-1"),
    ]);

    // Only one paste should reach the terminal
    expect(term.paste).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
  });
});
