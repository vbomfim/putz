/**
 * Shared mock Terminal factory for OSC parser event tests.
 *
 * Creates a minimal mock `Terminal` with a parser that records registered
 * OSC handlers so tests can invoke them directly — bypassing the xterm.js
 * byte-level parser and testing handler logic in isolation.
 *
 * **Capabilities:**
 * - Stores multiple handlers per OSC code (mirrors xterm.js behavior).
 * - Exposes `fireOsc(code, data)` to simulate parser delivery.
 * - Exposes `registeredCodes()` to verify allowlist behavior.
 * - Exposes `setCursor(row, col)` to set the mock buffer cursor position
 *   (needed for OSC 133 cell-position tracking).
 *
 * Used by `src/test/oscParser.test.ts`, `src/test/oscParser-osc133.test.ts`,
 * and `src/test/vt-corpus/osc.test.ts`.
 *
 * @module mockTerminal
 */
import { vi } from "vitest";

/**
 * Creates a mock Terminal whose `parser.registerOscHandler` records handlers
 * in a local Map so they can be fired directly in tests.
 */
export function createMockTerminal() {
  const handlers = new Map<number, ((data: string) => boolean | void)[]>();
  let cursorX = 0;
  let cursorY = 0;
  let baseY = 0;

  return {
    terminal: {
      parser: {
        registerOscHandler(
          code: number,
          callback: (data: string) => boolean | void,
        ) {
          if (!handlers.has(code)) handlers.set(code, []);
          handlers.get(code)!.push(callback);
          return {
            dispose: vi.fn(),
          };
        },
      },
      buffer: {
        active: {
          get cursorX() {
            return cursorX;
          },
          get cursorY() {
            return cursorY;
          },
          get baseY() {
            return baseY;
          },
        },
      },
    } as unknown as import("@xterm/xterm").Terminal,

    /** Fire an OSC handler by code, simulating xterm.js parser delivery. */
    fireOsc(code: number, data: string): void {
      const cbs = handlers.get(code);
      if (cbs) {
        for (const cb of cbs) cb(data);
      }
    },

    /** Check which OSC codes have registered handlers. */
    registeredCodes(): number[] {
      return Array.from(handlers.keys());
    },

    /** Set the mock cursor position (for OSC 133 cell tracking). */
    setCursor(row: number, col: number): void {
      cursorY = row;
      cursorX = col;
    },

    /**
     * Set the mock base Y offset (scrollback).
     * When baseY > 0, the absolute row = baseY + cursorY.
     */
    setBaseY(value: number): void {
      baseY = value;
    },
  };
}
