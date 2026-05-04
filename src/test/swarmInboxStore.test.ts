/**
 * Tests for `swarmInboxStore` — the in-memory swarm notification queue.
 *
 * Covers (TDD):
 *  - addNotification: appends, assigns id, enforces FIFO cap
 *  - markAllReadForTab: only flips matching tab
 *  - markAllRead: flips every entry
 *  - clear: empties the store
 *  - unreadCountForTab selector: counts only unread + matching tab
 *  - highestSeverityForTab selector: urgent > normal > ambient
 *  - getEntriesByColleague selector: sorts groups + entries by recency
 *  - in-memory only: no localStorage write on add (PRI-001)
 *
 * Tags: [TDD]
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useSwarmInboxStore,
  unreadCountForTab,
  highestSeverityForTab,
  getEntriesByColleague,
  MAX_INBOX_ENTRIES,
  _resetSwarmInboxStoreForTests,
  type NotifyEntry,
} from "../stores/swarmInboxStore";

beforeEach(() => {
  _resetSwarmInboxStoreForTests();
});

function add(
  overrides: Partial<Omit<NotifyEntry, "id" | "read">> = {},
): void {
  useSwarmInboxStore.getState().addNotification({
    colleagueId: "alice",
    tabId: "tab-1",
    severity: "normal",
    message: "hi",
    timestampMs: 1000,
    ...overrides,
  });
}

describe("swarmInboxStore — add + read state", () => {
  it("addNotification appends an entry with a fresh id and read=false", () => {
    add();
    const entries = useSwarmInboxStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBeTruthy();
    expect(entries[0].read).toBe(false);
    expect(entries[0].message).toBe("hi");
  });

  it("addNotification assigns distinct ids per entry", () => {
    add();
    add();
    const entries = useSwarmInboxStore.getState().entries;
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it("markAllReadForTab flips only entries with the matching tabId", () => {
    add({ tabId: "tab-1" });
    add({ tabId: "tab-2" });
    useSwarmInboxStore.getState().markAllReadForTab("tab-1");
    const entries = useSwarmInboxStore.getState().entries;
    expect(entries.find((e) => e.tabId === "tab-1")?.read).toBe(true);
    expect(entries.find((e) => e.tabId === "tab-2")?.read).toBe(false);
  });

  it("markAllRead flips every unread entry", () => {
    add();
    add({ tabId: "tab-2" });
    useSwarmInboxStore.getState().markAllRead();
    expect(
      useSwarmInboxStore.getState().entries.every((e) => e.read),
    ).toBe(true);
  });

  it("clear empties the store", () => {
    add();
    useSwarmInboxStore.getState().clear();
    expect(useSwarmInboxStore.getState().entries).toHaveLength(0);
  });
});

describe("swarmInboxStore — capacity", () => {
  it("enforces a FIFO cap at MAX_INBOX_ENTRIES", () => {
    for (let i = 0; i < MAX_INBOX_ENTRIES + 5; i++) {
      add({ message: `m${i}`, timestampMs: i });
    }
    const entries = useSwarmInboxStore.getState().entries;
    expect(entries.length).toBe(MAX_INBOX_ENTRIES);
    // Oldest 5 must have been dropped — first surviving entry is m5.
    expect(entries[0].message).toBe("m5");
  });
});

describe("swarmInboxStore — selectors", () => {
  it("unreadCountForTab counts only unread + matching tab", () => {
    add({ tabId: "tab-1" });
    add({ tabId: "tab-1" });
    add({ tabId: "tab-2" });
    const entries = useSwarmInboxStore.getState().entries;
    expect(unreadCountForTab(entries, "tab-1")).toBe(2);
    expect(unreadCountForTab(entries, "tab-2")).toBe(1);
    expect(unreadCountForTab(entries, "missing")).toBe(0);
  });

  it("unreadCountForTab ignores read entries", () => {
    add({ tabId: "tab-1" });
    add({ tabId: "tab-1" });
    useSwarmInboxStore.getState().markAllReadForTab("tab-1");
    const entries = useSwarmInboxStore.getState().entries;
    expect(unreadCountForTab(entries, "tab-1")).toBe(0);
  });

  it("highestSeverityForTab picks urgent over normal over ambient", () => {
    add({ tabId: "t", severity: "ambient" });
    add({ tabId: "t", severity: "normal" });
    let entries = useSwarmInboxStore.getState().entries;
    expect(highestSeverityForTab(entries, "t")).toBe("normal");
    add({ tabId: "t", severity: "urgent" });
    entries = useSwarmInboxStore.getState().entries;
    expect(highestSeverityForTab(entries, "t")).toBe("urgent");
  });

  it("highestSeverityForTab returns null when no unread match", () => {
    expect(highestSeverityForTab([], "t")).toBeNull();
    add({ tabId: "t", severity: "urgent" });
    useSwarmInboxStore.getState().markAllReadForTab("t");
    const entries = useSwarmInboxStore.getState().entries;
    expect(highestSeverityForTab(entries, "t")).toBeNull();
  });

  it("getEntriesByColleague groups + sorts by recency", () => {
    add({ colleagueId: "alice", timestampMs: 100 });
    add({ colleagueId: "bob", timestampMs: 500 });
    add({ colleagueId: "alice", timestampMs: 300 });
    const entries = useSwarmInboxStore.getState().entries;
    const groups = getEntriesByColleague(entries);
    // bob has newest entry → first group
    expect(groups[0].colleagueId).toBe("bob");
    expect(groups[1].colleagueId).toBe("alice");
    // alice's entries are newest-first within the group
    expect(groups[1].entries.map((e) => e.timestampMs)).toEqual([300, 100]);
  });
});

describe("swarmInboxStore — privacy (PRI-001)", () => {
  it("never writes to localStorage on addNotification", () => {
    // Spy on localStorage.setItem to assert no Tier-2 PII leaves memory.
    const setItemCalls: string[] = [];
    const orig = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (k: string, v: string) => {
      setItemCalls.push(k);
      orig(k, v);
    };
    try {
      add({ message: "secret-prompt-content" });
      add({ message: "another-secret" });
      // No setItem call should ever name the inbox store.
      expect(
        setItemCalls.some((k) => k.toLowerCase().includes("inbox")),
      ).toBe(false);
    } finally {
      window.localStorage.setItem = orig;
    }
  });
});
