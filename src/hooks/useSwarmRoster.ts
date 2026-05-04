/**
 * `useSwarmRoster` — React hook returning the current swarm colleague
 * roster (Vec<ColleagueView> from the Rust coordinator).
 *
 * Fetches once on mount and re-fetches whenever a `swarm://state-changed`
 * event arrives (register / disconnect / sweep eviction). Status changes
 * (cwd, command_status, exit codes) come through the existing TS-side
 * projection (`lib/swarm/colleagueStatus.ts`) for the local synchronous
 * ≤16ms badge update path (FR-012); this hook owns only the *roster
 * shape*, not the per-tab status detail.
 *
 * @privacy Tier-2 — `cwd` inside each `Colleague` entry. NEVER log
 * roster contents. PRI-001/002.
 *
 * @module hooks/useSwarmRoster
 */
import { useEffect, useState } from "react";
import type { NotifySeverity } from "../stores/swarmInboxStore";

/**
 * Mirror of the Rust `ColleagueView` shape (`src-tauri/src/swarm/types.rs`).
 *
 * Names use snake_case to match the wire (avoids a remap layer).
 * Components import this type and use the wire names directly.
 */
export interface Colleague {
  id: string;
  name: string;
  tab_id: string;
  /** Lifecycle: `idle` | `working` | `stale` | `dead`. */
  status: string;
  parent?: string | null;
  /** OSC-derived: idle | running | done | error | unknown. */
  command_status?: ColleagueCommandStatus | null;
  /** @privacy Tier-2 — see module doc. */
  cwd?: string | null;
  last_command_exit?: number | null;
  last_command_started_at?: number | null;
  /** Newest last (chronological), `null` for in-flight blocks. */
  last_ten_exit_codes?: ReadonlyArray<number | null>;
}

export type ColleagueCommandStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "unknown";

type InvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type ListenFn = <T>(
  event: string,
  cb: (event: { payload: T }) => void,
) => Promise<() => void>;

interface RosterDeps {
  invoke?: InvokeFn;
  listen?: ListenFn;
}

/**
 * Returns the current colleague roster, refreshing on each
 * `swarm://state-changed` event.
 */
export function useSwarmRoster(
  deps: RosterDeps = {},
): ReadonlyArray<Colleague> {
  const [roster, setRoster] = useState<ReadonlyArray<Colleague>>([]);

  useEffect(() => {
    let cancelled = false;
    const invokeFn = deps.invoke ?? lazyInvoke;
    const listenFn = deps.listen ?? lazyListen;

    const refresh = async () => {
      try {
        const next = await invokeFn<Colleague[]>("swarm_get_roster");
        if (!cancelled) setRoster(next);
      } catch {
        // Swarm disabled or coordinator unavailable — keep last roster.
      }
    };

    void refresh();

    let unlisten: (() => void) | null = null;
    listenFn<unknown>("swarm://state-changed", () => {
      void refresh();
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
  }, [deps.invoke, deps.listen]);

  return roster;
}

async function lazyInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const mod = (await import("@tauri-apps/api/core")) as {
    invoke: <U>(c: string, a?: Record<string, unknown>) => Promise<U>;
  };
  return mod.invoke<T>(cmd, args);
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

// ─── Heartbeat helper (used by sidebar HeartbeatIndicator) ────────────

export type Heartbeat = "active" | "stale" | "dead";

/**
 * Map a colleague's lifecycle `status` to a heartbeat color bucket.
 * Centralized so visualizers stay in sync with the Rust enum.
 */
export function heartbeatFor(status: string | null | undefined): Heartbeat {
  switch (status) {
    case "idle":
    case "working":
      return "active";
    case "stale":
      return "stale";
    case "dead":
    default:
      return "dead";
  }
}

export type { NotifySeverity };
