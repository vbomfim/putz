/**
 * Unit tests for the OSC-derived colleague status projection (T3 / FR-011).
 *
 * Tags: [TDD] [AC-status] [FR-011] [FR-012]
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  projectFromBlocks,
  getColleagueStatus,
} from "../lib/swarm/colleagueStatus";
import type { CommandBlock } from "../stores/commandBlockStore";
import { useCommandBlockStore } from "../stores/commandBlockStore";
import {
  recordSessionCwd,
  clearSessionCwd,
} from "../components/Terminal/cwdRegistry";

function block(partial: Partial<CommandBlock> = {}): CommandBlock {
  return {
    id: partial.id ?? "b-1",
    sessionId: partial.sessionId ?? "s",
    promptStart: partial.promptStart ?? null,
    commandStart: partial.commandStart ?? null,
    outputStart: partial.outputStart ?? null,
    commandEnd: partial.commandEnd ?? null,
    exitCode: partial.exitCode ?? null,
    commandText: partial.commandText ?? "",
    startedAt: partial.startedAt ?? 1_700_000_000_000,
  };
}

describe("colleagueStatus.projectFromBlocks", () => {
  it("returns unknown when no OSC 133 has been seen and no cwd", () => {
    const p = projectFromBlocks([], null, undefined);
    expect(p.status).toBe("unknown");
    expect(p.cwd).toBeNull();
    expect(p.lastExitCode).toBeNull();
    expect(p.lastCommandAt).toBeNull();
  });

  it("returns running when an active block is in flight", () => {
    const active = block({ promptStart: { x: 0, y: 0 } });
    const p = projectFromBlocks([], active, "/proj");
    expect(p.status).toBe("running");
    expect(p.cwd).toBe("/proj");
  });

  it("returns done after exit 0", () => {
    const finished = block({
      commandEnd: { x: 0, y: 1 },
      exitCode: 0,
      startedAt: 42,
    });
    const p = projectFromBlocks([finished], null, "/p");
    expect(p.status).toBe("done");
    expect(p.lastExitCode).toBe(0);
    expect(p.lastCommandAt).toBe(42);
  });

  it("returns error after non-zero exit", () => {
    const finished = block({
      commandEnd: { x: 0, y: 1 },
      exitCode: 1,
    });
    const p = projectFromBlocks([finished], null, undefined);
    expect(p.status).toBe("error");
    expect(p.lastExitCode).toBe(1);
  });

  it("treats exit code 130 (SIGINT) as error (any non-zero)", () => {
    const finished = block({ commandEnd: { x: 0, y: 1 }, exitCode: 130 });
    const p = projectFromBlocks([finished], null, undefined);
    expect(p.status).toBe("error");
    expect(p.lastExitCode).toBe(130);
  });

  it("falls back to last finished block when active block exists (running) but reports its history", () => {
    const finished = block({
      id: "b-old",
      commandEnd: { x: 0, y: 1 },
      exitCode: 0,
      startedAt: 100,
    });
    const active = block({ id: "b-new" });
    const p = projectFromBlocks([finished], active, undefined);
    expect(p.status).toBe("running");
    expect(p.lastExitCode).toBe(0);
    expect(p.lastCommandAt).toBe(100);
  });

  it("surfaces cwd in degraded shape when OSC 7 seen but no OSC 133", () => {
    const p = projectFromBlocks([], null, "/home/me");
    expect(p.status).toBe("unknown");
    expect(p.cwd).toBe("/home/me");
  });

  it("ignores abandoned (no commandEnd) blocks when picking last finished", () => {
    const abandoned = block({ id: "ab", commandEnd: null, exitCode: null });
    const finished = block({
      id: "ok",
      commandEnd: { x: 0, y: 2 },
      exitCode: 0,
      startedAt: 7,
    });
    const p = projectFromBlocks([abandoned, finished], null, undefined);
    expect(p.status).toBe("done");
    expect(p.lastCommandAt).toBe(7);
  });

  it("returns unknown when finished block has no exit code (D without N)", () => {
    const finished = block({
      commandEnd: { x: 0, y: 1 },
      exitCode: null,
    });
    const p = projectFromBlocks([finished], null, undefined);
    expect(p.status).toBe("unknown");
    expect(p.lastExitCode).toBeNull();
  });
});

describe("colleagueStatus.getColleagueStatus (live store)", () => {
  beforeEach(() => {
    useCommandBlockStore.getState().reset();
    clearSessionCwd("sess-1");
  });

  it("returns unknown for a session that has emitted nothing", () => {
    const p = getColleagueStatus("sess-1");
    expect(p.status).toBe("unknown");
    expect(p.cwd).toBeNull();
  });

  it("handles missing cwdRegistry entry gracefully (no crash)", () => {
    // No recordSessionCwd call.
    expect(() => getColleagueStatus("sess-missing")).not.toThrow();
    const p = getColleagueStatus("sess-missing");
    expect(p.cwd).toBeNull();
  });

  it("integrates OSC 133 ingestion → running → done", () => {
    const store = useCommandBlockStore.getState();
    store.ingestOscEvent({
      sessionId: "sess-1",
      marker: "handshake",
    });
    store.ingestOscEvent({
      sessionId: "sess-1",
      marker: "prompt-start",
      cell: { x: 0, y: 0 },
    });
    store.ingestOscEvent({
      sessionId: "sess-1",
      marker: "command-start",
      cell: { x: 0, y: 1 },
    });
    expect(getColleagueStatus("sess-1").status).toBe("running");
    store.ingestOscEvent({
      sessionId: "sess-1",
      marker: "command-end",
      cell: { x: 0, y: 2 },
      exitCode: 0,
    });
    const p = getColleagueStatus("sess-1");
    expect(p.status).toBe("done");
    expect(p.lastExitCode).toBe(0);
  });

  it("reflects cwd updates via recordSessionCwd", () => {
    recordSessionCwd("sess-1", "/x/y", null, 0);
    const p = getColleagueStatus("sess-1");
    expect(p.cwd).toBe("/x/y");
  });
});
