/**
 * `useSwarmShortcuts` — global Cmd+J / Cmd+K key bindings (T4 / FR-016, FR-017).
 *
 * - Cmd+J / Ctrl+J → toggle Cmd+J inbox panel
 * - Cmd+K / Ctrl+K → toggle Cmd+K spawn palette
 *
 * Always intercepts (preventDefault + stopPropagation) so xterm doesn't
 * receive Ctrl+J as line-feed or Ctrl+K as kill-to-EOL while the swarm
 * is enabled. Per spec ticket #143 §15 "Risks" — opt-out is a Settings
 * toggle (not implemented in v1; see Open Questions in the ticket).
 *
 * **Component boundary:** the hook calls back into supplied
 * `onToggleInbox` / `onTogglePalette` callbacks rather than reaching
 * into a global store. Lets the consumer (App.tsx) decide where to
 * route the open/close state — no implicit coupling.
 *
 * @module hooks/useSwarmShortcuts
 */
import { useEffect } from "react";

interface ShortcutCallbacks {
  /** Fired on Cmd+J / Ctrl+J. */
  onToggleInbox: () => void;
  /** Fired on Cmd+K / Ctrl+K. */
  onTogglePalette: () => void;
}

/**
 * Register the swarm keyboard shortcuts. Cleans up on unmount.
 *
 * Returns nothing — pure side effect. The hook is keyed on the
 * callback identities so memoize them at the call site if you don't
 * want re-registration churn.
 */
export function useSwarmShortcuts(callbacks: ShortcutCallbacks): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;
      if (e.shiftKey || e.altKey) return; // narrow: bare Cmd/Ctrl only
      const key = e.key.toLowerCase();
      if (key === "j") {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onToggleInbox();
      } else if (key === "k") {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onTogglePalette();
      }
    };
    // Capture phase so we win against xterm's own listeners.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [callbacks]);
}
