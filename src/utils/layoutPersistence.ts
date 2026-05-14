/**
 * Layout restore-on-startup orchestration (T1, T2, T4).
 *
 * Takes a previously-captured workspace snapshot and brings it back to
 * life. Tabs are rebuilt as **placeholders** — we do NOT spawn PTYs
 * eagerly here. Each restored terminal tab carries `pendingRestore`
 * with the saved cwd/command; the PTY is spawned lazily by
 * `useLayoutStore.materializeRestoredTab` the first time the tab
 * becomes active in the UI.
 *
 * Why deferred: `pty_spawn` returns a sessionId AFTER the Rust reader
 * thread has started emitting `pty-output-{sessionId}` events. The
 * xterm listener attaches inside a React `useEffect` that runs only
 * after the component mounts. Spawning N tabs in parallel here would
 * race against React's commit phase — bytes emitted before each
 * listener attaches are dropped (Tauri events are not buffered),
 * leaving every restored tab except the last one with a blank shell.
 *
 * Boundary contract: `restoreActiveWorkspace` is the ONLY entry point
 * the boot path calls. It MUST never throw — corrupt snapshots are the
 * common case for users coming from a crash, and the app must still
 * boot to a usable state.
 *
 * @module layoutPersistence
 */
import type { Region, RegionTab, LayoutNode } from "../types";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

/** Generates a UUID v4 using the WebCrypto API. */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Re-creates one region's tabs from the snapshot as placeholders.
 *
 * - Terminal tabs: keep the (now-dead) sessionId as a stable React
 *   key + persistence-shape sentinel and tag the tab with
 *   `pendingRestore` so the UI defers the real `pty_spawn` until the
 *   tab first becomes active. No tabs are dropped here — even tabs
 *   with no usable cwd/command will spawn a default login shell on
 *   activation.
 * - Non-terminal tabs (editor, settings, …): regenerate sessionId
 *   in case the type prefix invariant matters; otherwise pass through.
 * - All tab IDs are regenerated to avoid collisions with other restored
 *   workspaces and with newly-created tabs.
 *
 * Returns the rebuilt Region (always — never null; an empty region is
 * still a valid layout slot).
 */
function restoreRegion(region: Region): Region {
  const restoredTabs: RegionTab[] = [];
  const oldToNewId = new Map<string, string>();

  for (const tab of region.tabs) {
    const newId = generateId();
    oldToNewId.set(tab.id, newId);

    if (tab.type === "terminal") {
      const restoreMeta: { cwd?: string } = {};
      if (tab.cwd) restoreMeta.cwd = tab.cwd;
      restoredTabs.push({
        ...tab,
        id: newId,
        // Keep the prior sessionId as a placeholder. It refers to a
        // dead PTY but satisfies persistence-shape validation
        // (sessionId must be a non-empty string) so a capture round-
        // trip before the tab is materialized doesn't drop it.
        sessionId: tab.sessionId,
        pendingRestore: restoreMeta,
      });
    } else {
      restoredTabs.push({
        ...tab,
        id: newId,
        // Editor/diff/etc. carry their own session-id prefix; regenerate
        // the suffix so two restored editor tabs on the same file don't
        // collide on session id.
        sessionId: regenerateNonTerminalSessionId(tab.sessionId),
      });
    }
  }

  // Resolve activeTabId — original may have been renamed.
  const newActiveTabId =
    oldToNewId.get(region.activeTabId) ?? restoredTabs[0]?.id ?? "";

  return {
    id: region.id,
    tabs: restoredTabs,
    activeTabId: newActiveTabId,
    tabPosition: region.tabPosition,
  };
}

/**
 * Regenerates a non-terminal tab's sessionId, preserving its prefix
 * (e.g. `editor-abcd…` → `editor-newuuid`). If no recognisable prefix,
 * just emits a fresh UUID.
 */
function regenerateNonTerminalSessionId(oldId: string): string {
  const dash = oldId.indexOf("-");
  if (dash > 0 && dash < 32) {
    return oldId.slice(0, dash + 1) + generateId();
  }
  return generateId();
}

/**
 * Restores the active workspace's layout from its `savedLayout`
 * snapshot. Tabs are written into layoutStore as placeholders; PTYs
 * are NOT spawned here (see module doc for the rationale).
 *
 * Returns:
 *   - `true` if at least one tab was restored (including across regions)
 *   - `false` if no snapshot, no tabs, or restore was disabled by caller
 *
 * The caller is expected to use the return value to decide whether to
 * auto-create the default first terminal (App.tsx boot flow).
 *
 * Errors are caught — this function never throws.
 */
export async function restoreActiveWorkspace(): Promise<boolean> {
  try {
    const ws = useWorkspaceStore.getState().getActiveWorkspace();
    const snapshot = ws.savedLayout;
    if (!snapshot) return false;

    // Empty snapshot — nothing to restore.
    const totalTabs = Object.values(snapshot.regions).reduce(
      (sum, r) => sum + r.tabs.length,
      0,
    );
    if (totalTabs === 0) return false;

    // Restore each region synchronously — building placeholders is
    // pure JS work, no IPC. (PTY spawn happens later, on activation.)
    const restoredRegions: Record<string, Region> = {};
    let restoredCount = 0;
    for (const [rid, region] of Object.entries(snapshot.regions)) {
      const r = restoreRegion(region);
      restoredRegions[rid] = r;
      restoredCount += r.tabs.length;
    }

    // Sanity: layout tree must reference at least one of the regions
    // we just rebuilt. If the tree is malformed, fall back to a single-
    // region layout containing whatever we managed to restore.
    const layoutOk = layoutReferencesValidRegion(
      snapshot.layout,
      restoredRegions,
    );

    if (!layoutOk) {
      const firstRegionId = Object.keys(restoredRegions)[0];
      if (!firstRegionId) return false;
      useLayoutStore.setState({
        layout: { type: "region", regionId: firstRegionId },
        regions: restoredRegions,
        focusedRegionId: firstRegionId,
      });
      return restoredCount > 0;
    }

    const focusedOk =
      typeof snapshot.focusedRegionId === "string" &&
      snapshot.focusedRegionId in restoredRegions;

    useLayoutStore.setState({
      layout: snapshot.layout,
      regions: restoredRegions,
      focusedRegionId: focusedOk
        ? snapshot.focusedRegionId
        : Object.keys(restoredRegions)[0] ?? "",
    });

    return restoredCount > 0;
  } catch (err: unknown) {
    // Privacy: do not log the snapshot itself — it may carry file paths
    // and other Tier-2 PII. Log only a marker.
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn("[layoutPersistence] restoreActiveWorkspace failed:", msg);
    return false;
  }
}

/**
 * Walks a LayoutNode tree and returns true if every leaf references a
 * region that exists in `regions`.
 */
function layoutReferencesValidRegion(
  node: LayoutNode,
  regions: Record<string, Region>,
): boolean {
  if (node.type === "region") return node.regionId in regions;
  return (
    layoutReferencesValidRegion(node.children[0], regions) &&
    layoutReferencesValidRegion(node.children[1], regions)
  );
}
