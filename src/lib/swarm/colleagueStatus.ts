/**
 * Per-colleague OSC-derived status projection (T3 / FR-011).
 *
 * Pure read-only join over three existing stores:
 *   - `commandBlockStore`      → OSC 133 prompt/cmd/done boundaries
 *   - `cwdRegistry`            → OSC 7 working-directory updates
 *   - (caller-supplied tabId ↔ sessionId mapping; this module is keyed on
 *     `sessionId` because that's what both upstream stores key on)
 *
 * **Component rewritability:** this module owns no state. It is a
 * projection function — given the same store snapshots, it returns the
 * same value. Memoization is the consumer's responsibility (T4 sidebar
 * uses a Zustand selector with shallow-equality).
 *
 * @privacy Tier-2 — the `cwd` field returned from this projection is
 * a quasi-identifier (working directory) and may reveal home dir or
 * project name. Per spec FR-011, cwd IS shared with peer colleagues
 * within the same-machine same-user trust boundary, but consumers MUST
 * NOT log it to stderr / persist it to disk / forward it to telemetry.
 * See PRI-001/002.
 *
 * **Out of scope (deliberately):** this projection does NOT include
 * `commandText` or any command output. Those remain gated by the
 * existing `@privacy` annotations on `commandBlockStore.commandText`.
 *
 * @module lib/swarm/colleagueStatus
 * @see specs/putz-copilot-swarm/spec.md (FR-011, FR-012, PRI-001)
 */
import type { CommandBlock } from "../../stores/commandBlockStore";
import { useCommandBlockStore } from "../../stores/commandBlockStore";
import { getSessionCwd } from "../../components/Terminal/cwdRegistry";

/**
 * OSC-derived command-execution state for one colleague's PTY.
 *
 * Mirrors the Rust `CommandStatus` enum (`src-tauri/src/swarm/types.rs`)
 * one-for-one — the wire codec relies on this string union being a
 * faithful subset of what the backend accepts.
 */
export type ColleagueCommandStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "unknown";

export interface ColleagueStatusProjection {
  /** OSC 133-derived command state. `unknown` until the first marker. */
  readonly status: ColleagueCommandStatus;
  /** Last seen OSC 7 cwd, or null if none. @privacy Tier-2 — see file header. */
  readonly cwd: string | null;
  /** Exit code from last OSC 133;D, or null if no command finished yet. */
  readonly lastExitCode: number | null;
  /**
   * Unix epoch milliseconds when the last command **started** (OSC 133;B).
   *
   * Renamed from `lastCommandAt` (CR-GPT pass-2 #5) — the previous name
   * was ambiguous between "started" and "finished". Semantics unchanged:
   * the value is the latest finished block's `startedAt` timestamp.
   */
  readonly lastCommandStartedAt: number | null;
  /**
   * Exit codes from the last ≤10 command blocks in chronological order
   * (oldest → newest). Required by ticket #142 AC3 — the sidebar
   * renders these as a row of 10 dots so a user can spot a streak of
   * failures at a glance.
   *
   * `null` entries appear for in-flight or abandoned blocks (commands
   * that started but never produced an OSC 133;D — e.g., the user
   * pressed Enter on an empty prompt, or the shell rotated past the
   * block before it finished).
   */
  readonly lastTenExitCodes: ReadonlyArray<number | null>;
}

const EMPTY_EXIT_CODES: ReadonlyArray<number | null> = Object.freeze([]);

const EMPTY: ColleagueStatusProjection = Object.freeze({
  status: "unknown",
  cwd: null,
  lastExitCode: null,
  lastCommandStartedAt: null,
  lastTenExitCodes: EMPTY_EXIT_CODES,
});

/** Cap on how many trailing exit codes the sidebar dot-row renders. */
const EXIT_CODE_HISTORY = 10;

/**
 * Derive the projection from a session's command-block history.
 * Pure: no store access, just data → data. Exposed for unit tests so
 * they can build deterministic inputs without driving the Zustand
 * store through OSC events.
 */
export function projectFromBlocks(
  blocks: readonly CommandBlock[],
  activeBlock: CommandBlock | null,
  cwd: string | undefined,
): ColleagueStatusProjection {
  // Rule precedence (matches the FSM in the ticket):
  //   1. Active block exists → `running` (we're between B and D)
  //   2. Latest finished block exit 0 → `done`
  //   3. Latest finished block exit non-zero → `error`
  //   4. No active block, no finished blocks, but OSC 7 cwd present →
  //      degraded `unknown` shape with cwd surfaced (FR-012).
  //   5. Otherwise → `unknown` (initial state, no OSC 133 ever seen).
  const lastTen = lastTenExitCodesFromBlocks(blocks);
  if (activeBlock !== null) {
    return {
      status: "running",
      cwd: cwd ?? null,
      lastExitCode: lastExitCodeFromBlocks(blocks),
      lastCommandStartedAt: lastCommandStartedAtFromBlocks(blocks),
      lastTenExitCodes: lastTen,
    };
  }
  const last = lastFinishedBlock(blocks);
  if (last === null) {
    if (cwd !== undefined) {
      return { ...EMPTY, cwd, lastTenExitCodes: lastTen };
    }
    return EMPTY;
  }
  const exit = last.exitCode;
  return {
    status: exit === null ? "unknown" : exit === 0 ? "done" : "error",
    cwd: cwd ?? null,
    lastExitCode: exit,
    lastCommandStartedAt: last.commandEnd ? last.startedAt : null,
    lastTenExitCodes: lastTen,
  };
}

/**
 * Project status for a session. Reads the live Zustand store + cwd
 * registry. Cheap (HashMap lookup + array tail walk).
 */
export function getColleagueStatus(
  sessionId: string,
): ColleagueStatusProjection {
  const store = useCommandBlockStore.getState();
  const blocks = store.getBlocksForSession(sessionId);
  const active = store.getActiveBlock(sessionId);
  const cwd = getSessionCwd(sessionId);
  return projectFromBlocks(blocks, active, cwd);
}

// ─── Helpers (kept private) ─────────────────────────────────────────────

function lastFinishedBlock(blocks: readonly CommandBlock[]): CommandBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].commandEnd !== null) return blocks[i];
  }
  return null;
}

function lastExitCodeFromBlocks(blocks: readonly CommandBlock[]): number | null {
  const last = lastFinishedBlock(blocks);
  return last?.exitCode ?? null;
}

function lastCommandStartedAtFromBlocks(blocks: readonly CommandBlock[]): number | null {
  const last = lastFinishedBlock(blocks);
  return last ? last.startedAt : null;
}

/**
 * Trailing window of exit codes for the sidebar dot-row (ticket #142 AC3).
 * Returns the last [`EXIT_CODE_HISTORY`] block exit codes in chronological
 * order. `null` is preserved for blocks that never produced an OSC 133;D
 * (in-flight or abandoned). The returned array is frozen so consumers
 * don't mutate the projection.
 */
function lastTenExitCodesFromBlocks(
  blocks: readonly CommandBlock[],
): ReadonlyArray<number | null> {
  if (blocks.length === 0) return EMPTY_EXIT_CODES;
  const start = Math.max(0, blocks.length - EXIT_CODE_HISTORY);
  const out: Array<number | null> = [];
  for (let i = start; i < blocks.length; i++) {
    out.push(blocks[i].exitCode);
  }
  return Object.freeze(out);
}
