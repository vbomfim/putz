/**
 * `useSwarmNotifyListener` — subscribes to the `swarm://notify` Tauri
 * event and pushes incoming entries into [`useSwarmInboxStore`].
 *
 * Exists as a separate hook (rather than buried inside the inbox store)
 * so:
 *   - components can mount it once at the App root without coupling
 *     the store's import to Tauri (the store stays unit-testable in
 *     pure jsdom);
 *   - tests for the inbox store can drive `addNotification` directly
 *     without faking the listener path.
 *
 * @privacy Tier-2 — `event.payload.message` is user-authored content
 * carried verbatim into the in-memory inbox. NEVER log the payload.
 *
 * @module hooks/useSwarmNotifyListener
 */
import { useEffect } from "react";
import {
  useSwarmInboxStore,
  type NotifySeverity,
} from "../stores/swarmInboxStore";

interface NotifyEvent {
  colleague_id: string;
  tab_id: string;
  severity: NotifySeverity;
  /** @privacy Tier-2 — see module doc. */
  message: string;
  timestamp_ms: number;
}

type ListenFn = <T>(
  event: string,
  cb: (event: { payload: T }) => void,
) => Promise<() => void>;

interface ListenerDeps {
  /** Test seam — defaults to Tauri's `listen`. */
  listen?: ListenFn;
}

/**
 * Listen for `swarm://notify` events while the component is mounted.
 * Use exactly once at the App root.
 */
export function useSwarmNotifyListener(deps: ListenerDeps = {}): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const listenFn = deps.listen ?? lazyListen;

    listenFn<NotifyEvent>("swarm://notify", (event) => {
      // Defensive: validate payload shape at the trust boundary —
      // a misconfigured backend could in theory emit any object.
      const p = event.payload;
      if (
        !p ||
        typeof p.colleague_id !== "string" ||
        typeof p.tab_id !== "string" ||
        typeof p.message !== "string" ||
        typeof p.timestamp_ms !== "number"
      ) {
        return;
      }
      const severity: NotifySeverity =
        p.severity === "urgent" || p.severity === "ambient"
          ? p.severity
          : "normal";
      useSwarmInboxStore.getState().addNotification({
        colleagueId: p.colleague_id,
        tabId: p.tab_id,
        severity,
        message: p.message,
        timestampMs: p.timestamp_ms,
      });
    })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch(() => {
        // Listener registration failed — likely no Tauri runtime.
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.listen]);
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
