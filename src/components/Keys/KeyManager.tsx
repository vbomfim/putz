/**
 * KeyManager — list and manage stored SSH keys.
 *
 * Displays a list of key metadata (name, algorithm, fingerprint).
 * Provides context menu with:
 * - Copy Public Key — copies OpenSSH format public key to clipboard
 * - Delete — removes key with confirmation
 *
 * Controls to generate new keys via KeyGenerator.
 *
 * SECURITY: The list view shows metadata only — NO private keys.
 * Private keys never cross the IPC boundary.
 */
import { useState, useCallback, useEffect } from "react";
import type { SSHKeyMeta } from "./types";
import { KEY_ALGORITHM_LABELS } from "./types";
import { keyList, keyGetPublic, keyDelete } from "./keysApi";
import { KeyGenerator } from "./KeyGenerator";

export function KeyManager() {
  const [keys, setKeys] = useState<SSHKeyMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  /** Loads the key list from the backend. */
  const loadKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await keyList();
      setKeys(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  /** Opens the key generator form. */
  const handleGenerate = useCallback(() => {
    setShowGenerator(true);
    setContextMenu(null);
  }, []);

  /** Called after successful key generation. */
  const handleGenerated = useCallback(async () => {
    setShowGenerator(false);
    await loadKeys();
  }, [loadKeys]);

  /** Copies the public key to clipboard. */
  const handleCopyPublicKey = useCallback(async (id: string) => {
    try {
      setContextMenu(null);
      const publicKey = await keyGetPublic(id);
      await navigator.clipboard.writeText(publicKey);
      setCopySuccess(id);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Initiates delete confirmation. */
  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteConfirmId(id);
    setContextMenu(null);
  }, []);

  /** Confirms and executes deletion. */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return;
    try {
      await keyDelete(deleteConfirmId);
      setDeleteConfirmId(null);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deleteConfirmId, loadKeys]);

  /** Cancels delete confirmation. */
  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  /** Context menu dimensions for viewport clamping. */
  const CONTEXT_MENU_WIDTH = 180;
  const CONTEXT_MENU_HEIGHT = 80;

  /** Handles right-click context menu with viewport clamping. */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH);
      const y = Math.min(e.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT);
      setContextMenu({ x, y, id });
    },
    [],
  );

  /** Closes context menu on click outside. */
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  /** Truncates a fingerprint for display. */
  const formatFingerprint = (fp: string): string => {
    if (fp.length <= 50) return fp;
    return `${fp.slice(0, 50)}…`;
  };

  const deletingKey = keys.find((k) => k.id === deleteConfirmId);

  return (
    <div className="key-manager" data-testid="key-manager">
      {/* Header */}
      <div className="key-manager-header">
        <h3 className="key-manager-title">SSH Keys</h3>
        <button
          className="key-manager-add"
          onClick={handleGenerate}
          data-testid="key-manager-generate"
          aria-label="Generate SSH key"
        >
          +
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="key-manager-error"
          data-testid="key-manager-error"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Copy success toast */}
      {copySuccess && (
        <div
          className="key-manager-toast"
          data-testid="key-manager-copy-success"
        >
          Public key copied to clipboard
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div
          className="key-manager-loading"
          data-testid="key-manager-loading"
        >
          Loading…
        </div>
      )}

      {/* Key list */}
      {!isLoading && keys.length === 0 && (
        <div
          className="key-manager-empty"
          data-testid="key-manager-empty"
        >
          <p>No SSH keys stored.</p>
          <button
            className="key-manager-empty-btn"
            onClick={handleGenerate}
          >
            Generate Key
          </button>
        </div>
      )}

      {!isLoading && keys.length > 0 && (
        <ul
          className="key-list"
          data-testid="key-list"
          role="list"
        >
          {keys.map((key) => (
            <li
              key={key.id}
              className="key-list-item"
              data-testid={`key-item-${key.id}`}
              onContextMenu={(e) => handleContextMenu(e, key.id)}
            >
              <div className="key-list-item-info">
                <span className="key-list-item-name">{key.name}</span>
                <span className="key-list-item-algorithm">
                  {KEY_ALGORITHM_LABELS[key.algorithm]}
                </span>
              </div>
              <div className="key-list-item-meta">
                <span
                  className="key-list-item-fingerprint"
                  title={key.fingerprint}
                >
                  {formatFingerprint(key.fingerprint)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="key-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="key-context-menu"
        >
          <button
            onClick={() => handleCopyPublicKey(contextMenu.id)}
            data-testid="key-context-copy"
          >
            Copy Public Key
          </button>
          <hr />
          <button
            className="danger"
            onClick={() => handleDeleteRequest(contextMenu.id)}
            data-testid="key-context-delete"
          >
            Delete
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div
          className="key-delete-confirm-overlay"
          data-testid="key-delete-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="key-delete-title"
        >
          <div className="key-delete-confirm">
            <p id="key-delete-title">
              Delete SSH key{" "}
              <strong>{deletingKey?.name ?? deleteConfirmId}</strong>?
            </p>
            <p className="key-delete-confirm-warning">
              This will permanently delete the private key from disk.
            </p>
            <div className="key-delete-confirm-actions">
              <button
                onClick={handleDeleteCancel}
                data-testid="key-delete-cancel"
              >
                Cancel
              </button>
              <button
                className="danger"
                onClick={handleDeleteConfirm}
                data-testid="key-delete-confirm-btn"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generator modal */}
      {showGenerator && (
        <KeyGenerator
          onGenerated={handleGenerated}
          onCancel={() => setShowGenerator(false)}
        />
      )}
    </div>
  );
}
