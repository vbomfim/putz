/**
 * Command Block Tracker — Zustand store for OSC 133 semantic command boundaries.
 *
 * Tracks per-session command blocks built from OSC 133 A/B/C/D marker events.
 * Each block captures the cell positions of prompt start, command start,
 * output start, and command end — enabling S5's CommandGutter to render
 * visual indicators at the correct vertical positions.
 *
 * State machine per block:
 *   prompt-start (A) → command-start (B) → output-start (C) → command-end (D)
 *
 * Abandoned blocks (e.g., user pressed Ctrl+C between A and D) are finalized
 * when the next A arrives.
 *
 * Ring buffer: each session caps at MAX_BLOCKS_PER_SESSION to prevent
 * unbounded memory growth. Oldest blocks are dropped when exceeded.
 *
 * The trust gate lives in the parser layer (oscParser.ts), NOT here.
 * If an event reaches this store, it has already passed the handshake gate.
 *
 * @module commandBlockStore
 * @see https://github.com/vbomfim/putz/issues/102
 * @see specs/modern-terminal-protocols/spec.md
 */
import { create } from "zustand";
import type { Osc133Event, CellPosition } from "../lib/terminal/oscParser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum completed blocks retained per session.
 * Consistent with cwdRegistry's 500-entry cap.
 */
export const MAX_BLOCKS_PER_SESSION = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single command block spanning prompt → command → output → end. */
export interface CommandBlock {
  /** Generated UUID for this block. */
  readonly id: string;
  /** Session this block belongs to. */
  readonly sessionId: string;
  /** Cell position when prompt-start (A) was received. */
  promptStart: CellPosition | null;
  /** Cell position when command-start (B) was received. */
  commandStart: CellPosition | null;
  /** Cell position when output-start (C) was received. */
  outputStart: CellPosition | null;
  /** Cell position when command-end (D) was received. */
  commandEnd: CellPosition | null;
  /** Exit code from D;N, or null if D had no exit code or block is incomplete. */
  exitCode: number | null;
  /** Reserved for future ticket — command text between B and C positions. */
  commandText: string;
  /** Timestamp when the block was created (prompt-start). */
  startedAt: number;
}

/** Per-session tracking state. */
export interface SessionBlockState {
  /** Whether the session has received a handshake event. */
  handshaked: boolean;
  /** Completed (and abandoned) blocks, ring-buffered. */
  blocks: CommandBlock[];
  /** The block currently being assembled (between A and D). */
  activeBlock: CommandBlock | null;
}

interface CommandBlockState {
  /** Per-session state, keyed by sessionId. */
  sessions: Map<string, SessionBlockState>;
}

interface CommandBlockActions {
  /** Ingest an OSC 133 event and update the appropriate session's state. */
  ingestOscEvent: (event: Osc133Event) => void;
  /** Get completed blocks for a session (used by S5 CommandGutter). */
  getBlocksForSession: (sessionId: string) => CommandBlock[];
  /** Get the active (in-progress) block for a session. */
  getActiveBlock: (sessionId: string) => CommandBlock | null;
  /** Check if a session has handshaked. */
  isSessionHandshaked: (sessionId: string) => boolean;
  /** Clear all state for a session (e.g., when its tab closes). */
  clearSession: (sessionId: string) => void;
  /** Reset all state (test helper / migration). */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCommandBlockStore = create<
  CommandBlockState & CommandBlockActions
>((set, get) => ({
  sessions: new Map(),

  ingestOscEvent(event: Osc133Event): void {
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(event.sessionId);
      let session: SessionBlockState = existing
        ? {
            handshaked: existing.handshaked,
            blocks: [...existing.blocks],
            activeBlock: existing.activeBlock
              ? { ...existing.activeBlock }
              : null,
          }
        : { handshaked: false, blocks: [], activeBlock: null };

      switch (event.marker) {
        case "handshake":
          session.handshaked = true;
          break;

        case "prompt-start": {
          // Finalize previous block if it was abandoned (no D received)
          if (session.activeBlock) {
            session.blocks.push(session.activeBlock);
          }
          // Enforce ring buffer cap
          if (session.blocks.length > MAX_BLOCKS_PER_SESSION) {
            session.blocks = session.blocks.slice(
              session.blocks.length - MAX_BLOCKS_PER_SESSION,
            );
          }
          session.activeBlock = {
            id: crypto.randomUUID(),
            sessionId: event.sessionId,
            promptStart: event.cell,
            commandStart: null,
            outputStart: null,
            commandEnd: null,
            exitCode: null,
            commandText: "",
            startedAt: Date.now(),
          };
          break;
        }

        case "command-start":
          if (session.activeBlock) {
            session.activeBlock = {
              ...session.activeBlock,
              commandStart: event.cell,
            };
          }
          break;

        case "output-start":
          if (session.activeBlock) {
            session.activeBlock = {
              ...session.activeBlock,
              outputStart: event.cell,
            };
          }
          break;

        case "command-end":
          if (session.activeBlock) {
            const completed: CommandBlock = {
              ...session.activeBlock,
              commandEnd: event.cell,
              exitCode: event.exitCode ?? null,
            };
            session.blocks.push(completed);
            session.activeBlock = null;
            // Enforce ring buffer cap
            if (session.blocks.length > MAX_BLOCKS_PER_SESSION) {
              session.blocks = session.blocks.slice(
                session.blocks.length - MAX_BLOCKS_PER_SESSION,
              );
            }
          }
          break;
      }

      sessions.set(event.sessionId, session);
      return { sessions };
    });
  },

  getBlocksForSession(sessionId: string): CommandBlock[] {
    const session = get().sessions.get(sessionId);
    return session?.blocks ?? [];
  },

  getActiveBlock(sessionId: string): CommandBlock | null {
    const session = get().sessions.get(sessionId);
    return session?.activeBlock ?? null;
  },

  isSessionHandshaked(sessionId: string): boolean {
    const session = get().sessions.get(sessionId);
    return session?.handshaked ?? false;
  },

  clearSession(sessionId: string): void {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);
      return { sessions };
    });
  },

  reset(): void {
    set({ sessions: new Map() });
  },
}));
