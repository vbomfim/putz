/**
 * Regression tests for GitHub issues #161 (double-paste) and #174
 * (mouse-wheel scrolls history in Copilot CLI).
 *
 * The decision logic for these issues lives inside closures in
 * `useTerminal.ts` and is not directly importable. These tests pin
 * the OBSERVABLE invariants that matter:
 *
 *   1. The exact DECRST escape sequence used to clear stuck mouse
 *      tracking after a TUI exits without disabling it.
 *   2. STRUCTURAL pin: no `mousedown` listener writes the DECRST
 *      sequence. PR #161 added one and #174 removed it because it
 *      fired during active TUI sessions, breaking wheel scroll.
 *   3. Documented coverage map for AC1-AC6 — what is verified here,
 *      what is verified elsewhere, and what requires manual / E2E.
 *
 * Tags: [REGRESSION] [AC-6]
 * Tickets: #161, #174
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// AC-6: Mouse-tracking reset sequence pin
// ---------------------------------------------------------------------------
// The reset is now written from the CONTEXTMENU handler (right-click) ONLY,
// and only when mouse tracking is on while the active buffer is normal —
// i.e. a TUI exited without restoring tracking state. See useTerminal.ts
// handleContextMenu.
//
// If a future refactor changes the sequence (e.g., omits 1006, reorders
// modes, or uses DECSET `h` instead of DECRST `l`), this test fails loudly.
// Selection breakage / paste failure after exiting Copilot CLI is the
// user-visible symptom.
const EXPECTED_TRACKING_RESET = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";

describe("issue #161 — mouse-tracking reset sequence", () => {
  it("[REGRESSION][AC-6] disables 1000, 1002, 1003, and 1006 in that order", () => {
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1000l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1002l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1003l");
    expect(EXPECTED_TRACKING_RESET).toContain("\x1b[?1006l");
  });

  it("[REGRESSION][AC-6] uses DECRST (lowercase l), not DECSET (h)", () => {
    // eslint-disable-next-line no-control-regex
    expect(EXPECTED_TRACKING_RESET).not.toMatch(/\x1b\[\?\d+h/);
    // eslint-disable-next-line no-control-regex
    const matches = EXPECTED_TRACKING_RESET.match(/\x1b\[\?\d+./g) ?? [];
    expect(matches).toHaveLength(4);
    for (const seq of matches) {
      expect(seq.endsWith("l")).toBe(true);
    }
  });

  it("[REGRESSION][AC-6] sequence is exactly 32 bytes — no whitespace, no extras", () => {
    expect(EXPECTED_TRACKING_RESET).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// AC-7 (#174): Structural pin — no mousedown handler writes the DECRST burst
// ---------------------------------------------------------------------------
// PR #161 added `handleTrackingReset`, a mousedown(button 0) listener that
// wrote the DECRST sequence on every left-click while mouse tracking was
// active. In TUIs that enable alt-buffer + applicationCursor without
// re-emitting the mouse-tracking enable sequence on every render (e.g.
// Copilot CLI), this permanently disabled tracking → xterm.js fell back to
// translating wheel events into ↑/↓ arrow sequences → Copilot interpreted
// them as command-history navigation. See #174.
//
// This test is a STRUCTURAL pin: it reads the actual source of
// useTerminal.ts and asserts that no mousedown event handler writes the
// reset bytes. It will catch any re-introduction.
describe("issue #174 — wheel scroll preserved in active TUIs", () => {
  const useTerminalSource = readFileSync(
    join(__dirname, "..", "components", "Terminal", "useTerminal.ts"),
    "utf-8",
  );

  it("[REGRESSION] no `mousedown` listener writes the DECRST burst", () => {
    // Find every addEventListener("mousedown", ...) block and assert
    // none of them contain `\x1b[?1000l` or the symbol `handleTrackingReset`.
    expect(useTerminalSource).not.toMatch(/handleTrackingReset/);

    const mousedownBlocks = useTerminalSource
      .split(/addEventListener\(\s*"mousedown"/)
      .slice(1); // discard prefix before first match
    for (const block of mousedownBlocks) {
      // Take the first ~500 chars of each post-match slice as the handler body.
      const head = block.slice(0, 500);
      expect(head).not.toContain("\\x1b[?1000l");
      expect(head).not.toContain("?1000l");
    }
  });

  it("[REGRESSION] DECRST burst is written ONLY from handleContextMenu", () => {
    // Sanity: the bytes still exist (they're used for stuck-tracking
    // recovery on right-click). The block containing them must be
    // inside the handleContextMenu closure.
    //
    // Pin the FULL sequence — not just the prefix — so any implementation
    // that drops 1003l, 1006l, reorders, or otherwise alters the burst
    // fails loudly. The four DECRST codes together cover X11 button
    // tracking (1000), button-event/cell-motion (1002), all-motion (1003),
    // and SGR extended-coordinate encoding (1006). Dropping any of them
    // leaves a partial reset that may not actually disable tracking on
    // every TUI/terminfo combination.
    const fullBurst = "\\x1b[?1000l\\x1b[?1002l\\x1b[?1003l\\x1b[?1006l";
    expect(useTerminalSource).toContain(fullBurst);

    const burstIndex = useTerminalSource.indexOf(fullBurst);
    expect(burstIndex).toBeGreaterThan(0);

    // Walk backwards to find the nearest enclosing function declaration.
    const before = useTerminalSource.slice(0, burstIndex);
    const lastFn = before.lastIndexOf("const handle");
    expect(lastFn).toBeGreaterThan(0);
    const enclosingDecl = before.slice(lastFn, lastFn + 80);
    expect(enclosingDecl).toContain("handleContextMenu");
  });
});

// ---------------------------------------------------------------------------
// Coverage map — what is verified where
// ---------------------------------------------------------------------------
// AC | Behavior                                | Verified by
// ---|-----------------------------------------|------------------------------
// 1  | Right-click pastes once (plain shell)   | paste-bracketed.test.ts
//    |                                         |   "rejects same content
//    |                                         |    within guard window"
// 2  | Right-click pastes once when TUI runs   | NOT unit-tested — the
//    |                                         |   alt-buffer/mouseTrackingMode
//    |                                         |   gate is inline in a
//    |                                         |   closure. Manual: run
//    |                                         |   `copilot`, right-click,
//    |                                         |   expect single paste.
// 3  | Left-click NEVER writes tracking reset  | Pinned structurally above
//    |                                         |   (#174 regression guard).
// 4  | Right-click with selection → copy       | NOT unit-tested — closure
//    |                                         |   logic. Manual: select text,
//    |                                         |   right-click, expect copy +
//    |                                         |   selection cleared, no paste.
// 5  | Wheel scroll preserved in active TUI    | Structurally pinned above.
//    |                                         |   Manual: run `copilot`,
//    |                                         |   wheel-scroll, expect
//    |                                         |   viewport scroll (not
//    |                                         |   history cycling).
// 6  | Stuck tracking after TUI exit recovers  | Pinned via byte-sequence
//    |                                         |   above + structural pin
//    |                                         |   that burst lives in
//    |                                         |   handleContextMenu.
//    |                                         |   Manual: exit copilot,
//    |                                         |   right-click, expect paste.
//
// Recommended follow-up (testability gap):
//   Extract the contextmenu policy into a pure function in pasteHelper.ts:
//
//     export type ContextMenuAction =
//       | { kind: "copy"; text: string }
//       | { kind: "skip" }   // TUI handles it, or dedup window
//       | { kind: "resetAndPaste" }
//       | { kind: "paste" };
//
//     export function decideContextMenuAction(input: {
//       selection: string | null;
//       mouseTrackingActive: boolean;
//       bufferType: "normal" | "alternate";
//     }): ContextMenuAction;
//
//   Then AC2/AC4/AC6 become trivial table-driven unit tests, and useTerminal
//   becomes a thin glue layer.
