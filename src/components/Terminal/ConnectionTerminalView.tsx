/**
 * ConnectionTerminalView — React component for remote protocol connections.
 *
 * Renders a terminal connected to a remote host via Telnet/SSH/Serial.
 * Shows connection status (connecting, connected, disconnected, error)
 * and provides reconnect functionality.
 *
 * For SSH connections, shows host key verification and auth prompt dialogs
 * when triggered by backend events.
 *
 * Props:
 * - connectionConfig: settings for the connection (host, port, protocol)
 * - onTitleChange: callback for terminal title escape sequences
 * - onStatusChange: callback for connection status changes
 */
import { useConnection } from "./useConnection";
import { HostKeyDialog } from "./HostKeyDialog";
import type {
  ConnectionOpenInput,
  ConnectionStatusType,
} from "./connectionTypes";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface ConnectionTerminalViewProps {
  /** Connection configuration (host, port, protocol, dimensions). */
  connectionConfig: ConnectionOpenInput;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback when the connection status changes. */
  onStatusChange?: (status: ConnectionStatusType, message?: string) => void;
}

/** Terminal view for remote protocol connections. */
export function ConnectionTerminalView({
  connectionConfig,
  onTitleChange,
  onStatusChange,
}: ConnectionTerminalViewProps) {
  const {
    terminalRef,
    isReady,
    error,
    status,
    statusMessage,
    reconnect,
    hostKey,
    // authPrompt is captured by useConnection but not rendered yet —
    // the IPC response wiring needs to be implemented first.
    // See the TODO comment near the end of this component.
  } = useConnection({
    connectionConfig,
    onTitleChange,
    onStatusChange,
  });

  if (error) {
    return (
      <div className="terminal-error" data-testid="connection-error">
        <h2>Connection Error</h2>
        <p>{error}</p>
        {statusMessage && (
          <p className="terminal-error-hint">{statusMessage}</p>
        )}
        <button
          className="terminal-restart-btn"
          onClick={reconnect}
          type="button"
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <div className="terminal-wrapper" data-testid="connection-wrapper">
      {!isReady && (
        <div className="terminal-loading" data-testid="connection-loading">
          <span>
            {status === "connecting"
              ? `Connecting to ${connectionConfig.host ?? "host"}...`
              : "Initializing terminal…"}
          </span>
        </div>
      )}
      <div
        ref={terminalRef}
        className="terminal-container"
        data-testid="connection-container"
      />
      {status === "disconnected" && (
        <div
          className="terminal-exit-overlay"
          data-testid="connection-disconnected-overlay"
        >
          <button
            className="terminal-restart-btn"
            onClick={reconnect}
            type="button"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* SSH host key verification dialog */}
      {hostKey && (
        <HostKeyDialog
          hostKey={hostKey}
          host={connectionConfig.host ?? "unknown"}
          onAccept={() => {
            // TODO: Send IPC command to accept host key and resume connection
            // For now, dialogs are informational
          }}
          onReject={() => {
            // TODO: Send IPC command to reject host key
          }}
        />
      )}

      {/*
        AuthPromptDialog is intentionally NOT rendered yet.
        The backend emits auth-prompt events, but the IPC command to
        send passwords back from the frontend is not implemented.
        Rendering the dialog would create a dead-end UX where the
        user enters a password that goes nowhere.
        TODO: Implement connection_auth_respond IPC command first,
        then enable this dialog.
      */}
    </div>
  );
}
