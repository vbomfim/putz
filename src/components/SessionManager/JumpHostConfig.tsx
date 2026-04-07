/**
 * JumpHostConfig — jump host selection UI for the session editor.
 *
 * Allows users to select an existing SSH session as a jump host
 * (ProxyJump). Displays the resolved hop chain visually when
 * multi-hop chains are configured.
 *
 * Only SSH sessions are available as jump hosts. The component
 * filters the session list to show only SSH protocol sessions
 * and excludes the session being edited (to prevent self-reference).
 */
import { useState, useEffect, useCallback } from "react";
import type { SessionProfile } from "./types";
import { sessionList } from "./sessionApi";
import type { SessionNode } from "./types";

interface JumpHostConfigProps {
  /** Currently selected jump host session ID. */
  jumpHostId?: string;
  /** Session ID being edited (to exclude from dropdown). */
  currentSessionId?: string;
  /** Called when jump host selection changes. */
  onChange: (jumpHostId: string | undefined) => void;
}

/** Flattens a session tree into a flat list of SSH sessions. */
function flattenSshSessions(
  nodes: SessionNode[],
  excludeId?: string,
): SessionProfile[] {
  const sessions: SessionProfile[] = [];

  function walk(items: SessionNode[]) {
    for (const node of items) {
      if (node.type === "folder") {
        walk(node.children);
      } else if (
        node.type === "session" &&
        node.protocol === "ssh" &&
        node.id !== excludeId
      ) {
        sessions.push({
          id: node.id,
          name: node.name,
          folderId: "",
          protocol: node.protocol,
          host: node.host,
          port: node.port,
          username: node.username,
          createdAt: "",
          updatedAt: "",
        });
      }
    }
  }

  walk(nodes);
  return sessions;
}

/** Resolves the display chain: target ← hop1 ← hop2 ... */
function resolveChain(
  jumpHostId: string | undefined,
  sessions: SessionProfile[],
): SessionProfile[] {
  if (!jumpHostId) return [];

  const chain: SessionProfile[] = [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  let currentId: string | undefined = jumpHostId;
  const seen = new Set<string>();

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const session = sessionMap.get(currentId);
    if (!session) break;
    chain.push(session);
    currentId = session.jumpHostId;
  }

  // Reverse so the first hop (TCP connection) is shown first
  return chain.reverse();
}

export function JumpHostConfig({
  jumpHostId,
  currentSessionId,
  onChange,
}: JumpHostConfigProps) {
  const [sshSessions, setSshSessions] = useState<SessionProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch SSH sessions on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const tree = await sessionList();
        if (!cancelled) {
          setSshSessions(flattenSshSessions(tree, currentSessionId));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSessions();
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onChange(value || undefined);
    },
    [onChange],
  );

  const chain = resolveChain(jumpHostId, sshSessions);

  if (loading) {
    return (
      <div className="session-editor-field" data-testid="jump-host-loading">
        <label>Jump Host</label>
        <span className="session-editor-hint">Loading sessions…</span>
      </div>
    );
  }

  return (
    <div className="session-editor-jump-host" data-testid="jump-host-config">
      {/* Jump host selector */}
      <div className="session-editor-field">
        <label htmlFor="session-jump-host">Jump Host</label>
        <select
          id="session-jump-host"
          value={jumpHostId ?? ""}
          onChange={handleChange}
          data-testid="jump-host-select"
        >
          <option value="">None (direct connection)</option>
          {sshSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.host ? ` (${s.host})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Chain visualization */}
      {chain.length > 0 && (
        <div
          className="jump-host-chain"
          data-testid="jump-host-chain"
        >
          <span className="jump-host-chain-label">Connection path:</span>
          <span className="jump-host-chain-path">
            {chain.map((hop, i) => (
              <span key={hop.id} className="jump-host-chain-hop">
                {i > 0 && <span className="jump-host-chain-arrow"> → </span>}
                <span className="jump-host-chain-name" title={hop.host}>
                  {hop.name}
                </span>
              </span>
            ))}
            <span className="jump-host-chain-arrow"> → </span>
            <span className="jump-host-chain-target">Target</span>
          </span>
        </div>
      )}
    </div>
  );
}
