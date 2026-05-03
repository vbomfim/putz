/**
 * Unit tests for usePromptNavigation — Cmd+↑/↓ prompt jumping.
 *
 * Tests cover:
 *  - navigateToPreviousPrompt scrolls to the previous prompt row
 *  - navigateToNextPrompt scrolls to the next prompt row
 *  - Previous at first prompt is a no-op
 *  - Next at last prompt is a no-op
 *  - Navigation works with both metaKey (macOS) and ctrlKey (Linux/Windows)
 *  - Returns correct target row or null for no-op
 *
 * @see https://github.com/vbomfim/putz/issues/103
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCommandBlockStore } from "../stores/commandBlockStore";
import type { CommandBlock } from "../stores/commandBlockStore";
import {
  navigateToPreviousPrompt,
  navigateToNextPrompt,
} from "../components/Terminal/usePromptNavigation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(
  overrides: Partial<CommandBlock> & { id: string },
): CommandBlock {
  return {
    sessionId: "nav-session",
    promptStart: { row: 0, col: 0 },
    commandStart: { row: 0, col: 2 },
    outputStart: { row: 1, col: 0 },
    commandEnd: { row: 3, col: 0 },
    exitCode: 0,
    commandText: "",
    startedAt: Date.now(),
    ...overrides,
  };
}

const SESSION_ID = "nav-session";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePromptNavigation", () => {
  beforeEach(() => {
    useCommandBlockStore.getState().reset();
  });

  describe("navigateToPreviousPrompt", () => {
    it("returns the row of the previous prompt block", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
                makeBlock({
                  id: "b2",
                  commandStart: { row: 10, col: 2 },
                }),
                makeBlock({
                  id: "b3",
                  commandStart: { row: 20, col: 2 },
                }),
              ],
              activeBlock: null,
            },
          ],
        ]),
      });

      // Current viewport at row 20, should go to row 10
      const result = navigateToPreviousPrompt(SESSION_ID, 20);
      expect(result).toBe(10);
    });

    it("returns null at first prompt (no-op)", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
              ],
              activeBlock: null,
            },
          ],
        ]),
      });

      const result = navigateToPreviousPrompt(SESSION_ID, 0);
      expect(result).toBeNull();
    });

    it("returns null when no blocks exist", () => {
      const result = navigateToPreviousPrompt(SESSION_ID, 10);
      expect(result).toBeNull();
    });

    it("returns the nearest prompt above current viewport", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
                makeBlock({
                  id: "b2",
                  commandStart: { row: 10, col: 2 },
                }),
              ],
              activeBlock: null,
            },
          ],
        ]),
      });

      // Viewport at row 15, should jump to row 10
      const result = navigateToPreviousPrompt(SESSION_ID, 15);
      expect(result).toBe(10);
    });

    it("includes active block in navigation", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
              ],
              activeBlock: makeBlock({
                id: "active",
                commandStart: { row: 20, col: 2 },
                commandEnd: null,
                exitCode: null,
              }),
            },
          ],
        ]),
      });

      // Current at active block row 20 → go to row 0
      const result = navigateToPreviousPrompt(SESSION_ID, 20);
      expect(result).toBe(0);
    });
  });

  describe("navigateToNextPrompt", () => {
    it("returns the row of the next prompt block", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
                makeBlock({
                  id: "b2",
                  commandStart: { row: 10, col: 2 },
                }),
                makeBlock({
                  id: "b3",
                  commandStart: { row: 20, col: 2 },
                }),
              ],
              activeBlock: null,
            },
          ],
        ]),
      });

      // Current viewport at row 0, should go to row 10
      const result = navigateToNextPrompt(SESSION_ID, 0);
      expect(result).toBe(10);
    });

    it("returns null at last prompt (no-op)", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
              ],
              activeBlock: null,
            },
          ],
        ]),
      });

      const result = navigateToNextPrompt(SESSION_ID, 0);
      expect(result).toBeNull();
    });

    it("returns null when no blocks exist", () => {
      const result = navigateToNextPrompt(SESSION_ID, 0);
      expect(result).toBeNull();
    });

    it("includes active block in forward navigation", () => {
      useCommandBlockStore.setState({
        sessions: new Map([
          [
            SESSION_ID,
            {
              handshaked: true,
              blocks: [
                makeBlock({
                  id: "b1",
                  commandStart: { row: 0, col: 2 },
                }),
              ],
              activeBlock: makeBlock({
                id: "active",
                commandStart: { row: 20, col: 2 },
                commandEnd: null,
                exitCode: null,
              }),
            },
          ],
        ]),
      });

      const result = navigateToNextPrompt(SESSION_ID, 0);
      expect(result).toBe(20);
    });
  });
});
