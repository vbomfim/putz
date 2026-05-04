/**
 * Status pusher (T3 / FR-011) — bridges the OSC-derived TS-side
 * projection into the Rust coordinator so peer colleagues can see each
 * other's command status via the `roster_update` wire frame.
 *
 * **Day-1 spike outcome — DUAL projection:** the TS selector
 * (`colleagueStatus.ts`) feeds the local UI without an IPC round-trip,
 * AND this pusher mirrors the same projection into the coordinator so
 * peer agents receive `roster_update` frames. See PR description for the
 * full rationale; the short version is "same data, two fanouts; the IPC
 * cost is bounded by trailing-edge debouncing on both sides".
 *
 * **Per-binding lifecycle:**
 *   1. `subscribeStatusPusher(tabId, sessionId)` — call once per tab when
 *      Putz becomes aware that this session is a swarm colleague's PTY.
 *   2. The pusher subscribes to the relevant Zustand store and the
 *      `putz-cwd-change` window event for that session.
 *   3. On any change, it computes the projection and pushes deltas via
 *      `swarm_update_status` — coalesced through a trailing-edge debounce
 *      so a noisy shell doesn't flood the IPC bridge.
 *   4. Returns an unsubscribe function — call on tab close.
 *
 * @privacy Tier-2 — `cwd` flows through this module unredacted because
 * the coordinator stores it for peer-colleague visibility per FR-011.
 * NEVER log it; the only egress is the validated Tauri command.
 *
 * @module lib/swarm/statusPusher
 */
import type { InvokeArgs } from "@tauri-apps/api/core";
import { useCommandBlockStore } from "../../stores/commandBlockStore";
import {
  getColleagueStatus,
  type ColleagueStatusProjection,
} from "./colleagueStatus";

/** Trailing-edge debounce window for IPC pushes. Tuned to match the
 *  coordinator's own broadcast debounce so the wire stays calm under
 *  bursty OSC streams. */
export const PUSH_DEBOUNCE_MS = 100;

type InvokeFn = <T = unknown>(cmd: string, args?: InvokeArgs) => Promise<T>;

type TimerHandle = ReturnType<typeof setTimeout>;

interface PusherDeps {
  /** Injection seam for tests — defaults to Tauri's `invoke`. */
  invoke?: InvokeFn;
  /** Injection seam for tests — defaults to `setTimeout`. */
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (id: TimerHandle) => void;
  /** For environments without `window` (vitest jsdom *does* provide one,
   *  but kept as a guard). */
  addEventListenerFn?: typeof window.addEventListener;
  removeEventListenerFn?: typeof window.removeEventListener;
}

/**
 * Subscribe to OSC events for `sessionId` and push status updates for
 * `tabId` to the Rust coordinator. Returns an unsubscribe function.
 */
export function subscribeStatusPusher(
  tabId: string,
  sessionId: string,
  deps: PusherDeps = {},
): () => void {
  const invoke = deps.invoke ?? lazyInvoke;
  const setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((id) => clearTimeout(id));
  const addEventListener =
    deps.addEventListenerFn ??
    (typeof window !== "undefined"
      ? window.addEventListener.bind(window)
      : null);
  const removeEventListener =
    deps.removeEventListenerFn ??
    (typeof window !== "undefined"
      ? window.removeEventListener.bind(window)
      : null);

  let lastSent: ColleagueStatusProjection | null = null;
  let timer: TimerHandle | null = null;
  let disposed = false;

  const flush = (): void => {
    timer = null;
    if (disposed) return;
    const next = getColleagueStatus(sessionId);
    if (lastSent !== null && projectionsEqual(lastSent, next)) return;
    lastSent = next;
    // Map the TS projection 1:1 onto the Rust command. `undefined` means
    // "don't touch this field" on the backend (serde Option<T>).
    const args: InvokeArgs = {
      tabId,
      commandStatus: next.status === "unknown" ? undefined : next.status,
      cwd: next.cwd ?? undefined,
      lastCommandExit: next.lastExitCode ?? undefined,
      lastCommandAt: next.lastCommandAt ?? undefined,
    };
    // Fire-and-forget: a transient IPC failure (e.g., Tauri shutting
    // down) must NOT crash the renderer. Errors are swallowed silently
    // by design — the next change will resync.
    invoke("swarm_update_status", args).catch(() => undefined);
  };

  const schedule = (): void => {
    if (disposed) return;
    if (timer !== null) return; // coalesce
    timer = setTimeoutFn(flush, PUSH_DEBOUNCE_MS);
  };

  const cwdHandler = (e: Event): void => {
    const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
    if (detail?.sessionId === sessionId) schedule();
  };

  // Subscribe to commandBlockStore mutations.
  const unsubStore = useCommandBlockStore.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return;
    // Only schedule if THIS session's slot changed — cheap reference check.
    if (state.sessions.get(sessionId) !== prev.sessions.get(sessionId)) {
      schedule();
    }
  });

  if (addEventListener) {
    addEventListener("putz-cwd-change", cwdHandler as EventListener);
  }

  // Push initial state once the binding goes live so the coordinator
  // sees `unknown`-shaped baselines immediately (else peer rosters
  // would show stale defaults until the first OSC marker).
  schedule();

  return () => {
    disposed = true;
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    unsubStore();
    if (removeEventListener) {
      removeEventListener("putz-cwd-change", cwdHandler as EventListener);
    }
  };
}

function projectionsEqual(
  a: ColleagueStatusProjection,
  b: ColleagueStatusProjection,
): boolean {
  return (
    a.status === b.status &&
    a.cwd === b.cwd &&
    a.lastExitCode === b.lastExitCode &&
    a.lastCommandAt === b.lastCommandAt
  );
}

/**
 * Lazy import of `@tauri-apps/api/core::invoke` — kept out of module
 * scope so unit tests can run in jsdom without the Tauri runtime
 * being initialised. Tests inject their own `invoke` via `PusherDeps`.
 */
async function lazyInvoke<T>(
  cmd: string,
  args?: InvokeArgs,
): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}
