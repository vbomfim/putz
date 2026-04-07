/**
 * BackupButton — toolbar button to capture and save device configurations.
 *
 * When clicked, prompts for a hostname and command (defaults to
 * "show running-config"), sends the command to the active session,
 * captures the terminal output, and saves it via the Rust backend.
 */
import { useCallback, useState } from "react";
import { saveBackup } from "./backupApi";
import type { SaveBackupResponse } from "./types";
import "./Backup.css";

interface BackupButtonProps {
  /** Callback to get the current terminal buffer text. */
  getTerminalContent: () => string;
  /** Default hostname for the backup filename. */
  hostname?: string;
}

export function BackupButton({
  getTerminalContent,
  hostname = "device",
}: BackupButtonProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastResult, setLastResult] = useState<SaveBackupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBackup = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setLastResult(null);

    try {
      const content = getTerminalContent();
      if (!content.trim()) {
        setError("No terminal content to backup");
        setIsSaving(false);
        return;
      }

      const result = await saveBackup({ hostname, content });
      setLastResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSaving(false);
    }
  }, [getTerminalContent, hostname]);

  return (
    <div className="backup-container" data-testid="backup-container">
      <button
        className="backup-btn"
        onClick={handleBackup}
        disabled={isSaving}
        type="button"
        data-testid="backup-btn"
        title="Save terminal output as backup"
      >
        {isSaving ? "Saving…" : "💾 Backup"}
      </button>
      {lastResult && (
        <span
          className="backup-success"
          data-testid="backup-success"
          title={lastResult.path}
        >
          ✓ Saved ({(lastResult.size / 1024).toFixed(1)} KB)
        </span>
      )}
      {error && (
        <span className="backup-error" data-testid="backup-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
