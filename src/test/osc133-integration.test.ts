/**
 * Integration tests for OSC 133 command block tracking.
 *
 * Uses the shellCompatHarness to feed synthetic PTY byte streams through a
 * real xterm.js Terminal instance, verifying that the OSC parser + store
 * pipeline produces correct command blocks end-to-end.
 *
 * Tests cover:
 *  - Full handshake + A→B→C→D cycle → 1 complete block
 *  - Multiple command cycles in sequence
 *  - Spoofing: OSC 133 markers without handshake → no blocks
 *  - Handshake then markers → blocks created (legitimate use)
 *  - Cell positions match xterm.js cursor at OSC arrival
 *  - Exit code propagation through the full pipeline
 *  - Mixed OSC 7 + OSC 133 in same stream
 *
 * @see https://github.com/vbomfim/putz/issues/102
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTerminalFromBytes } from "./utils/shellCompatHarness";
import { createOscParser } from "../lib/terminal/oscParser";
import type { OscEvent, Osc133Event } from "../lib/terminal/oscParser";
import { useCommandBlockStore } from "../stores/commandBlockStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);
const BEL = "\x07";

/** Feed bytes through a real xterm.js terminal with our OSC parser attached. */
async function feedAndCollect(
  input: string,
  sessionId: string,
): Promise<{
  events: OscEvent[];
  osc133Events: Osc133Event[];
}> {
  const events: OscEvent[] = [];

  const terminal = await createTerminalFromBytes(enc(input), {
    cols: 80,
    rows: 24,
    beforeWrite: (term) => {
      const parser = createOscParser(sessionId);
      parser.attach(term);
      parser.on((event) => {
        events.push(event);
        if (event.kind === "osc-133") {
          useCommandBlockStore.getState().ingestOscEvent(event);
        }
      });
    },
  });

  terminal.dispose();

  return {
    events,
    osc133Events: events.filter(
      (e): e is Osc133Event => e.kind === "osc-133",
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OSC 133 integration (shellCompatHarness)", () => {
  beforeEach(() => {
    useCommandBlockStore.getState().reset();
  });

  it("handshake + A→B→C→D cycle produces 1 complete block", async () => {
    const sid = "int-full-cycle";
    const input =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}ls -la` +
      `\x1b]133;C${BEL}total 42\r\n` +
      `\x1b]133;D;0${BEL}`;

    const { osc133Events } = await feedAndCollect(input, sid);

    // Should have 5 events: handshake + A + B + C + D
    expect(osc133Events).toHaveLength(5);
    expect(osc133Events.map((e) => e.marker)).toEqual([
      "handshake",
      "prompt-start",
      "command-start",
      "output-start",
      "command-end",
    ]);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].exitCode).toBe(0);
    expect(blocks[0].promptStart).not.toBeNull();
    expect(blocks[0].commandEnd).not.toBeNull();
  });

  it("multiple command cycles produce multiple blocks", async () => {
    const sid = "int-multi-cycle";
    const input =
      `\x1b]133;P;putz=1${BEL}` +
      // Cycle 1: successful ls
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}ls` +
      `\x1b]133;C${BEL}file1.txt\r\n` +
      `\x1b]133;D;0${BEL}` +
      // Cycle 2: failed command
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}nonexistent` +
      `\x1b]133;C${BEL}command not found\r\n` +
      `\x1b]133;D;127${BEL}`;

    await feedAndCollect(input, sid);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].exitCode).toBe(0);
    expect(blocks[1].exitCode).toBe(127);
  });

  it("spoofing: OSC 133 markers without handshake → no blocks", async () => {
    const sid = "int-spoof";
    // Simulates `cat malicious.txt` that contains OSC 133 sequences
    const input =
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}evil` +
      `\x1b]133;C${BEL}payload\r\n` +
      `\x1b]133;D;0${BEL}`;

    const { osc133Events } = await feedAndCollect(input, sid);

    // No events should pass the handshake gate
    expect(osc133Events).toHaveLength(0);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks).toHaveLength(0);
  });

  it("handshake then markers → blocks created (legitimate)", async () => {
    const sid = "int-legit";
    const input =
      // Handshake first
      `\x1b]133;P;putz=1${BEL}` +
      // Legitimate command
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}echo hello` +
      `\x1b]133;C${BEL}hello\r\n` +
      `\x1b]133;D;0${BEL}`;

    await feedAndCollect(input, sid);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks).toHaveLength(1);

    // Handshake flag should be set
    expect(
      useCommandBlockStore.getState().isSessionHandshaked(sid),
    ).toBe(true);
  });

  it("exit code propagation through full pipeline", async () => {
    const sid = "int-exit-code";
    const input =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}exit 42` +
      `\x1b]133;C${BEL}` +
      `\x1b]133;D;42${BEL}`;

    await feedAndCollect(input, sid);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks[0].exitCode).toBe(42);
  });

  it("D without exit code → exitCode null in block", async () => {
    const sid = "int-no-exit";
    const input =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}pwd` +
      `\x1b]133;C${BEL}/home\r\n` +
      `\x1b]133;D${BEL}`;

    await feedAndCollect(input, sid);

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks[0].exitCode).toBeNull();
  });

  it("mixed OSC 7 + OSC 133 in same stream", async () => {
    const sid = "int-mixed";
    const input =
      `\x1b]7;file:///home/user${BEL}` +
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}cd /tmp` +
      `\x1b]133;C${BEL}` +
      `\x1b]7;file:///tmp${BEL}` +
      `\x1b]133;D;0${BEL}`;

    const { events } = await feedAndCollect(input, sid);

    const cwdEvents = events.filter((e) => e.kind === "cwd-updated");
    const osc133 = events.filter((e) => e.kind === "osc-133");

    expect(cwdEvents).toHaveLength(2); // two OSC 7
    expect(osc133).toHaveLength(5); // handshake + A + B + C + D

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks).toHaveLength(1);
  });

  it("cell positions captured from real xterm.js buffer", async () => {
    const sid = "int-cells";
    const input =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;B${BEL}ls` +
      `\x1b]133;C${BEL}file1\r\nfile2\r\nfile3\r\n` +
      `\x1b]133;D;0${BEL}`;

    const { osc133Events } = await feedAndCollect(input, sid);

    // All events should have cell positions with numeric row/col
    for (const event of osc133Events) {
      expect(typeof event.cell.row).toBe("number");
      expect(typeof event.cell.col).toBe("number");
      expect(event.cell.row).toBeGreaterThanOrEqual(0);
      expect(event.cell.col).toBeGreaterThanOrEqual(0);
    }

    const blocks = useCommandBlockStore
      .getState()
      .getBlocksForSession(sid);
    expect(blocks[0].promptStart).not.toBeNull();

    // Output-start should be after command text; command-end after output lines
    if (blocks[0].outputStart && blocks[0].commandEnd) {
      expect(blocks[0].commandEnd.row).toBeGreaterThanOrEqual(
        blocks[0].outputStart.row,
      );
    }
  });

  it("independent sessions do not interfere", async () => {
    const input1 =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;D;0${BEL}`;

    const input2 =
      `\x1b]133;P;putz=1${BEL}` +
      `\x1b]133;A${BEL}$ ` +
      `\x1b]133;D;1${BEL}`;

    await feedAndCollect(input1, "int-sess-a");
    await feedAndCollect(input2, "int-sess-b");

    const blocksA = useCommandBlockStore
      .getState()
      .getBlocksForSession("int-sess-a");
    const blocksB = useCommandBlockStore
      .getState()
      .getBlocksForSession("int-sess-b");

    expect(blocksA).toHaveLength(1);
    expect(blocksB).toHaveLength(1);
    expect(blocksA[0].exitCode).toBe(0);
    expect(blocksB[0].exitCode).toBe(1);
  });
});
