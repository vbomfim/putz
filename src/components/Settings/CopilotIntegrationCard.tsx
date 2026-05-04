/**
 * CopilotIntegrationCard — first-run discovery for the Copilot CLI extension.
 *
 * Implements ticket #141 AC4:
 *   - Detects `gh copilot` on PATH (via `copilot_check_installed`).
 *   - If detected, surfaces install / uninstall buttons for the bundled
 *     `extensions/copilot-swarm/` colleague shim.
 *   - If not detected, surfaces a link to the install instructions.
 *
 * The card is dismissible — once dismissed, the user's preference is
 * persisted via the Settings store (`copilotCardDismissed`).
 *
 * @module components/Settings/CopilotIntegrationCard
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CopilotIntegrationStatus {
  ghCopilotAvailable: boolean;
  extensionDir: string | null;
  installed: boolean;
}

const DOCS_URL =
  "https://docs.github.com/en/copilot/github-copilot-in-the-cli";

/**
 * Replace the user's home dir prefix with `~` in error strings before
 * rendering, so absolute paths leaked from filesystem errors don't
 * appear in the UI. Best-effort — we don't have `os.homedir()` in the
 * browser, so we sniff `HOME`/`USERPROFILE` from common error patterns.
 *
 * @privacy Tier-2 — paths can encode usernames.
 */
function sanitizeUserPath(message: string): string {
  // Tauri error strings sometimes embed `/Users/<name>/...` or
  // `/home/<name>/...` or `C:\Users\<name>\...`. Collapse them to `~`.
  return message
    .replace(/\/Users\/[^/\s"']+/g, "~")
    .replace(/\/home\/[^/\s"']+/g, "~")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+/gi, "~");
}

interface Props {
  /** Whether the user has previously dismissed the card. */
  dismissed: boolean;
  /** Setter to persist dismissal. */
  onDismiss: () => void;
}

export function CopilotIntegrationCard({ dismissed, onDismiss }: Props) {
  const [status, setStatus] = useState<CopilotIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<CopilotIntegrationStatus>(
        "copilot_get_status",
      );
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(sanitizeUserPath(String(err)));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInstall = useCallback(
    async (overwrite: boolean) => {
      setBusy(true);
      setError(null);
      try {
        // Backend resolves the bundled extension dir from its own
        // resource_dir() — frontend cannot influence the source path
        // (defense against a frontend bug pointing at an arbitrary dir).
        await invoke<string>("copilot_install_extension", { overwrite });
        await refresh();
      } catch (err) {
        setError(sanitizeUserPath(String(err)));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const handleUninstall = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("copilot_uninstall_extension");
      await refresh();
    } catch (err) {
      setError(sanitizeUserPath(String(err)));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (dismissed) return null;
  if (!status) {
    return (
      <section
        role="region"
        aria-label="GitHub Copilot CLI integration"
        style={cardStyle}
      >
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Detecting GitHub Copilot CLI…
        </span>
      </section>
    );
  }

  const heading = status.ghCopilotAvailable
    ? "GitHub Copilot CLI detected"
    : "GitHub Copilot CLI not detected";

  return (
    <section
      role="region"
      aria-label="GitHub Copilot CLI integration"
      style={cardStyle}
    >
      <div style={headerRow}>
        <h3 style={h3Style}>{heading}</h3>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss Copilot integration card"
          style={dismissBtn}
        >
          ✕
        </button>
      </div>

      {status.ghCopilotAvailable ? (
        <>
          <p style={pStyle}>
            Putz can install a small shim into your Copilot CLI extensions
            directory. Once GitHub Copilot CLI gains an auto-load mechanism
            (or you wire it via shell integration — see T3), Copilot
            sessions inside Putz tabs will appear in the swarm. No data
            leaves your machine.
          </p>
          {status.installed && status.extensionDir && (
            <p style={pStyle}>
              Manual run for testing:{" "}
              <code style={{ fontSize: 10 }}>
                node {status.extensionDir}/putz-colleague/extension.mjs
              </code>{" "}
              inside a Putz tab.
            </p>
          )}
          {status.extensionDir && (
            <p style={pathStyle}>
              <span aria-hidden>📂</span> {status.extensionDir}
            </p>
          )}
          <div style={btnRow}>
            {status.installed ? (
              <>
                <span style={installedBadge} aria-label="Installed">
                  ✓ Installed
                </span>
                <button
                  type="button"
                  onClick={handleUninstall}
                  disabled={busy}
                  style={secondaryBtn}
                >
                  Uninstall
                </button>
                <button
                  type="button"
                  onClick={() => handleInstall(true)}
                  disabled={busy}
                  style={secondaryBtn}
                >
                  Reinstall
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleInstall(false)}
                disabled={busy}
                style={primaryBtn}
              >
                {busy ? "Installing…" : "Install Putz integration"}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={pStyle}>
            Install GitHub Copilot CLI to enable auto-registration of agent
            tabs as colleagues in Putz.
          </p>
          <div style={btnRow}>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer noopener"
              style={linkBtn}
            >
              Installation instructions →
            </a>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              style={secondaryBtn}
            >
              Re-check
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--hover-bg)",
  borderRadius: 8,
  padding: 16,
  marginTop: 12,
  background: "var(--bg-secondary)",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};

const h3Style: React.CSSProperties = {
  fontSize: 13,
  margin: 0,
  color: "var(--text-primary)",
};

const dismissBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 14,
  padding: "4px 8px",
  // WCAG 2.2 — 44x44 target via padding so the visual ✕ stays small.
  minWidth: 44,
  minHeight: 44,
};

const pStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  margin: "0 0 8px",
  lineHeight: 1.5,
};

const pathStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary, #888)",
  margin: "0 0 8px",
  fontFamily: "monospace",
};

const btnRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  border: "2px solid var(--accent)",
  borderRadius: 6,
  background: "var(--accent)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  minHeight: 44,
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  border: "1px solid var(--hover-bg)",
  borderRadius: 6,
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 12,
  minHeight: 44,
};

const linkBtn: React.CSSProperties = {
  ...secondaryBtn,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const installedBadge: React.CSSProperties = {
  fontSize: 12,
  color: "var(--success, #4caf50)",
  fontWeight: 600,
  padding: "8px 12px",
  border: "1px solid var(--success, #4caf50)",
  borderRadius: 6,
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--error, #f44336)",
  margin: "8px 0 0",
};
