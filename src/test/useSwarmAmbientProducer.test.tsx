/**
 * Tests for `useSwarmAmbientProducer` (T4 / B3).
 *
 * Verifies the producer-side contract:
 *  - Output on a swarm-registered, UNFOCUSED tab → bumps ambient counter.
 *  - Output on the currently-focused tab → NO bump (user is watching).
 *  - Output on a non-swarm tab → NO listener registered → NO bump.
 *  - Throttled: rapid output bursts coalesce to one bump per
 *    `SWARM_AMBIENT_THROTTLE_MS`.
 *  - Disabled (master switch off) → registers no listeners.
 *  - Empty roster → no listeners.
 *  - Cleanup unregisters all listeners on unmount.
 *
 * Tags: [TDD]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useSwarmAmbientProducer,
  SWARM_AMBIENT_THROTTLE_MS,
} from "../hooks/useSwarmAmbientProducer";
import {
  useSwarmInboxStore,
  _resetSwarmInboxStoreForTests,
  ambientCountForTabSelector,
} from "../stores/swarmInboxStore";
import { useLayoutStore } from "../stores/layoutStore";
import type { Colleague } from "../hooks/useSwarmRoster";

const TAB_SWARM = "tab-swarm-1";
const TAB_NONSWARM = "tab-other-1";
const SESSION_SWARM = "session-swarm-1";
const SESSION_NONSWARM = "session-other-1";
const REGION_ID = "region-1";

function seedLayout(activeTabId: string) {
  useLayoutStore.setState({
    layout: { type: "region", regionId: REGION_ID },
    regions: {
      [REGION_ID]: {
        id: REGION_ID,
        tabs: [
          {
            id: TAB_SWARM,
            title: "Swarm",
            type: "terminal",
            sessionId: SESSION_SWARM,
          },
          {
            id: TAB_NONSWARM,
            title: "Other",
            type: "terminal",
            sessionId: SESSION_NONSWARM,
          },
        ],
        activeTabId,
        tabPosition: "top",
      },
    },
    focusedRegionId: REGION_ID,
    tabCounter: 2,
    isSearchOpen: false,
  });
}

function makeColleague(tabId: string, id = "c1"): Colleague {
  return {
    id,
    name: id,
    tab_id: tabId,
    status: "working",
  };
}

interface FakeListenContext {
  /** Map of event-name → callback registered by the hook. */
  callbacks: Map<string, (event: { payload: unknown }) => void>;
  /** Number of disposers still alive. */
  alive: number;
  listen: <T>(
    event: string,
    cb: (event: { payload: T }) => void,
  ) => Promise<() => void>;
}

function makeFakeListen(): FakeListenContext {
  const ctx: FakeListenContext = {
    callbacks: new Map(),
    alive: 0,
    listen: async (event, cb) => {
      ctx.callbacks.set(
        event,
        cb as (event: { payload: unknown }) => void,
      );
      ctx.alive += 1;
      return () => {
        ctx.callbacks.delete(event);
        ctx.alive -= 1;
      };
    },
  };
  return ctx;
}

/** Drive `pty-output-${sessionId}` synchronously into the producer. */
function emitOutput(ctx: FakeListenContext, sessionId: string) {
  const cb = ctx.callbacks.get(`pty-output-${sessionId}`);
  cb?.({ payload: "" });
}

