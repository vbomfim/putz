/**
 * ForwardingPanel — runtime status panel for active forwarding tunnels.
 *
 * Shows a table of active tunnels with type, ports, bytes transferred,
 * active connections, and status indicators. Supports ad-hoc add/remove
 * of forwarding rules on active sessions.
 *
 * Refreshes tunnel status periodically (every 2 seconds) or on demand.
 *
 * @module ForwardingPanel
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ForwardingStatus,
  ForwardingRuleInput,
  ForwardingType,
} from "./types";
import {
  FORWARDING_TYPE_LABELS,
  formatBytes,
  statusIndicator,
} from "./types";
import {
  forwardingList,
  forwardingAdd,
  forwardingRemove,
} from "./forwardingApi";
import "./Forwarding.css";

/** Status refresh interval in milliseconds. */
const REFRESH_INTERVAL_MS = 2000;

interface ForwardingPanelProps {
  /** SSH connection ID to show tunnels for. */
  connectionId: string;
  /** Callback when the panel is closed. */
  onClose?: () => void;
}

/**
 * ForwardingPanel — shows active tunnels with metrics and controls.
 */
export function ForwardingPanel({
  connectionId,
  onClose,
}: ForwardingPanelProps) {
  const [tunnels, setTunnels] = useState<ForwardingStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Fetches tunnel status from the backend. */
  const refresh = useCallback(async () => {
    try {
      const result = await forwardingList(connectionId);
      setTunnels(result);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  // Initial load and periodic refresh
  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  /** Removes a tunnel. */
  const handleRemove = useCallback(
    async (tunnelId: string) => {
      try {
        await forwardingRemove(tunnelId);
        await refresh();
      } catch (err) {
        setError(String(err));
      }
    },
    [refresh],
  );

  /** Adds a new ad-hoc forwarding rule. */
  const handleAdd = useCallback(
    async (rule: ForwardingRuleInput) => {
      try {
        await forwardingAdd(connectionId, rule);
        setShowAddForm(false);
        await refresh();
      } catch (err) {
        setError(String(err));
      }
    },
    [connectionId, refresh],
  );

  if (isLoading) {
    return (
      <div className="forwarding-panel forwarding-loading">Loading tunnels…</div>
    );
  }

  return (
    <div className="forwarding-panel" data-testid="forwarding-panel">
      {/* Toolbar */}
      <div className="forwarding-toolbar">
        <span className="forwarding-title">Port Forwarding</span>
        <span className="forwarding-count">
          {tunnels.length} tunnel{tunnels.length !== 1 ? "s" : ""}
        </span>
        <div className="forwarding-toolbar-actions">
          <button
            className="forwarding-btn"
            onClick={() => setShowAddForm(!showAddForm)}
            title="Add forwarding rule"
            data-testid="toggle-add-form"
          >
            {showAddForm ? "Cancel" : "+ Add"}
          </button>
          <button
            className="forwarding-btn"
            onClick={refresh}
            title="Refresh status"
          >
            ↻
          </button>
          {onClose && (
            <button
              className="forwarding-btn forwarding-btn-close"
              onClick={onClose}
              title="Close panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="forwarding-error-banner" data-testid="error-banner">
          {error}
        </div>
      )}

      {/* Ad-hoc add form */}
      {showAddForm && <AdHocAddForm onAdd={handleAdd} />}

      {/* Tunnel list */}
      {tunnels.length === 0 ? (
        <div className="forwarding-empty" data-testid="empty-state">
          No active forwarding tunnels.
          <br />
          Click &ldquo;+ Add&rdquo; to create one.
        </div>
      ) : (
        <div className="forwarding-table-wrapper">
          <table className="forwarding-table" data-testid="tunnel-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Local</th>
                <th>Remote</th>
                <th>TX</th>
                <th>RX</th>
                <th>Conns</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tunnels.map((tunnel) => (
                <tr key={tunnel.id} data-testid={`tunnel-${tunnel.id}`}>
                  <td title={tunnel.error ?? tunnel.status}>
                    {statusIndicator(tunnel.status)}
                  </td>
                  <td>{FORWARDING_TYPE_LABELS[tunnel.forwardingType]}</td>
                  <td>
                    {tunnel.bindAddress}:{tunnel.localPort}
                  </td>
                  <td>
                    {tunnel.remoteHost
                      ? `${tunnel.remoteHost}:${tunnel.remotePort}`
                      : "—"}
                  </td>
                  <td>{formatBytes(tunnel.bytesTx)}</td>
                  <td>{formatBytes(tunnel.bytesRx)}</td>
                  <td>{tunnel.activeConnections}</td>
                  <td>
                    <button
                      className="forwarding-btn-remove"
                      onClick={() => handleRemove(tunnel.id)}
                      title="Remove tunnel"
                      data-testid={`remove-${tunnel.id}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Ad-hoc Add Form ──────────────────────────────────────────────

interface AdHocAddFormProps {
  onAdd: (rule: ForwardingRuleInput) => void;
}

/** Inline form for adding a forwarding rule to an active session. */
function AdHocAddForm({ onAdd }: AdHocAddFormProps) {
  const [type, setType] = useState<ForwardingType>("local");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("");

  const handleSubmit = () => {
    const lp = parseInt(localPort, 10);
    if (isNaN(lp) || lp < 1 || lp > 65535) return;

    if (type !== "dynamic") {
      if (!remoteHost.trim()) return;
      const rp = parseInt(remotePort, 10);
      if (isNaN(rp) || rp < 1 || rp > 65535) return;
    }

    onAdd({
      forwardingType: type,
      localPort: lp,
      remoteHost: type !== "dynamic" ? remoteHost.trim() : undefined,
      remotePort:
        type !== "dynamic" ? parseInt(remotePort, 10) : undefined,
    });
  };

  return (
    <div className="forwarding-adhoc-form" data-testid="adhoc-form">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as ForwardingType)}
        data-testid="adhoc-type"
      >
        <option value="local">Local (-L)</option>
        <option value="remote">Remote (-R)</option>
        <option value="dynamic">Dynamic (-D)</option>
      </select>
      <input
        type="number"
        value={localPort}
        onChange={(e) => setLocalPort(e.target.value)}
        placeholder="Local port"
        data-testid="adhoc-local-port"
      />
      {type !== "dynamic" && (
        <>
          <input
            type="text"
            value={remoteHost}
            onChange={(e) => setRemoteHost(e.target.value)}
            placeholder="Remote host"
            data-testid="adhoc-remote-host"
          />
          <input
            type="number"
            value={remotePort}
            onChange={(e) => setRemotePort(e.target.value)}
            placeholder="Remote port"
            data-testid="adhoc-remote-port"
          />
        </>
      )}
      <button
        className="forwarding-btn"
        onClick={handleSubmit}
        data-testid="adhoc-submit"
      >
        Add
      </button>
    </div>
  );
}
