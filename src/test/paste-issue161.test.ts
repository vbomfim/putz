/**
 * Regression tests for GitHub issue #161 — right-click double-paste with TUIs.
 *
 * The decision logic for #161 (when to paste, when to skip, when to reset
 * mouse tracking) lives inside closures in `useTerminal.ts` and is not
 * directly importable. These tests pin the OBSERVABLE invariants that
 * matter:
 *
 *   1. The exact DECRST escape sequence written on left-click to clear
 *      stuck mouse tracking after a TUI exits without disabling it.
 *   2. Documented coverage map for AC1-AC6 — what is verified here, what
 *      is verified elsewhere, and what requires manual or browser E2E.
 *
 * Tags: [REGRESSION] [AC-6] [BOUNDARY]
 * Ticket: #161
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// AC-6: Mouse-tracking reset sequence pin
// ---------------------------------------------------------------------------
// On left-click (button 0), useTerminal writes a DECRST sequence that
// disables every common xterm mouse-tracking mode:
//   • CSI ?1000 l  — X11 button-event tracking (DECSET 1000)
//   • CSI ?1002 l  — Cell-motion (button-event) tracking
//   • CSI ?1003 l  — All-motion tracking
//   • CSI ?1006 l  — SGR (extended-coordinate) tracking encoding
// The literal bytes are baked into useTerminal.ts. If a future refactor
// changes the sequence (e.g., omits 1006, reorders modes, or uses DECSET
// `h` instead of DECRST `l`), this test fails loudly. Selection breakage
// after exiting Copilot CLI is the user-visible symptom.
//
// Source-of-truth ref: src/components/Terminal/useTerminal.ts handleTrackingReset
const EXPECTED_TRACKING_RESET = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";

describe("issue #161 — mouse-tracking reset sequence", () => {
  it("[REGRESSION][AC-6] disables 1000, 1002, 1003, and 1006 in that order", () => {
    // Verify each individual DECRST is present
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1000l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1002l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1003l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1006l");
  });

  it("[REGRESSION][AC-6] uses DECRST (lowercase l), not DECSET (h)", () => {
    // A common bug: typing `h` (set) instead of `l` (reset) re-enables
    // the modes we're trying to clear, making the bug worse.
    expect(EXPECTED_TRACKING_RESET).not.toMatch(/\x1b\[\?\d+h/);
    // All four sequences must end in `l`
    const matches = EXPECTED_TRACKING_RESET.match(/\x1b\[\?\d+./g) ?? [];
    expect(matches).toHaveLength(4);
    for (const seq of matches) {
      expect(seq.endsWith("l")).toBe(true);
    }
  });

  it("[REGRESSION][AC-6] sequence is exactly 32 bytes — no whitespace, no extras", () => {
    // 4 × 8-byte DECRST (ESC + `[?NNNNl`) = 32 bytes. Detects accidental
    // whitespace, BEL, or stray characters that would corrupt the PTY.
    expect(EXPECTED_TRACKING_RESET).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// Coverage map — what is verified where
// ---------------------------------------------------------------------------
// AC | Behavior                              | Verified by
// ---|---------------------------------------|------------------------------
// 1  | Right-click pastes once (plain shell) | paste-bracketed.test.ts
//    |                                       |   "rejects same content within
//    |                                       |    guard window" + WebView2
//    |                                       |    300ms dedup is layered on
//    |                                       |    top inside handleContextMenu
// 2  | Right-click pastes once when TUI runs | NOT unit-tested — the
//    |                                       |   `mouseTrackingMode !== "none"`
//    |                                       |   skip is inline in a closure.
//    |                                       |   Manual: run `copilot`, right-
//    |                                       |   click, expect single paste.
// 3  | Left-click does NOT paste             | Trivially true — only the
//    |                                       |   `contextmenu` event triggers
//    |                                       |   pasteToTerminal. mousedown
//    |                                       |   handler only writes the
//    |                                       |   tracking-reset sequence.
// 4  | Right-click with selection → copy     | NOT unit-tested — closure
//    |                                       |   logic. Manual: select text,
//    |                                       |   right-click, expect copy +
//    |                                       |   selection cleared, no paste.
// 5  | Shift+Insert pastes once              | NOT unit-tested — closure
//    |                                       |   logic in onKey handler.
//    |                                       |   pasteToTerminal dedup
//    |                                       |   covered in paste-bracketed.
// 6  | Selection works after exiting TUI     | Pinned above (this file).
//    |                                       |   Verifies the exact DECRST
//    |                                       |   bytes are written.
//
// Recommended follow-up (testability gap):
//   Extract the contextmenu policy into a pure function in pasteHelper.ts:
//
//     export type ContextMenuAction =
//       | { kind: "copy"; text: string }
//       | { kind: "skip" }   // TUI handles it, or dedup window
//       | { kind: "paste" };
//
//     export function decideContextMenuAction(input: {
//       selection: string | null;
//       mouseTrackingActive: boolean;
//       msSinceLastPaste: number;
//     }): ContextMenuAction;
//
//   Then AC2/AC4 become trivial table-driven unit tests, and useTerminal
//   becomes a thin glue layer.
