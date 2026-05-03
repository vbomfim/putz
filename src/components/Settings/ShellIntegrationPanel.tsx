/**
 * ShellIntegrationPanel — Settings section for managing shell integration.
 *
 * Shows per-shell cards for detected tier-1 shells with install/uninstall
 * actions. Provides "Install for all detected" bulk action.
 *
 * Part of S3 (Modern Terminal Protocols epic #98).
 *
 * @module ShellIntegrationPanel
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CmdRegistryConfirmDialog } from "./CmdRegistryConfirmDialog";

// ── Types ────────────────────────────────────────────────────────────

/** Installation status mirroring Rust's InstallStatus enum. */
type InstallStatus = "NotInstalled" | "Installed" | "CustomModification";

/** Shell info returned by shell_integration_detect IPC. */
interface ShellInfo {
  id: string;
  name: string;
  binary_path: string;
  version: string;
  dotfile_path: string;
  dotfile_exists: boolean;
  status: InstallStatus;
}

/** Result from install/uninstall IPC commands. */
interface InstallResult {
  success: boolean;
  dotfile_path: string;
  backup_path: string | null;
  message: string;
}

// ── Status helpers ───────────────────────────────────────────────────

function statusBadge(status: InstallStatus): {
  icon: string;
  label: string;
  color: string;
} {
  switch (status) {
    case "Installed":
      return {
        icon: "✅",
        label: "Installed",
        color: "var(--color-success, #4caf50)",
      };
    case "CustomModification":
      return {
        icon: "⚠️",
        label: "Custom modification",
        color: "var(--color-warning, #ff9800)",
      };
    case "NotInstalled":
    default:
      return {
        icon: "❌",
        label: "Not installed",
        color: "var(--text-secondary, #888)",
      };
  }
}

// ── Component ────────────────────────────────────────────────────────

