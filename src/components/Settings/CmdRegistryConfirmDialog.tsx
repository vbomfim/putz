/**
 * CmdRegistryConfirmDialog — Confirmation dialog for cmd.exe registry install.
 *
 * Shows the user exactly what registry value will be written before
 * applying, per the spec's "show before write" safeguard.
 *
 * @module CmdRegistryConfirmDialog
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────

interface CmdPreview {
  has_existing_entries: boolean;
  has_existing_putz_segment: boolean;
  proposed_autorun: string;
  snippet_path: string;
  explanation: string;
}

interface RegistryChange {
  previous: string;
  new: string;
  action: string;
  snippet_path: string;
}

interface CmdRegistryConfirmDialogProps {
  /** "install" or "uninstall" */
  mode: "install" | "uninstall";
  /** Called after successful install/uninstall or on cancel. */
  onClose: (result?: RegistryChange) => void;
}

// ── Component ────────────────────────────────────────────────────────

export function CmdRegistryConfirmDialog({
  mode,
  onClose,
}: CmdRegistryConfirmDialogProps) {
  const [preview, setPreview] = useState<CmdPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [existingAutorun, setExistingAutorun] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load preview on mount.
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const p = await invoke<CmdPreview>("shell_integration_cmd_preview");
        setPreview(p);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleConfirm = useCallback(async () => {
    setApplying(true);
    try {
      const cmd =
        mode === "install"
          ? "shell_integration_cmd_install_confirmed"
          : "shell_integration_cmd_uninstall";
      const result = await invoke<RegistryChange>(cmd);
      onClose(result);
    } catch (e) {
      setError(String(e));
      setApplying(false);
    }
  }, [mode, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={overlayStyle} data-testid="cmd-confirm-dialog">
      <div style={dialogStyle}>
        <h4
          style={{
            margin: "0 0 8px",
            fontSize: 14,
            color: "var(--text-primary)",
          }}
        >
          {mode === "install"
            ? "Enable cmd.exe shell integration"
            : "Remove cmd.exe shell integration"}
        </h4>

        {loading && (
          <p
            style={{ fontSize: 12, color: "var(--text-secondary)" }}
            data-testid="cmd-dialog-loading"
          >
            Reading registry…
          </p>
        )}

        {error && (
          <p
            style={{ fontSize: 12, color: "var(--color-error, #f44336)" }}
            data-testid="cmd-dialog-error"
          >
            {error}
          </p>
        )}

        {preview && !loading && (
          <>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                margin: "0 0 8px",
              }}
            >
              Putz needs to{" "}
              {mode === "install" ? "add an entry to" : "remove its entry from"}{" "}
              your Windows Registry under:
            </p>

            <code
              style={{
                display: "block",
                fontSize: 11,
                background: "var(--bg-code, rgba(0,0,0,0.3))",
                padding: "4px 8px",
                borderRadius: 3,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              HKEY_CURRENT_USER\Software\Microsoft\Command Processor\AutoRun
            </code>

            <p
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                margin: "0 0 8px",
              }}
              data-testid="cmd-dialog-explanation"
            >
              {preview.explanation}
            </p>

            {/* Existing entries indicator */}
            {preview.has_existing_entries && (
              <details style={{ marginBottom: 6 }}>
                <summary
                  style={{
                    fontSize: 11,
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                  }}
                  data-testid="cmd-existing-toggle"
                  onClick={() => {
                    if (existingAutorun === null && !loadingExisting) {
                      setLoadingExisting(true);
                      invoke<string>("shell_integration_cmd_show_existing")
                        .then((val) => setExistingAutorun(val))
                        .catch(() => setExistingAutorun("(failed to load)"))
                        .finally(() => setLoadingExisting(false));
                    }
                  }}
                >
                  Show existing AutoRun entries (from other applications)
                </summary>
                <pre style={previewCodeStyle} data-testid="cmd-existing-value">
                  {loadingExisting
                    ? "Loading…"
                    : (existingAutorun ?? "(click to load)")}
                </pre>
              </details>
            )}

            {/* Proposed value */}
            <details style={{ marginBottom: 6 }} open>
              <summary
                style={{
                  fontSize: 11,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                }}
                data-testid="cmd-proposed-toggle"
              >
                Show proposed AutoRun value
              </summary>
              <pre style={previewCodeStyle} data-testid="cmd-proposed-value">
                {preview.proposed_autorun || "(will be deleted)"}
              </pre>
            </details>

            <p
              style={{
                fontSize: 11,
                color: "var(--color-warning, #ff9800)",
                margin: "8px 0",
                fontStyle: "italic",
              }}
            >
              {mode === "install"
                ? "This makes Putz's prompt script run every time you open cmd.exe — including outside Putz. Existing AutoRun chains from other applications are preserved. The change is reversible via Uninstall."
                : "Only Putz's segment will be removed. Other applications' AutoRun entries are preserved."}
            </p>
          </>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 12,
          }}
        >
          <button
            onClick={handleCancel}
            style={cancelButtonStyle}
            data-testid="cmd-cancel-btn"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={applying || loading || !!error}
            style={{
              ...confirmButtonStyle,
              opacity: applying || loading || error ? 0.5 : 1,
            }}
            data-testid="cmd-confirm-btn"
          >
            {applying
              ? "Applying…"
              : mode === "install"
                ? "Install"
                : "Uninstall"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--bg-primary, #1e1e1e)",
  border: "1px solid var(--border-color, rgba(255,255,255,0.15))",
  borderRadius: 8,
  padding: "16px 20px",
  maxWidth: 500,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};

const previewCodeStyle: React.CSSProperties = {
  fontSize: 10,
  background: "var(--bg-code, rgba(0,0,0,0.3))",
  padding: "6px 8px",
  borderRadius: 3,
  color: "var(--text-primary)",
  overflow: "auto",
  maxHeight: 80,
  whiteSpace: "pre-wrap",
  margin: "4px 0 0",
};

const cancelButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 14px",
  border: "1px solid var(--border-color, rgba(255,255,255,0.2))",
  borderRadius: 4,
  cursor: "pointer",
  background: "transparent",
  color: "var(--text-primary)",
};

const confirmButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 14px",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  background: "var(--accent, #2196f3)",
  color: "#fff",
};
