/**
 * CredentialManager — list and manage stored credentials.
 *
 * Displays a list of credential metadata (name, username, type, last used).
 * Provides controls to add, edit, and delete credentials.
 * Delete operations require confirmation.
 *
 * SECURITY: The list view shows metadata only — NO secrets.
 * Secrets are only fetched when the editor is opened.
 */
import { useState, useCallback, useEffect } from "react";
import type { CredentialMeta, Credential, SetCredentialInput } from "./types";
import { CREDENTIAL_TYPE_LABELS } from "./types";
import { vaultList, vaultGet, vaultSet, vaultDelete } from "./vaultApi";
import { CredentialEditor } from "./CredentialEditor";

interface CredentialManagerProps {
  /** Called when a credential is selected (for session editor integration). */
  onSelect?: (id: string) => void;
  /** Whether to show in selection mode (for session editor). */
  selectionMode?: boolean;
}

export function CredentialManager({
  onSelect,
  selectionMode = false,
}: CredentialManagerProps) {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingCredential, setEditingCredential] = useState<
    Credential | undefined
  >(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);

  /** Loads the credential list from the backend. */
  const loadCredentials = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await vaultList();
      setCredentials(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  /** Opens the editor in create mode. */
  const handleAdd = useCallback(() => {
    setEditingCredential(undefined);
    setShowEditor(true);
    setContextMenu(null);
  }, []);

  /** Opens the editor in edit mode, fetching the full credential. */
  const handleEdit = useCallback(async (id: string) => {
    try {
      setContextMenu(null);
      const cred = await vaultGet(id);
      setEditingCredential(cred);
      setShowEditor(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Saves a credential (create or update). */
  const handleSave = useCallback(
    async (input: SetCredentialInput) => {
      try {
        setIsSaving(true);
        await vaultSet(input);
        setShowEditor(false);
        setEditingCredential(undefined);
        await loadCredentials();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    },
    [loadCredentials],
  );

  /** Initiates delete confirmation. */
  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteConfirmId(id);
    setContextMenu(null);
  }, []);

  /** Confirms and executes deletion. */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return;
    try {
      await vaultDelete(deleteConfirmId);
      setDeleteConfirmId(null);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deleteConfirmId, loadCredentials]);

  /** Cancels delete confirmation. */
  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  /** Context menu dimensions for viewport clamping. */
  const CONTEXT_MENU_WIDTH = 160;
  const CONTEXT_MENU_HEIGHT = 80;

  /** Handles right-click context menu with viewport clamping. */
  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH);
    const y = Math.min(e.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT);
    setContextMenu({ x, y, id });
  }, []);

  /** Closes context menu on click outside. */
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  /** Formats a date string for display. */
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const deletingCredential = credentials.find((c) => c.id === deleteConfirmId);

  return (
    <div className="credential-manager" data-testid="credential-manager">
      {/* Header */}
      <div className="credential-manager-header">
        <h3 className="credential-manager-title">Credentials</h3>
        <button
          className="credential-manager-add"
          onClick={handleAdd}
          data-testid="credential-manager-add"
          aria-label="Add credential"
        >
          +
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="credential-manager-error"
          data-testid="credential-manager-error"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div
          className="credential-manager-loading"
          data-testid="credential-manager-loading"
        >
          Loading…
        </div>
      )}

      {/* Credential list */}
      {!isLoading && credentials.length === 0 && (
        <div
          className="credential-manager-empty"
          data-testid="credential-manager-empty"
        >
          <p>No credentials stored.</p>
          <button className="credential-manager-empty-btn" onClick={handleAdd}>
            Add Credential
          </button>
        </div>
      )}

      {!isLoading && credentials.length > 0 && (
        <ul
          className="credential-list"
          data-testid="credential-list"
          role="list"
        >
          {credentials.map((cred) => (
            <li
              key={cred.id}
              className="credential-list-item"
              data-testid={`credential-item-${cred.id}`}
              onContextMenu={(e) => handleContextMenu(e, cred.id)}
              onClick={
                selectionMode && onSelect ? () => onSelect(cred.id) : undefined
              }
              onDoubleClick={() => handleEdit(cred.id)}
            >
              <div className="credential-list-item-info">
                <span className="credential-list-item-name">{cred.name}</span>
                <span className="credential-list-item-username">
                  {cred.username}
                </span>
              </div>
              <div className="credential-list-item-meta">
                <span className="credential-list-item-type">
                  {CREDENTIAL_TYPE_LABELS[cred.credentialType]}
                </span>
                <span className="credential-list-item-date">
                  {formatDate(cred.lastUsed)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="credential-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="credential-context-menu"
        >
          <button
            onClick={() => handleEdit(contextMenu.id)}
            data-testid="credential-context-edit"
          >
            Edit
          </button>
          <hr />
          <button
            className="danger"
            onClick={() => handleDeleteRequest(contextMenu.id)}
            data-testid="credential-context-delete"
          >
            Delete
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div
          className="credential-delete-confirm-overlay"
          data-testid="credential-delete-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="credential-delete-title"
        >
          <div className="credential-delete-confirm">
            <p id="credential-delete-title">
              Delete credential{" "}
              <strong>{deletingCredential?.name ?? deleteConfirmId}</strong>?
            </p>
            <p className="credential-delete-confirm-warning">
              This will permanently remove the credential from the OS keychain.
            </p>
            <div className="credential-delete-confirm-actions">
              <button
                onClick={handleDeleteCancel}
                data-testid="credential-delete-cancel"
              >
                Cancel
              </button>
              <button
                className="danger"
                onClick={handleDeleteConfirm}
                data-testid="credential-delete-confirm-btn"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <CredentialEditor
          credential={editingCredential}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false);
            setEditingCredential(undefined);
          }}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
