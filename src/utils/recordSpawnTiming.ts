/**
 * Backend-measured PTY spawn timing recorder.
 *
 * Listens for a single `pty-perf` event emitted by the Rust reader
 * thread when the first byte arrives on a freshly-spawned PTY. The
 * backend captures the timing precisely; the frontend just logs it
 * through `perf_log` for the perf harness to consume.
 *
 * Guarded by the `perf_enabled` IPC check — a no-op in production
 * builds where `PUTZ_PERF` is unset. The check result is cached at
 * module scope so each tab/pane spawn pays at most one IPC round trip
 * to discover the flag.
 *
 * Extracted from `stores/tabStore.ts` so it can be unit-tested in
 * isolation: importing tabStore in tests pulls the entire Terminal
 * barrel (xterm, monaco, etc.) through a circular dependency that does
 * not survive `vi.resetModules()` cleanly. Keeping the cache here lets
 * tests reset it with a single `vi.resetModules()` on this module
 * alone.
 *
 * @module recordSpawnTiming
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Module-level perf flag. Set once at startup via {@link checkPerfEnabled}.
 * Avoids repeated IPC calls and test interference.
 */
let _perfEnabled: boolean | null = null;

/** Checks the backend `perf_enabled` flag once and caches the result. */
async function checkPerfEnabled(): Promise<boolean> {
  if (_perfEnabled !== null) return _perfEnabled;
  try {
    _perfEnabled = await invoke<boolean>("perf_enabled");
  } catch {
    _perfEnabled = false;
  }
  return _perfEnabled;
}

/** Payload shape emitted by the Rust backend on the `pty-perf` event. */
interface PtyPerfPayload {
  sessionId: string;
  shell: string;
  validationMs: number;
  openptyMs: number;
  spawnToReadyMs: number;
  spawnToFirstByteMs: number;
}

/**
 * Records backend-measured spawn timing when `PUTZ_PERF` is enabled.
 *
 * Listens for a single `pty-perf` event matching the given `sessionId`.
 * On match, calls `perf_log` with a formatted timing line and removes
 * itself (one-shot). Mismatched sessions are ignored so multiple
 * concurrent spawns don't cross-contaminate each other's measurements.
 *
 * Fire-and-forget by design: perf instrumentation must never break tab
 * creation, so all errors are swallowed.
 *
 * @param sessionId UUID of the PTY session whose first-byte timing to log
 * @param _t0       caller's `performance.now()` at spawn — currently
 *                  unused (backend now captures the timing) but kept for
 *                  call-site symmetry and possible future use
 */
export function recordSpawnTiming(sessionId: string, _t0: number): void {
  // Fire-and-forget async — perf instrumentation must never break tab creation
  void (async () => {
    try {
      if (!(await checkPerfEnabled())) return;

      const unlisten = await listen<PtyPerfPayload>("pty-perf", (event) => {
        if (event.payload.sessionId !== sessionId) return;

        const p = event.payload;
        invoke("perf_log", {
          line: `frontend_pty_perf session=${sessionId.slice(0, 8)} shell=${p.shell} spawn_to_first_byte_ms=${p.spawnToFirstByteMs.toFixed(2)} platform=${navigator.platform}`,
        }).catch(() => {});
        // One-shot: unlisten after matching event
        unlisten();
      });
    } catch {
      // Perf instrumentation must never break tab creation
    }
  })();
}
