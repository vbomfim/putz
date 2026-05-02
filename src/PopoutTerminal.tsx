/**
 * PopoutTerminal — Standalone terminal view for popped-out windows.
 *
 * Renders a single TerminalView connected to an existing PTY session.
 * Used when a tab is popped out to its own window via the tab context menu
 * or Ctrl+Shift+P. The session ID is passed via URL search params.
 *
 * The pop-out window owns the PTY session: when closed, the session is
 * cleaned up by the useTerminal hook's unmount logic (calls pty_close).
 *
 * @module PopoutTerminal
 */
import { useEffect, useRef } from "react";
import { TerminalView } from "./components/Terminal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/global.css";
import "./styles/App.css";

interface PopoutTerminalProps {
  /** The PTY session ID to connect to. */
  sessionId: string;
  /** Initial window title. */
  initialTitle?: string;
}

/**
 * Renders a full-viewport terminal for a popped-out session.
 *
 * Updates the native window title when the shell sends a title escape
 * sequence. Manages its own lifecycle — on window close, the PTY
 * session is cleaned up automatically by useTerminal.
 */
export function PopoutTerminal({
  sessionId,
  initialTitle,
}: PopoutTerminalProps) {
  const titleSet = useRef(false);

  // Set the initial window title
  useEffect(() => {
    if (initialTitle && !titleSet.current) {
      titleSet.current = true;
      getCurrentWindow()
        .setTitle(initialTitle)
        .catch(() => {});
    }
  }, [initialTitle]);

  return (
    <main className="app-container" data-testid="popout-root">
      <TerminalView
        sessionId={sessionId}
        onTitleChange={(title) => {
          getCurrentWindow()
            .setTitle(title)
            .catch(() => {});
        }}
      />
    </main>
  );
}