export function ShellIntegrationPanel() {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [snippetVisible, setSnippetVisible] = useState<Record<string, boolean>>(
    {},
  );
  const [snippetContent, setSnippetContent] = useState<Record<string, string>>(
    {},
  );
  const [actionMessage, setActionMessage] = useState<Record<string, string>>(
    {},
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cmdDialogMode, setCmdDialogMode] = useState<
    "install" | "uninstall" | null
  >(null);

  // ── Detection ────────────────────────────────────────────────────

  const detectShells = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const detected = await invoke<ShellInfo[]>("shell_integration_detect");
      setShells(detected);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    detectShells();
  }, [detectShells]);

  // ── Actions ──────────────────────────────────────────────────────

  const handleInstall = useCallback(
    async (shellId: string) => {
      setBusy((b) => ({ ...b, [shellId]: true }));
      setActionMessage((m) => ({ ...m, [shellId]: "" }));
      try {
        const result = await invoke<InstallResult>(
          "shell_integration_install",
          {
            shellId,
          },
        );
        setActionMessage((m) => ({ ...m, [shellId]: result.message }));
        await detectShells();
      } catch (e) {
        setActionMessage((m) => ({ ...m, [shellId]: `Error: ${String(e)}` }));
      } finally {
        setBusy((b) => ({ ...b, [shellId]: false }));
      }
    },
    [detectShells],
  );

  const handleUninstall = useCallback(
    async (shellId: string) => {
      setBusy((b) => ({ ...b, [shellId]: true }));
      setActionMessage((m) => ({ ...m, [shellId]: "" }));
      try {
        const result = await invoke<InstallResult>(
          "shell_integration_uninstall",
          {
            shellId,
          },
        );
        setActionMessage((m) => ({ ...m, [shellId]: result.message }));
        await detectShells();
      } catch (e) {
        setActionMessage((m) => ({ ...m, [shellId]: `Error: ${String(e)}` }));
      } finally {
        setBusy((b) => ({ ...b, [shellId]: false }));
      }
    },
    [detectShells],
  );

  const handleShowSnippet = useCallback(
    async (shellId: string) => {
      setSnippetVisible((v) => ({ ...v, [shellId]: !v[shellId] }));
      if (!snippetContent[shellId]) {
        try {
          const content = await invoke<string>(
            "shell_integration_show_snippet",
            {
              shellId,
            },
          );
          setSnippetContent((c) => ({ ...c, [shellId]: content }));
        } catch (e) {
          setSnippetContent((c) => ({
            ...c,
            [shellId]: `Error: ${String(e)}`,
          }));
        }
      }
    },
    [snippetContent],
  );

  const handleInstallAll = useCallback(async () => {
    setBulkBusy(true);
    const installable = shells.filter(
      (s) => s.status === "NotInstalled" && s.id !== "cmd",
    );
    for (const shell of installable) {
      await handleInstall(shell.id);
    }
    setBulkBusy(false);
  }, [shells, handleInstall]);

  const handleCmdDialogClose = useCallback(
    async (result?: { action: string }) => {
      setCmdDialogMode(null);
      if (result && result.action !== "noop") {
        setActionMessage((m) => ({
          ...m,
          cmd: `Registry ${result.action} successfully`,
        }));
        await detectShells();
      }
    },
    [detectShells],
  );

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <section>
        <h3 style={sectionTitleStyle}>Shell Integration</h3>
        <p style={subtextStyle}>Detecting shells…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h3 style={sectionTitleStyle}>Shell Integration</h3>
        <p style={{ ...subtextStyle, color: "var(--color-error, #f44336)" }}>
          Failed to detect shells: {error}
        </p>
      </section>
    );
  }

  const installableCount = shells.filter(
    (s) => s.status === "NotInstalled" && s.id !== "cmd",
  ).length;

  return (
    <section>
      <h3 style={sectionTitleStyle}>Shell Integration</h3>
      <p style={subtextStyle}>
        Install shell integration to enable CWD reporting (OSC 7) and future
        command-boundary features (OSC 133).
      </p>

      {/* Install All button */}
      {installableCount > 0 && (
        <button
          onClick={handleInstallAll}
          disabled={bulkBusy}
          style={bulkButtonStyle}
          data-testid="install-all-btn"
        >
          {bulkBusy
            ? "Installing…"
            : `Install for all detected (${installableCount})`}
        </button>
      )}

      {/* Per-shell cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 8,
        }}
      >
        {shells.map((shell) => (
          <ShellCard
            key={shell.id}
            shell={shell}
            busy={busy[shell.id] || false}
            message={actionMessage[shell.id]}
            snippetVisible={snippetVisible[shell.id] || false}
            snippetContent={snippetContent[shell.id]}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onShowSnippet={handleShowSnippet}
            onCmdInstall={() => setCmdDialogMode("install")}
            onCmdUninstall={() => setCmdDialogMode("uninstall")}
          />
        ))}
      </div>

      {shells.length === 0 && (
        <p style={subtextStyle}>No tier-1 shells detected on this system.</p>
      )}

      {/* cmd.exe confirmation dialog */}
      {cmdDialogMode && (
        <CmdRegistryConfirmDialog
          mode={cmdDialogMode}
          onClose={handleCmdDialogClose}
        />
      )}
    </section>
  );
}

// ── Shell Card ───────────────────────────────────────────────────────

interface ShellCardProps {
  shell: ShellInfo;
  busy: boolean;
  message?: string;
  snippetVisible: boolean;
  snippetContent?: string;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onShowSnippet: (id: string) => void;
  onCmdInstall: () => void;
  onCmdUninstall: () => void;
}

