/**
 * AuthPromptDialog — modal for SSH authentication input.
 *
 * Shows a password/passphrase input when credentials aren't stored
 * in the vault. Emits the entered password back to the backend.
 *
 * SECURITY: The password is sent via IPC and handled entirely in Rust.
 * It is never stored in React state beyond the form submission.
 */
import { useState } from "react";
import type { AuthPromptPayload } from "./connectionTypes";
import "./Terminal.css";

interface AuthPromptDialogProps {
  /** Auth prompt information from the backend event. */
  authPrompt: AuthPromptPayload;
  /** Host being connected to (for display). */
  host: string;
  /** Callback when user submits credentials. */
  onSubmit: (password: string) => void;
  /** Callback when user cancels authentication. */
  onCancel: () => void;
}

/** Modal dialog for SSH password/passphrase input. */
export function AuthPromptDialog({
  authPrompt,
  host,
  onSubmit,
  onCancel,
}: AuthPromptDialogProps) {
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
      setPassword(""); // Clear immediately after submission
    }
  };

  return (
    <div className="terminal-dialog-overlay" data-testid="auth-prompt-dialog">
      <div
        className="terminal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <h2 id="auth-dialog-title" className="terminal-dialog-title">
          SSH Authentication
        </h2>
        <p className="terminal-dialog-text">
          Enter password for{" "}
          <strong>
            {authPrompt.username}@{host}
          </strong>
        </p>

        <form onSubmit={handleSubmit}>
          <div className="terminal-dialog-form-group">
            <label htmlFor="ssh-password">Password:</label>
            <input
              id="ssh-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
              className="terminal-dialog-input"
              data-testid="auth-password-input"
            />
          </div>

          <div className="terminal-dialog-actions">
            <button
              className="terminal-dialog-btn terminal-dialog-btn-secondary"
              onClick={onCancel}
              type="button"
              data-testid="auth-cancel"
            >
              Cancel
            </button>
            <button
              className="terminal-dialog-btn terminal-dialog-btn-primary"
              type="submit"
              disabled={!password.trim()}
              data-testid="auth-submit"
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
