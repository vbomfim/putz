/**
 * `useSwarmAmbientProducer` — bumps the per-tab ambient counter
 * whenever a swarm-registered, unfocused tab emits PTY output
 * (T4 / FR-013, B3).
 *
 * Design:
 *  - Subscribes to `pty-output-${sessionId}` for every swarm tab in
 *    the roster, mapped to its layout-store sessionId.
 *  - On output: if the tab is NOT the active tab in any region, calls
 *    `bumpAmbient(tabId)` on the swarm inbox store.
 *  - Throttled at one bump per `THROTTLE_MS` per tab so a chatty
 *    process can't flood the counter (and the visible "99+" cap
 *    still mirrors per-tick activity, not per-byte).
 *
 * The clear-on-focus side of the contract lives in `App.tsx` (the
 * canonical `activeTabId` subscription added in commit `b1dfd44`).
 *
 * Why a separate hook: keeps the producer logic out of `useTerminal`
 * (which is shared by all terminals — including non-swarm ones) and
 * out of every component file. One mount-point in `App` owns the
 * producer; everything else stays oblivious.
 *
 * Test seam: `deps.listen` accepts a fake Tauri event listener so
 * unit tests can drive output events synchronously without a real
 * Tauri runtime.
 *
 * @module hooks/useSwarmAmbientProducer
 */
import { useEffect } from "react";
import { useSwarmRoster, type Colleague } from "./useSwarmRoster";
import { useLayoutStore } from "../stores/layoutStore";
import { useSwarmInboxStore } from "../stores/swarmInboxStore";

/** Minimum interval between ambient bumps for the same tab. */
export const SWARM_AMBIENT_THROTTLE_MS = 250;

type ListenFn = <T>(
  event: string,
  cb: (event: { payload: T }) => void,
) => Promise<() => void>;

interface ProducerDeps {
  /** Test seam: override Tauri's `listen`. */
  listen?: ListenFn;
  /** Test seam: override roster source (skip the live fetch). */
  rosterOverride?: ReadonlyArray<Colleague>;
  /** Test seam: clock source for throttle decisions (default Date.now). */
  now?: () => number;
}

/**
 * Side-effect-only hook. Mount once near the App root.
 *
 * @param enabled - master kill switch (e.g., `swarmEnabled` setting)
 * @param deps - test seams; production callers should omit
 */
export function useSwarmAmbientProducer(
  enabled: boolean,
  deps: ProducerDeps = {},
): void {
  const liveRoster = useSwarmRoster();
  const roster = deps.rosterOverride ?? liveRoster;

  useEffect(() => {
    if (!enabled) return;
    if (roster.length === 0) return;
    const listenFn = deps.listen ?? lazyListen;
    const now = deps.now ?? (() => Date.now());

    // Build the swarm-tab → sessionId map from the current layout
    // snapshot. We re-resolve every time the roster changes so newly
    // spawned colleagues hook up without a remount.
    const layout = useLayoutStore.getState();
    const tabToSession = new Map<string, string>();
    for (const region of Object.values(layout.regions)) {
      for (const tab of region.tabs) {
        tabToSession.set(tab.id, tab.sessionId);
      }
    }

    /** Last-bump timestamp per tabId; gates the throttle. */
    const lastBump = new Map<string, number>();
    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const isTabActive = (tabId: string): boolean => {
      const regions = useLayoutStore.getState().regions;
      for (const region of Object.values(regions)) {
        if (region.activeTabId === tabId) return true;
      }
      return false;
    };

    for (const colleague of roster) {
      const tabId = colleague.tab_id;
      const sessionId = tabToSession.get(tabId);
      if (!sessionId) continue;

      void listenFn<unknown>(`pty-output-${sessionId}`, () => {
        if (cancelled) return;
        // Skip when the user is actively viewing the tab — the cursor
        // moving in front of them shouldn't add unread "noise".
        if (isTabActive(tabId)) return;
        const t = now();
        const prev = lastBump.get(tabId) ?? 0;
        if (t - prev < SWARM_AMBIENT_THROTTLE_MS) return;
        lastBump.set(tabId, t);
        useSwarmInboxStore.getState().bumpAmbient(tabId);
      })
        .then((u) => {
          if (cancelled) {
            u();
          } else {
            unlisteners.push(u);
          }
        })
        .catch(() => {
          // Listener registration failed — likely no Tauri runtime.
        });
    }

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
    // We intentionally re-run when the roster identity changes; the
    // store getters above always read the freshest snapshot inside
    // the listener closure, so there's no stale-closure risk.
  }, [enabled, roster, deps.listen, deps.now]);
}

async function lazyListen<T>(
  event: string,
  cb: (event: { payload: T }) => void,
): Promise<() => void> {
  const mod = (await import("@tauri-apps/api/event")) as {
    listen: <U>(
      e: string,
      f: (event: { payload: U }) => void,
    ) => Promise<() => void>;
  };
  return mod.listen<T>(event, cb);
}
