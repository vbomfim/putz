/**
 * Broadcast write helper — forwards terminal input to target tabs.
 *
 * When broadcast mode is active, this function sends the same input data
 * to all target tabs' terminal sessions. Only broadcasts when the source
 * session belongs to the currently active tab.
 *
 * @module broadcastHelper
 */
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../stores/tabStore";
import { useBroadcastStore, collectSessionIds } from "../stores/broadcastStore";

/**
 * Resolves a tab's first leaf session ID from its layout tree.
 * Used to map targetTabIds → sessionIds for IPC writes.
 */
function getFirstLeafSessionId(
  node: import("../types").PaneNode,
): string {
  if (node.type === "leaf") return node.terminalSessionId;
  return getFirstLeafSessionId(node.children[0]);
}

/**
 * Broadcasts terminal input data to all target tabs' sessions.
 *
 * Called from useTerminal's onData handler. Checks:
 * 1. Is broadcast mode active?
 * 2. Does the source session belong to the active tab?
 * 3. If yes, writes data to all target tabs' sessions.
 *
 * Uses `pty_write` for local tabs and `connection_write` for connected tabs.
 *
 * @param sourceSessionId - The session ID that originated the input
 * @param data - The encoded byte data to broadcast
 */
export function broadcastWrite(
  sourceSessionId: string,
  data: number[],
): void {
  const broadcastState = useBroadcastStore.getState();

  // 1. Early exit if broadcast is not active
  if (!broadcastState.isActive) return;

  const tabState = useTabStore.getState();

  // 2. Find which tab contains this source session
  const sourceTab = tabState.tabs.find((tab) =>
    collectSessionIds(tab.layout).includes(sourceSessionId),
  );
  if (!sourceTab) return;

  // 3. Only broadcast from the active tab
  if (sourceTab.id !== tabState.activeTabId) return;

  // 4. Write to each target tab's session(s)
  for (const targetTabId of broadcastState.targetTabIds) {
    const targetTab = tabState.tabs.find((t) => t.id === targetTabId);
    if (!targetTab) continue;

    const targetSessionId = getFirstLeafSessionId(targetTab.layout);

    // Skip if it's the same session (shouldn't happen, but safety check)
    if (targetSessionId === sourceSessionId) continue;

    // Use connection_write for remote sessions, pty_write for local
    const command =
      targetTab.status === "connected" ? "connection_write" : "pty_write";

    invoke(command, {
      sessionId: targetSessionId,
      data,
    }).catch(() => {
      // Fire-and-forget — broadcast write failures are non-fatal
    });
  }
}