function ShellCard({
  shell,
  busy,
  message,
  snippetVisible,
  snippetContent,
  onInstall,
  onUninstall,
  onShowSnippet,
  onCmdInstall,
  onCmdUninstall,
}: ShellCardProps) {
  const badge = statusBadge(shell.status);
  const isCmd = shell.id === "cmd";

  return (
    <div style={cardStyle} data-testid={`shell-card-${shell.id}`}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            🐚 {shell.name}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              marginLeft: 8,
            }}
          >
            {shell.binary_path}
            {shell.version &&
            shell.version !== "unknown" &&
            shell.version !== "N/A"
              ? `, ${shell.version.substring(0, 40)}`
              : ""}
          </span>
        </div>
        <span style={{ fontSize: 11, color: badge.color }}>
          {badge.icon} {badge.label}
        </span>
      </div>

      {/* Dotfile path */}
      <div
        style={{
          fontSize: 10,
          color: "var(--text-tertiary, #666)",
          marginTop: 2,
        }}
      >
        {isCmd ? "Registry: " : "Dotfile: "}
        {shell.dotfile_path}
        {!shell.dotfile_exists && !isCmd && (
          <span
            style={{ color: "var(--color-warning, #ff9800)", marginLeft: 4 }}
          >
            (will be created)
          </span>
        )}
      </div>

      {/* cmd.exe warning */}
      {isCmd && (
        <div
          style={{
            fontSize: 11,
            color: "var(--color-warning, #ff9800)",
            background: "var(--bg-warning, rgba(255,152,0,0.1))",
            padding: "6px 8px",
            borderRadius: 4,
            marginTop: 6,
          }}
          data-testid="cmd-warning"
        >
          ⚠ cmd.exe uses the Windows Registry AutoRun key. This runs every time
          cmd.exe opens. Install requires explicit confirmation and registry
          access.
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {shell.status === "NotInstalled" && !isCmd && (
          <button
            onClick={() => onInstall(shell.id)}
            disabled={busy}
            style={actionButtonStyle}
            data-testid={`install-btn-${shell.id}`}
          >
            {busy ? "Installing…" : "Install"}
          </button>
        )}
        {shell.status === "NotInstalled" && isCmd && (
          <button
            onClick={onCmdInstall}
            style={actionButtonStyle}
            data-testid="install-btn-cmd"
          >
            Install (with confirmation)…
          </button>
        )}
        {shell.status === "CustomModification" && !isCmd && (
          <button
            onClick={() => onInstall(shell.id)}
            disabled={busy}
            style={actionButtonStyle}
            data-testid={`reinstall-btn-${shell.id}`}
          >
            {busy ? "Reinstalling…" : "Reinstall"}
          </button>
        )}
        {(shell.status === "Installed" ||
          shell.status === "CustomModification") &&
          !isCmd && (
            <button
              onClick={() => onUninstall(shell.id)}
              disabled={busy}
              style={{
                ...actionButtonStyle,
                background: "var(--bg-danger, #f44336)",
              }}
              data-testid={`uninstall-btn-${shell.id}`}
            >
              {busy ? "Removing…" : "Uninstall"}
            </button>
          )}
        {(shell.status === "Installed" ||
          shell.status === "CustomModification") &&
          isCmd && (
            <button
              onClick={onCmdUninstall}
              style={{
                ...actionButtonStyle,
                background: "var(--bg-danger, #f44336)",
              }}
              data-testid="uninstall-btn-cmd"
            >
              Uninstall (with confirmation)…
            </button>
          )}
        <button
          onClick={() => onShowSnippet(shell.id)}
          style={{
            ...actionButtonStyle,
            background: "var(--bg-secondary, #555)",
          }}
          data-testid={`snippet-btn-${shell.id}`}
        >
          {snippetVisible ? "Hide Snippet" : "Show Snippet"}
        </button>
      </div>

      {/* Action message */}
      {message && (
        <div
          style={{
            fontSize: 11,
            color: message.startsWith("Error")
              ? "var(--color-error, #f44336)"
              : "var(--color-success, #4caf50)",
            marginTop: 4,
          }}
          data-testid={`message-${shell.id}`}
        >
          {message}
        </div>
      )}

      {/* Snippet display */}
      {snippetVisible && snippetContent && (
        <pre
          style={{
            fontSize: 11,
            background: "var(--bg-code, rgba(0,0,0,0.3))",
            padding: 8,
            borderRadius: 4,
            marginTop: 6,
            overflow: "auto",
            maxHeight: 200,
            whiteSpace: "pre-wrap",
            color: "var(--text-primary)",
          }}
          data-testid={`snippet-content-${shell.id}`}
        >
          {snippetContent}
        </pre>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  margin: "0 0 8px",
  color: "var(--text-primary)",
};

const subtextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary, #888)",
  margin: "0 0 8px",
};

const bulkButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  background: "var(--accent, #2196f3)",
  color: "#fff",
};

const cardStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 4,
  border: "1px solid var(--border-color, rgba(255,255,255,0.1))",
  background: "var(--bg-card, rgba(255,255,255,0.03))",
};

const actionButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  border: "none",
  borderRadius: 3,
  cursor: "pointer",
  background: "var(--accent, #2196f3)",
  color: "#fff",
};
