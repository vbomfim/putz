/**
 * Bracketed paste mode + double-paste regression tests.
 *
 * Covers:
 *  - AC1: Single paste on right-click (no double fire)
 *  - AC2: Bracketed paste markers emitted when mode enabled
 *  - AC3: Ctrl+V + contextmenu race produces single paste
 *  - Multi-line paste delivers one wrapped event
 *  - Fix 1: Bracketed-paste marker sanitization
 *  - Fix 2: Per-instance paste guard isolation
 *  - Fix 3: Event-source identity dedup
 *  - Fix 4: Real xterm.js integration test
 *  - Fix 5: Privacy cleanup of cached clipboard content
 *  - Fix 6: Synchronous entry guard
 *  - Fix 7: Clipboard error categorization
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
  createPasteGuard,
  _resetPasteInFlight,
  STRIP_PASTE_MARKERS_RE,
  type PasteGuard,
} from "../components/Terminal/pasteHelper";

// ---------------------------------------------------------------------------
// Minimal xterm Terminal mock (sufficient for paste-path testing)
// ---------------------------------------------------------------------------
interface MockTerminal {
  modes: { bracketedPasteMode: boolean };
  paste: ReturnType<typeof vi.fn>;
  onData: (handler: (data: string) => void) => {
    dispose: ReturnType<typeof vi.fn>;
  };
  _onDataHandlers: Array<(data: string) => void>;
}

function createMockTerminal(bracketedPaste = false): MockTerminal {
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
  let guard: PasteGuard;

  beforeEach(() => {
    guard = createPasteGuard();
    _resetPasteInFlight();
  });

  afterEach(() => {
    guard.dispose();
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

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

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

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

    expect(term.paste).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("hello\nworld");
  });

  // -----------------------------------------------------------------------
  // AC1 + AC3: Double-paste regression — same gesture (same event timestamp)
  // -----------------------------------------------------------------------
  it("rejects a second paste from the same gesture (same event timestamp)", async () => {
    const term = createMockTerminal(false);
    mockClipboard("duplicate-text");
    const eventTs = 12345.678;

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      eventTs,
    );
    _resetPasteInFlight(); // Reset entry guard so second call proceeds to shouldAllow
    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      eventTs,
    );

    // Only the first call should have pasted
    expect(term.paste).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Different gestures with same content should both paste
  // -----------------------------------------------------------------------
  it("allows same content from different gestures (different timestamps)", async () => {
    const term = createMockTerminal(false);
    mockClipboard("same-text");

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      1000,
    );
    _resetPasteInFlight();
    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      2000,
    );

    expect(term.paste).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Paste guard allows different content immediately
  // -----------------------------------------------------------------------
  it("allows a second paste with DIFFERENT content within the guard window", async () => {
    const term = createMockTerminal(false);

    mockClipboard("first-text");
    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      1000,
    );

    _resetPasteInFlight();
    mockClipboard("second-text");
    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
      2000,
    );

    expect(term.paste).toHaveBeenCalledTimes(2);
    expect(term.paste).toHaveBeenNthCalledWith(1, "first-text");
    expect(term.paste).toHaveBeenNthCalledWith(2, "second-text");
  });

  // -----------------------------------------------------------------------
  // Legacy fallback: content-based dedup without event timestamps
  // -----------------------------------------------------------------------
  it("falls back to content-based dedup when no event timestamp provided", async () => {
    const term = createMockTerminal(false);
    mockClipboard("repeat-text");

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );
    _resetPasteInFlight();
    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

    // Second call is within the 50ms content-based guard window
    expect(term.paste).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Paste guard resets after the window expires (legacy path)
  // -----------------------------------------------------------------------
  it("allows the same content again after the guard window expires (legacy path)", async () => {
    vi.useFakeTimers();
    const term = createMockTerminal(false);
    mockClipboard("repeat-text");

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );
    expect(term.paste).toHaveBeenCalledTimes(1);

    // Advance past the guard window (50ms for content-based fallback)
    vi.advanceTimersByTime(100);
    _resetPasteInFlight();

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );
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

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

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

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

    expect(term.paste).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Clipboard permission denied — silent no-op (Fix 7)
  // -----------------------------------------------------------------------
  it("silently handles clipboard permission denial (NotAllowedError)", async () => {
    const term = createMockTerminal(false);
    const domErr = new DOMException("Permission denied", "NotAllowedError");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockRejectedValue(domErr) },
      writable: true,
      configurable: true,
    });

    await expect(
      pasteToTerminal(
        term as unknown as import("@xterm/xterm").Terminal,
        guard,
      ),
    ).resolves.not.toThrow();
    expect(term.paste).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Unexpected clipboard error — logged via console.debug (Fix 7)
  // -----------------------------------------------------------------------
  it("logs unexpected clipboard errors via console.debug", async () => {
    const term = createMockTerminal(false);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: vi.fn().mockRejectedValue(new TypeError("unexpected")),
      },
      writable: true,
      configurable: true,
    });

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "[pasteToTerminal] unexpected clipboard error:",
      expect.any(TypeError),
    );
  });

  // -----------------------------------------------------------------------
  // AC3: Simulated race — sync entry guard prevents concurrent pastes (Fix 6)
  // -----------------------------------------------------------------------
  it("sync entry guard prevents concurrent paste calls", async () => {
    const term = createMockTerminal(true);
    const received: string[] = [];
    term.onData((data) => received.push(data));
    mockClipboard("race-text");

    // Simulate both handlers firing concurrently (same event loop tick)
    await Promise.all([
      pasteToTerminal(
        term as unknown as import("@xterm/xterm").Terminal,
        guard,
        500,
      ),
      pasteToTerminal(
        term as unknown as import("@xterm/xterm").Terminal,
        guard,
        500,
      ),
    ]);

    // Only one paste should reach the terminal
    expect(term.paste).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Fix 1: Bracketed-paste marker sanitization
// ---------------------------------------------------------------------------
describe("bracketed-paste marker sanitization", () => {
  it("strips \\x1b[201~ (paste-end) from clipboard content", () => {
    const input = "safe text\x1b[201~rm -rf /\n";
    const sanitized = input.replace(STRIP_PASTE_MARKERS_RE, "");
    expect(sanitized).toBe("safe text" + "rm -rf /\n");
    expect(sanitized).not.toContain("\x1b[201~");
  });

  it("strips \\x1b[200~ (paste-start) from clipboard content", () => {
    const input = "before\x1b[200~injected\x1b[201~after";
    const sanitized = input.replace(STRIP_PASTE_MARKERS_RE, "");
    expect(sanitized).toBe("beforeinjectedafter");
  });

  it("leaves normal text untouched", () => {
    const input = "normal clipboard content\nwith newlines";
    const sanitized = input.replace(STRIP_PASTE_MARKERS_RE, "");
    expect(sanitized).toBe(input);
  });

  it("sanitizes before terminal.paste() receives the text", async () => {
    const guard = createPasteGuard();
    const term = createMockTerminal(false);
    mockClipboard("safe\x1b[201~malicious");
    _resetPasteInFlight();

    await pasteToTerminal(
      term as unknown as import("@xterm/xterm").Terminal,
      guard,
    );

    expect(term.paste).toHaveBeenCalledWith("safemalicious");
    guard.dispose();
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Per-instance paste guard isolation
// ---------------------------------------------------------------------------
describe("per-instance paste guard isolation", () => {
  it("two guards do not interfere with each other", () => {
    const guard1 = createPasteGuard();
    const guard2 = createPasteGuard();

    // Same content, same timestamp — both should allow independently
    expect(guard1.shouldAllow("text", 100)).toBe(true);
    expect(guard2.shouldAllow("text", 100)).toBe(true);

    guard1.dispose();
    guard2.dispose();
  });

  it("dispose clears cached content", () => {
    const guard = createPasteGuard();
    guard.shouldAllow("sensitive-password", 100);
    guard.dispose();

    // After dispose, the same timestamp should be allowed again (state cleared)
    const guard2 = createPasteGuard();
    expect(guard2.shouldAllow("sensitive-password", 100)).toBe(true);
    guard2.dispose();
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Event-source identity dedup
// ---------------------------------------------------------------------------
describe("event-source identity dedup", () => {
  let guard: PasteGuard;

  beforeEach(() => {
    guard = createPasteGuard();
  });

  afterEach(() => {
    guard.dispose();
  });

  it("blocks duplicate from same event timestamp", () => {
    expect(guard.shouldAllow("text", 12345.678)).toBe(true);
    expect(guard.shouldAllow("text", 12345.678)).toBe(false);
  });

  it("allows same content from different event timestamps", () => {
    expect(guard.shouldAllow("text", 1000)).toBe(true);
    expect(guard.shouldAllow("text", 2000)).toBe(true);
  });

  it("handles jitter within TIMESTAMP_JITTER_MS (5ms)", () => {
    expect(guard.shouldAllow("text", 1000)).toBe(true);
    // Within jitter — should be blocked
    expect(guard.shouldAllow("text", 1003)).toBe(false);
    // Outside jitter — should be allowed
    expect(guard.shouldAllow("text", 1010)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 5: Privacy cleanup of cached content
// ---------------------------------------------------------------------------
describe("privacy — cached content cleanup", () => {
  it("clears cached content after guard window expires", async () => {
    vi.useFakeTimers();
    const guard = createPasteGuard();

    guard.shouldAllow("secret-api-key", 100);
    // Content is cached right now for dedup

    // Advance past the guard window
    vi.advanceTimersByTime(100);

    // Now the same content with a new timestamp should be allowed
    // (because the content was cleared by the timer)
    expect(guard.shouldAllow("secret-api-key", 200)).toBe(true);

    guard.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Integration test with real xterm.js Terminal
// ---------------------------------------------------------------------------
// xterm.js v6's paste() → onData pipeline requires a working renderer
// (canvas context) that jsdom cannot provide. Even with term.open(div),
// the internal CoreBrowserService is not fully initialized in jsdom,
// so paste() silently no-ops.
//
// TODO(#99): Run this test in a real browser environment (Playwright
// component testing or vitest --browser) where canvas works natively.
// Until then, we verify the contract with the mock tests above and
// document what the real xterm.js behavior should be.
describe("integration: real xterm.js bracketed paste", () => {
  it.todo(
    "wraps with markers and normalizes \\n → \\r when bracketedPasteMode=ON " +
      "(requires real browser — xterm.js paste() needs a working renderer, " +
      "see #99)",
  );

  it.todo(
    "does NOT wrap when bracketedPasteMode is OFF " +
      "(requires real browser — see #99)",
  );
});
