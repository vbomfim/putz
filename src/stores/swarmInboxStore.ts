/**
 * In-memory swarm notification inbox (T4 / FR-014, FR-016).
 *
 * Stores `swarm://notify` events keyed by colleague for the Cmd+J inbox
 * panel and for per-tab notification ring counters. Pure in-memory by
 * design — clears on app restart per spec PRI-001 (Tier-2 PII MUST NOT
 * be persisted to disk).
 *
 * @privacy Tier-2 — every entry's `message` field is user-authored
 * content forwarded from a colleague's PTY context. NEVER log entries
 * to stderr / the dev console / telemetry. NEVER persist to
 * localStorage. The store deliberately omits any `localStorage`
 * coupling; future contributors who try to "fix" the lost-on-reload
 * UX should re-read PRI-001 first.
 *
 * **Component boundary (rewritability):** the public surface is
 * intentionally tiny — `addNotification`, `markAllReadForTab`,
 * `markAllRead`, `unreadCountForTab`, `highestSeverityForTab`,
 * `clear`. Consumers never reach into the entries array directly;
 * derived views go through selectors (top-level `getEntriesByColleague`
 * helper) so the storage shape can be rewritten without touching call
 * sites.
 *
 * @module stores/swarmInboxStore
 */
import { create } from "zustand";

/**
 * Notification severity — mirrors the Rust `Severity` enum
 * (`src-tauri/src/swarm/types.rs`). Lowest priority first so a
 * `Math.max`-style ordering on the indices below resolves correctly.
 */
export type NotifySeverity = "ambient" | "normal" | "urgent";

/**
 * Severity ordering — higher number = higher visual priority.
 * Used by [`highestSeverityForTab`] to pick the ring color when a tab
 * has stacked notifications.
 *
 * @internal
 */
export const SEVERITY_RANK: Record<NotifySeverity, number> = Object.freeze({
  ambient: 0,
  normal: 1,
  urgent: 2,
});

/**
 * One inbox entry — what arrived from the coordinator.
 *
 * @privacy Tier-2 — `message` is user-authored content. See module doc.
 */
export interface NotifyEntry {
  /** Stable id assigned by the store at insert time. */
  readonly id: string;
  readonly colleagueId: string;
  readonly tabId: string;
  readonly severity: NotifySeverity;
  /** @privacy Tier-2 PII — see module doc. */
  readonly message: string;
  /** Unix epoch milliseconds, set by the coordinator. */
  readonly timestampMs: number;
  /** Mutable read state — flipped by `markAllReadForTab` / `markAllRead`. */
  readonly read: boolean;
}

/**
 * Hard cap on total entries kept in memory. Defends against a
 * runaway colleague flooding the inbox. Oldest entries are discarded
 * first (FIFO), preserving the most recent activity for the user.
 */
export const MAX_INBOX_ENTRIES = 500;

interface SwarmInboxState {
  readonly entries: ReadonlyArray<NotifyEntry>;
  /**
   * Add one notification. Assigns an id, appends, and trims the
   * oldest if over [`MAX_INBOX_ENTRIES`]. Caller does not need to
   * pre-check capacity.
   */
  addNotification: (input: Omit<NotifyEntry, "id" | "read">) => void;
  /** Mark every entry for `tabId` as read. */
  markAllReadForTab: (tabId: string) => void;
  /** Mark every entry as read. */
  markAllRead: () => void;
  /** Remove every entry. */
  clear: () => void;
}

let nextId = 1;
function makeId(): string {
  return `notify-${nextId++}`;
}

export const useSwarmInboxStore = create<SwarmInboxState>((set) => ({
  entries: [],

  addNotification: (input) =>
    set((state) => {
      const entry: NotifyEntry = {
        id: makeId(),
        colleagueId: input.colleagueId,
        tabId: input.tabId,
        severity: input.severity,
        message: input.message,
        timestampMs: input.timestampMs,
        read: false,
      };
      let next = [...state.entries, entry];
      if (next.length > MAX_INBOX_ENTRIES) {
        next = next.slice(next.length - MAX_INBOX_ENTRIES);
      }
      return { entries: next };
    }),

  markAllReadForTab: (tabId) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.tabId === tabId && !e.read ? { ...e, read: true } : e,
      ),
    })),

  markAllRead: () =>
    set((state) => ({
      entries: state.entries.map((e) => (e.read ? e : { ...e, read: true })),
    })),

  clear: () => set({ entries: [] }),
}));

// ─── Pure selectors (no React) ────────────────────────────────────────

/**
 * Count unread notifications for a specific tab. Used by
 * [`TabNotificationRing`] to render the badge digit.
 */
export function unreadCountForTab(
  entries: ReadonlyArray<NotifyEntry>,
  tabId: string,
): number {
  let n = 0;
  for (const e of entries) {
    if (e.tabId === tabId && !e.read) n++;
  }
  return n;
}

/**
 * Highest-severity unread notification color for a tab, or `null` when
 * none. Used by [`TabNotificationRing`] to pick the ring color.
 */
export function highestSeverityForTab(
  entries: ReadonlyArray<NotifyEntry>,
  tabId: string,
): NotifySeverity | null {
  let best: NotifySeverity | null = null;
  let bestRank = -1;
  for (const e of entries) {
    if (e.tabId !== tabId || e.read) continue;
    const rank = SEVERITY_RANK[e.severity];
    if (rank > bestRank) {
      bestRank = rank;
      best = e.severity;
    }
  }
  return best;
}

/**
 * Group entries by `colleagueId`, most recent first within each group,
 * groups sorted by recency of their newest entry. Drives the Cmd+J
 * inbox panel layout.
 */
export interface InboxGroup {
  readonly colleagueId: string;
  readonly entries: ReadonlyArray<NotifyEntry>;
  /** `timestampMs` of the newest entry in this group. */
  readonly newestTimestampMs: number;
}

export function getEntriesByColleague(
  entries: ReadonlyArray<NotifyEntry>,
): ReadonlyArray<InboxGroup> {
  const byColleague = new Map<string, NotifyEntry[]>();
  for (const e of entries) {
    let bucket = byColleague.get(e.colleagueId);
    if (!bucket) {
      bucket = [];
      byColleague.set(e.colleagueId, bucket);
    }
    bucket.push(e);
  }
  const groups: InboxGroup[] = [];
  for (const [colleagueId, bucket] of byColleague.entries()) {
    bucket.sort((a, b) => b.timestampMs - a.timestampMs);
    groups.push({
      colleagueId,
      entries: bucket,
      newestTimestampMs: bucket[0]?.timestampMs ?? 0,
    });
  }
  groups.sort((a, b) => b.newestTimestampMs - a.newestTimestampMs);
  return groups;
}

/**
 * Test-only reset hook. Clears entries AND resets the id counter so
 * tests starting with a known empty state have deterministic ids.
 *
 * @internal
 */
export function _resetSwarmInboxStoreForTests(): void {
  nextId = 1;
  useSwarmInboxStore.setState({ entries: [] });
}
