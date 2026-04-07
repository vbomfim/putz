/**
 * HostKeyDialog — modal for SSH host key verification.
 *
 * Shows the server's fingerprint on first connection (TOFU) or
 * displays a MITM warning when the host key has changed.
 *
 * Actions:
 * - Accept (TOFU): save key to known_hosts and continue
 * - Reject: abort the connection
 */
import type { HostKeyPayload } from "./connectionTypes";
import "./Terminal.css";

interface HostKeyDialogProps {
  /** Host key information from the backend event. */
  hostKey: HostKeyPayload;
  /** Host name (used for display, defaults to hostKey.host). */
  host?: string;
  /** Callback when user accepts the host key. */
  onAccept: () => void;
  /** Callback when user rejects the host key. */
  onReject: () => void;
}

/** Modal dialog for SSH host key verification. */
export function HostKeyDialog({
  hostKey,
  host,
  onAccept,
  onReject,
}: HostKeyDialogProps) {
  const isChanged = hostKey.action === "changed";
  const displayHost = host ?? hostKey.host;

  return (
    <div className="terminal-dialog-overlay" data-testid="hostkey-dialog">
      <div
        className="terminal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hostkey-dialog-title"
      >
        {isChanged ? (
          <>
            <h2
              id="hostkey-dialog-title"
              className="terminal-dialog-title terminal-dialog-warning"
            >
              ⚠️ WARNING: HOST KEY CHANGED
            </h2>
            <p className="terminal-dialog-text">
              The host key for <strong>{displayHost}:{hostKey.port}</strong> has
              changed! This could indicate a man-in-the-middle attack.
            </p>
            <div className="terminal-dialog-details">
              <div className="terminal-dialog-field">
                <label>Key Type:</label>
                <span>{hostKey.keyType}</span>
              </div>
              <div className="terminal-dialog-field">
                <label>New Fingerprint:</label>
                <code>{hostKey.fingerprint}</code>
              </div>
              {hostKey.expectedFingerprint && (
                <div className="terminal-dialog-field">
                  <label>Expected Fingerprint:</label>
                  <code>{hostKey.expectedFingerprint}</code>
                </div>
              )}
            </div>
            <p className="terminal-dialog-text terminal-dialog-danger">
              If you did not expect this change, do NOT continue.
              Contact your system administrator.
            </p>
          </>
        ) : (
          <>
            <h2
              id="hostkey-dialog-title"
              className="terminal-dialog-title"
            >
              New SSH Host Key
            </h2>
            <p className="terminal-dialog-text">
              The authenticity of host <strong>{displayHost}:{hostKey.port}</strong>{" "}
              can&apos;t be established.
            </p>
            <div className="terminal-dialog-details">
              <div className="terminal-dialog-field">
                <label>Key Type:</label>
                <span>{hostKey.keyType}</span>
              </div>
              <div className="terminal-dialog-field">
                <label>Fingerprint:</label>
                <code>{hostKey.fingerprint}</code>
              </div>
            </div>
            <p className="terminal-dialog-text">
              Are you sure you want to continue connecting?
              The key will be saved to known hosts.
            </p>
          </>
        )}

        <div className="terminal-dialog-actions">
          <button
            className="terminal-dialog-btn terminal-dialog-btn-secondary"
            onClick={onReject}
            type="button"
            data-testid="hostkey-reject"
          >
            Reject
          </button>
          <button
            className={`terminal-dialog-btn ${
              isChanged
                ? "terminal-dialog-btn-danger"
                : "terminal-dialog-btn-primary"
            }`}
            onClick={onAccept}
            type="button"
            data-testid="hostkey-accept"
          >
            {isChanged ? "Accept Anyway" : "Accept & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
