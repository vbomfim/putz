/**
 * QuickConnect — Ctrl+K command bar for fast connections.
 *
 * A floating input bar that accepts free-form connection strings
 * and opens new terminal tabs with the parsed connection details.
 *
 * @module QuickConnect
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parseConnection } from "./parseConnection";
import type { ParsedConnection } from "./types";
import "./QuickConnect.css";

interface QuickConnectProps {
  /** Whether the bar is visible. */
  isOpen: boolean;
  /** Called when the bar should close. */
  onClose: () => void;
  /** Called when the user submits a connection. */
  onConnect: (connection: ParsedConnection) => void;
}

export function QuickConnect({
  isOpen,
  onClose,
  onConnect,
}: QuickConnectProps) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ParsedConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input when bar opens
  useEffect(() => {
    if (isOpen) {
      setInput("");
      setPreview(null);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Update preview as user types
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInput(value);
      setError(null);

      if (value.trim()) {
        const parsed = parseConnection(value);
        setPreview(parsed);
      } else {
        setPreview(null);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!input.trim()) {
        setError("Enter a connection string");
        return;
      }

      const parsed = parseConnection(input);
      if (!parsed) {
        setError("Invalid connection format");
        return;
      }

      onConnect(parsed);
      onClose();
    },
    [input, onConnect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="quickconnect-overlay"
      data-testid="quickconnect-panel"
      onClick={onClose}
    >
      <div
        className="quickconnect-bar"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quick connect"
      >
        <form onSubmit={handleSubmit} className="quickconnect-form">
          <span className="quickconnect-icon">⚡</span>
          <input
            ref={inputRef}
            className="quickconnect-input"
            type="text"
            placeholder="ssh admin@10.0.0.1, telnet 10.0.0.1 23, serial /dev/ttyUSB0"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            data-testid="quickconnect-input"
            aria-label="Quick connect input"
          />
          <button
            className="quickconnect-submit"
            type="submit"
            aria-label="Connect"
          >
            Connect
          </button>
        </form>

        {preview && (
          <div
            className="quickconnect-preview"
            data-testid="quickconnect-preview"
          >
            <span className="quickconnect-preview-protocol">
              {preview.protocol.toUpperCase()}
            </span>
            {preview.username && (
              <span className="quickconnect-preview-user">
                {preview.username}@
              </span>
            )}
            <span className="quickconnect-preview-host">{preview.host}</span>
            {preview.port && (
              <span className="quickconnect-preview-port">:{preview.port}</span>
            )}
          </div>
        )}

        {error && (
          <div className="quickconnect-error" data-testid="quickconnect-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
