/**
 * Unit tests for the CommandBlockStore (Zustand store for OSC 133 blocks).
 *
 * Tests cover:
 *  - Empty session returns 0 blocks
 *  - Full A→B→C→D cycle produces one complete block
 *  - A without D (abandoned prompt) finalized when next A arrives
 *  - Multiple sessions tracked independently
 *  - D with exit code 0 vs 127 stored correctly
 *  - D without exit code stored as null
 *  - 500-block ring buffer (insert 600, get 500 newest)
 *  - clearSession() drops all state for that session
 *  - reset() clears all sessions
 *  - Handshake tracking
 *  - Active block tracking
 *  - Rapid consecutive blocks
 *
 * @see https://github.com/vbomfim/putz/issues/102
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useCommandBlockStore,
  MAX_BLOCKS_PER_SESSION,
} from "../stores/commandBlockStore";
import type { Osc133Event, CellPosition } from "../lib/terminal/oscParser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an Osc133Event for testing. */
function makeEvent(
  sessionId: string,
  marker: Osc133Event["marker"],
  cell: CellPosition = { row: 0, col: 0 },
  exitCode?: number,
): Osc133Event {
  return {
    kind: "osc-133",
    sessionId,
    marker,
    cell,
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

/** Shorthand for ingesting an event into the store. */
function ingest(event: Osc133Event): void {
  useCommandBlockStore.getState().ingestOscEvent(event);
}

/** Get blocks for a session. */
function blocks(sessionId: string) {
  return useCommandBlockStore.getState().getBlocksForSession(sessionId);
}

/** Get active block for a session. */
function activeBlock(sessionId: string) {
  return useCommandBlockStore.getState().getActiveBlock(sessionId);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CommandBlockStore", () => {
  beforeEach(() => {
    useCommandBlockStore.getState().reset();
  });

  // --- Empty state ---

  it("empty session has 0 blocks", () => {
    expect(blocks("nonexistent")).toEqual([]);
  });

  it("empty session has no active block", () => {
    expect(activeBlock("nonexistent")).toBeNull();
  });

  // --- Full cycle ---

  it("A→B→C→D cycle produces one complete block", () => {
    const sid = "sess-1";
    ingest(makeEvent(sid, "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent(sid, "command-start", { row: 0, col: 2 }));
    ingest(makeEvent(sid, "output-start", { row: 1, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 5, col: 0 }, 0));

    const b = blocks(sid);
    expect(b).toHaveLength(1);
    expect(b[0].promptStart).toEqual({ row: 0, col: 0 });
    expect(b[0].commandStart).toEqual({ row: 0, col: 2 });
    expect(b[0].outputStart).toEqual({ row: 1, col: 0 });
    expect(b[0].commandEnd).toEqual({ row: 5, col: 0 });
    expect(b[0].exitCode).toBe(0);
    expect(b[0].sessionId).toBe(sid);
    expect(b[0].commandText).toBe("");
    expect(typeof b[0].id).toBe("string");
    expect(b[0].id.length).toBeGreaterThan(0);
    expect(typeof b[0].startedAt).toBe("number");
  });

  it("active block is null after D completes", () => {
    const sid = "sess-active";
    ingest(makeEvent(sid, "prompt-start"));
    expect(activeBlock(sid)).not.toBeNull();

    ingest(makeEvent(sid, "command-start"));
    ingest(makeEvent(sid, "output-start"));
    ingest(makeEvent(sid, "command-end", { row: 3, col: 0 }, 0));

    expect(activeBlock(sid)).toBeNull();
  });

  it("active block is tracked between A and D", () => {
    const sid = "sess-active2";
    ingest(makeEvent(sid, "prompt-start", { row: 2, col: 0 }));

    const ab = activeBlock(sid);
    expect(ab).not.toBeNull();
    expect(ab!.promptStart).toEqual({ row: 2, col: 0 });
    expect(ab!.commandEnd).toBeNull();
  });

  // --- Abandoned blocks ---

  it("A without D (abandoned prompt) is finalized when next A arrives", () => {
    const sid = "sess-abandon";
    // First prompt — no D
    ingest(makeEvent(sid, "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent(sid, "command-start", { row: 0, col: 2 }));
    // User pressed Ctrl+C — new prompt without D

    // Second prompt
    ingest(makeEvent(sid, "prompt-start", { row: 3, col: 0 }));
    ingest(makeEvent(sid, "command-start", { row: 3, col: 2 }));
    ingest(makeEvent(sid, "output-start", { row: 4, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 8, col: 0 }, 0));

    const b = blocks(sid);
    expect(b).toHaveLength(2);

    // First block: abandoned (no commandEnd, no exitCode)
    expect(b[0].promptStart).toEqual({ row: 0, col: 0 });
    expect(b[0].commandEnd).toBeNull();
    expect(b[0].exitCode).toBeNull();

    // Second block: complete
    expect(b[1].promptStart).toEqual({ row: 3, col: 0 });
    expect(b[1].commandEnd).toEqual({ row: 8, col: 0 });
    expect(b[1].exitCode).toBe(0);
  });

  // --- Multiple sessions ---

  it("multiple sessions tracked independently", () => {
    ingest(makeEvent("sess-a", "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent("sess-b", "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent("sess-a", "command-end", { row: 5, col: 0 }, 0));
    ingest(makeEvent("sess-b", "command-end", { row: 10, col: 0 }, 1));

    expect(blocks("sess-a")).toHaveLength(1);
    expect(blocks("sess-b")).toHaveLength(1);
    expect(blocks("sess-a")[0].exitCode).toBe(0);
    expect(blocks("sess-b")[0].exitCode).toBe(1);
  });

  // --- Exit code variations ---

  it("D with exit code 0 stored correctly", () => {
    const sid = "sess-exit0";
    ingest(makeEvent(sid, "prompt-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }, 0));

    expect(blocks(sid)[0].exitCode).toBe(0);
  });

  it("D with exit code 127 stored correctly", () => {
    const sid = "sess-exit127";
    ingest(makeEvent(sid, "prompt-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }, 127));

    expect(blocks(sid)[0].exitCode).toBe(127);
  });

  it("D with exit code 255 stored correctly", () => {
    const sid = "sess-exit255";
    ingest(makeEvent(sid, "prompt-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }, 255));

    expect(blocks(sid)[0].exitCode).toBe(255);
  });

  it("D without exit code stored as null", () => {
    const sid = "sess-no-exit";
    ingest(makeEvent(sid, "prompt-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }));

    expect(blocks(sid)[0].exitCode).toBeNull();
  });

  // --- Ring buffer ---

  it("ring buffer: insert 600 blocks, get 500 newest", () => {
    const sid = "sess-ringbuf";
    const totalBlocks = MAX_BLOCKS_PER_SESSION + 100; // 600

    for (let i = 0; i < totalBlocks; i++) {
      ingest(makeEvent(sid, "prompt-start", { row: i, col: 0 }));
      ingest(makeEvent(sid, "command-end", { row: i + 1, col: 0 }, i % 256));
    }

    const b = blocks(sid);
    expect(b).toHaveLength(MAX_BLOCKS_PER_SESSION);

    // The oldest blocks should have been dropped — newest remain
    // The last block should have row = totalBlocks - 1 for promptStart
    const lastBlock = b[b.length - 1];
    expect(lastBlock.promptStart!.row).toBe(totalBlocks - 1);
  });

  // --- clearSession ---

  it("clearSession drops all state for that session", () => {
    const sid = "sess-clear";
    ingest(makeEvent(sid, "handshake"));
    ingest(makeEvent(sid, "prompt-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }, 0));

    expect(blocks(sid)).toHaveLength(1);
    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(true);

    useCommandBlockStore.getState().clearSession(sid);

    expect(blocks(sid)).toEqual([]);
    expect(activeBlock(sid)).toBeNull();
    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(
      false,
    );
  });

  it("clearSession does not affect other sessions", () => {
    ingest(makeEvent("sess-keep", "prompt-start"));
    ingest(makeEvent("sess-keep", "command-end", { row: 1, col: 0 }, 0));
    ingest(makeEvent("sess-drop", "prompt-start"));
    ingest(makeEvent("sess-drop", "command-end", { row: 1, col: 0 }, 0));

    useCommandBlockStore.getState().clearSession("sess-drop");

    expect(blocks("sess-keep")).toHaveLength(1);
    expect(blocks("sess-drop")).toEqual([]);
  });

  // --- reset ---

  it("reset clears all sessions", () => {
    ingest(makeEvent("sess-x", "prompt-start"));
    ingest(makeEvent("sess-x", "command-end", { row: 1, col: 0 }, 0));
    ingest(makeEvent("sess-y", "prompt-start"));
    ingest(makeEvent("sess-y", "command-end", { row: 1, col: 0 }, 0));

    useCommandBlockStore.getState().reset();

    expect(blocks("sess-x")).toEqual([]);
    expect(blocks("sess-y")).toEqual([]);
  });

  // --- Handshake tracking ---

  it("handshake event sets session as handshaked", () => {
    const sid = "sess-hs-track";
    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(
      false,
    );

    ingest(makeEvent(sid, "handshake"));

    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(true);
  });

  it("handshake does not create a block", () => {
    const sid = "sess-hs-no-block";
    ingest(makeEvent(sid, "handshake"));
    expect(blocks(sid)).toEqual([]);
    expect(activeBlock(sid)).toBeNull();
  });

  // --- Edge cases ---

  it("B/C/D without prior A → no block created", () => {
    const sid = "sess-no-a";
    ingest(makeEvent(sid, "command-start"));
    ingest(makeEvent(sid, "output-start"));
    ingest(makeEvent(sid, "command-end", { row: 1, col: 0 }, 0));

    // No blocks since there was no prompt-start to create an active block
    expect(blocks(sid)).toEqual([]);
  });

  it("multiple complete cycles produce multiple blocks", () => {
    const sid = "sess-multi";
    for (let i = 0; i < 5; i++) {
      ingest(makeEvent(sid, "prompt-start", { row: i * 10, col: 0 }));
      ingest(makeEvent(sid, "command-start", { row: i * 10, col: 2 }));
      ingest(makeEvent(sid, "output-start", { row: i * 10 + 1, col: 0 }));
      ingest(makeEvent(sid, "command-end", { row: i * 10 + 5, col: 0 }, i));
    }

    const b = blocks(sid);
    expect(b).toHaveLength(5);
    b.forEach((block, i) => {
      expect(block.exitCode).toBe(i);
      expect(block.promptStart!.row).toBe(i * 10);
    });
  });

  it("each block gets a unique ID", () => {
    const sid = "sess-ids";
    for (let i = 0; i < 3; i++) {
      ingest(makeEvent(sid, "prompt-start"));
      ingest(makeEvent(sid, "command-end", { row: i, col: 0 }, 0));
    }

    const b = blocks(sid);
    const ids = new Set(b.map((block) => block.id));
    expect(ids.size).toBe(3);
  });

  it("A → A (double prompt-start) finalizes previous and starts new", () => {
    const sid = "sess-double-a";
    ingest(makeEvent(sid, "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent(sid, "prompt-start", { row: 5, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 10, col: 0 }, 0));

    const b = blocks(sid);
    expect(b).toHaveLength(2);
    expect(b[0].promptStart!.row).toBe(0);
    expect(b[0].commandEnd).toBeNull(); // abandoned
    expect(b[1].promptStart!.row).toBe(5);
    expect(b[1].commandEnd!.row).toBe(10); // complete
  });

  it("A→B→A (interrupted command) finalizes abandoned block", () => {
    const sid = "sess-interrupted";
    ingest(makeEvent(sid, "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent(sid, "command-start", { row: 0, col: 2 }));
    // Interrupted — new prompt
    ingest(makeEvent(sid, "prompt-start", { row: 3, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 8, col: 0 }, 0));

    const b = blocks(sid);
    expect(b).toHaveLength(2);
    expect(b[0].commandStart).toEqual({ row: 0, col: 2 });
    expect(b[0].commandEnd).toBeNull();
  });

  // --- Lifecycle: clearSession decoupled from React unmount ---

  it("preserves command blocks across simulated remount (clearSession not called)", () => {
    const sid = "sess-remount";
    // Simulate: some blocks exist for the session
    ingest(makeEvent(sid, "handshake"));
    ingest(makeEvent(sid, "prompt-start", { row: 0, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 5, col: 0 }, 0));
    ingest(makeEvent(sid, "prompt-start", { row: 6, col: 0 }));
    ingest(makeEvent(sid, "command-end", { row: 10, col: 0 }, 1));

    expect(blocks(sid)).toHaveLength(2);
    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(true);

    // Simulate useTerminal cleanup WITHOUT clearSession (the fix):
    // Only listener unsub + dispose happens — blocks survive.
    // (No action needed here — we simply verify blocks remain.)
    expect(blocks(sid)).toHaveLength(2);

    // Simulate layoutStore.closePtySession calling clearSession:
    useCommandBlockStore.getState().clearSession(sid);
    expect(blocks(sid)).toEqual([]);
    expect(useCommandBlockStore.getState().isSessionHandshaked(sid)).toBe(
      false,
    );
  });
});