describe("useSwarmAmbientProducer", () => {
  beforeEach(() => {
    _resetSwarmInboxStoreForTests();
    seedLayout(TAB_NONSWARM); // swarm tab is NOT focused by default
  });

  it("bumps ambient on output for swarm-registered, unfocused tab", async () => {
    const ctx = makeFakeListen();
    const roster = [makeColleague(TAB_SWARM)];
    const nowMs = 1000;
    renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: roster,
        now: () => nowMs,
      }),
    );
    // Wait a microtask for the async listen() promise to resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.callbacks.has(`pty-output-${SESSION_SWARM}`)).toBe(true);
    emitOutput(ctx, SESSION_SWARM);

    expect(
      ambientCountForTabSelector(TAB_SWARM)(useSwarmInboxStore.getState()),
    ).toBe(1);
  });

  it("does NOT bump when the swarm tab is focused", async () => {
    seedLayout(TAB_SWARM); // swarm tab IS focused
    const ctx = makeFakeListen();
    renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: [makeColleague(TAB_SWARM)],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    emitOutput(ctx, SESSION_SWARM);
    expect(
      ambientCountForTabSelector(TAB_SWARM)(useSwarmInboxStore.getState()),
    ).toBe(0);
  });

  it("does NOT register a listener for a non-swarm tab", async () => {
    const ctx = makeFakeListen();
    renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: [makeColleague(TAB_SWARM)],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.callbacks.has(`pty-output-${SESSION_NONSWARM}`)).toBe(false);
    // Even if we synthesize an event for the non-swarm session, no
    // counter changes (no listener exists).
    emitOutput(ctx, SESSION_NONSWARM);
    expect(
      ambientCountForTabSelector(TAB_NONSWARM)(useSwarmInboxStore.getState()),
    ).toBe(0);
  });

  it("throttles rapid bursts to one bump per SWARM_AMBIENT_THROTTLE_MS", async () => {
    const ctx = makeFakeListen();
    let nowMs = 10_000;
    renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: [makeColleague(TAB_SWARM)],
        now: () => nowMs,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    emitOutput(ctx, SESSION_SWARM); // bump #1
    nowMs += SWARM_AMBIENT_THROTTLE_MS - 1; // still inside the window
    emitOutput(ctx, SESSION_SWARM); // suppressed
    emitOutput(ctx, SESSION_SWARM); // suppressed
    expect(
      ambientCountForTabSelector(TAB_SWARM)(useSwarmInboxStore.getState()),
    ).toBe(1);

    nowMs += 2; // crosses the throttle threshold
    emitOutput(ctx, SESSION_SWARM); // bump #2
    expect(
      ambientCountForTabSelector(TAB_SWARM)(useSwarmInboxStore.getState()),
    ).toBe(2);
  });

  it("registers no listeners when disabled", async () => {
    const ctx = makeFakeListen();
    renderHook(() =>
      useSwarmAmbientProducer(false, {
        listen: ctx.listen,
        rosterOverride: [makeColleague(TAB_SWARM)],
      }),
    );
    await Promise.resolve();
    expect(ctx.callbacks.size).toBe(0);
  });

  it("registers no listeners for an empty roster", async () => {
    const ctx = makeFakeListen();
    renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: [],
      }),
    );
    await Promise.resolve();
    expect(ctx.callbacks.size).toBe(0);
  });

  it("unsubscribes all listeners on unmount", async () => {
    const ctx = makeFakeListen();
    const { unmount } = renderHook(() =>
      useSwarmAmbientProducer(true, {
        listen: ctx.listen,
        rosterOverride: [makeColleague(TAB_SWARM)],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.alive).toBe(1);

    unmount();
    expect(ctx.alive).toBe(0);
    expect(ctx.callbacks.size).toBe(0);
  });

  it("re-resolves layout when roster identity changes (newly spawned colleague hooks up)", async () => {
    const ctx = makeFakeListen();
    let roster: ReadonlyArray<Colleague> = [];
    const { rerender } = renderHook(
      ({ r }: { r: ReadonlyArray<Colleague> }) =>
        useSwarmAmbientProducer(true, {
          listen: ctx.listen,
          rosterOverride: r,
        }),
      { initialProps: { r: roster } },
    );
    await Promise.resolve();
    expect(ctx.callbacks.size).toBe(0);

    roster = [makeColleague(TAB_SWARM)];
    rerender({ r: roster });
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.callbacks.has(`pty-output-${SESSION_SWARM}`)).toBe(true);
  });
});

// Suppress unused-import warning for vi (kept for symmetry / future spies).
void vi;
