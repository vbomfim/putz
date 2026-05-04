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
import { useEffect, useRef } from "react";

interface ShortcutCallbacks {
  /** Fired on Cmd+J / Ctrl+J. */
  onToggleInbox: () => void;
  /** Fired on Cmd+K / Ctrl+K. */
  onTogglePalette: () => void;
}

interface ShortcutOptions {
  /**
   * D3: gating flag. When `false` the shortcuts MUST NOT intercept
   * Ctrl+J / Ctrl+K — that lets xterm.js receive Ctrl+J as line-feed
   * and Ctrl+K as kill-to-EOL when the user has opted out of the
   * swarm. Defaults to `true` for callers that don't pass the flag
   * (back-compat with the original signature).
   */
  enabled?: boolean;
}

/**
 * Register the swarm keyboard shortcuts. Cleans up on unmount.
 *
 * Returns nothing — pure side effect.
 *
 * **Stable callbacks required:** the hook destructures the callbacks
 * into local refs and re-reads them on every keystroke, so callers
 * may pass freshly-created closures without causing the listener to
 * re-register on each render. Only `enabled` triggers re-registration.
 */
export function useSwarmShortcuts(
  callbacks: ShortcutCallbacks,
  options: ShortcutOptions = {},
): void {
  const { enabled = true } = options;
  // D3: keep the latest callbacks in a ref so the listener stays
  // stable across renders. Previously, every parent re-render created
  // new callback identities, which re-ran the effect and removed +
  // re-added the global listener — wasted work and a subtle race
  // window where a key dispatched mid-replace could be lost.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return; // D3: opt-out — let xterm see Ctrl+J / Ctrl+K.
    const handler = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;
      if (e.shiftKey || e.altKey) return; // narrow: bare Cmd/Ctrl only
      const key = e.key.toLowerCase();
      if (key === "j") {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onToggleInbox();
      } else if (key === "k") {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onTogglePalette();
      }
    };
    // Capture phase so we win against xterm's own listeners.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
