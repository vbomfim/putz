/**
 * ScriptLibrary — list of saved automation scripts.
 *
 * Displays all scripts with name, description, and last-modified date.
 * Supports selecting a script for editing, running, or deleting.
 *
 * @module ScriptLibrary
 */
import { useCallback, useState } from "react";
import type { ScriptMeta } from "./types";

interface ScriptLibraryProps {
  /** List of saved scripts. */
  scripts: ScriptMeta[];
  /** Called when user selects a script to edit. */
  onSelect: (id: string) => void;
  /** Called when user clicks New Script. */
  onCreate: () => void;
  /** Called when user deletes a script. */
  onDelete: (id: string) => void;
  /** Whether scripts are still loading. */
  isLoading?: boolean;
}

/**
 * Script library panel showing saved scripts.
 */
export function ScriptLibrary({
  scripts,
  onSelect,
  onCreate,
  onDelete,
  isLoading = false,
}: ScriptLibraryProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleDelete = useCallback(
    (id: string) => {
      if (deleteConfirm === id) {
        onDelete(id);
        setDeleteConfirm(null);
      } else {
        setDeleteConfirm(id);
        // Auto-reset after 3 seconds if not confirmed
        setTimeout(
          () => setDeleteConfirm((prev) => (prev === id ? null : prev)),
          3000,
        );
      }
    },
    [deleteConfirm, onDelete],
  );

  const formatDate = (isoString: string): string => {
    return new Date(isoString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className="script-library"
      data-testid="script-library"
      role="region"
      aria-label="Script Library"
    >
      {/* Header */}
      <div className="script-library__header">
        <h3>Scripts</h3>
        <button
          type="button"
          className="script-library__new-btn"
          onClick={onCreate}
          data-testid="script-new-btn"
          title="Create new script"
        >
          + New
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div
          className="script-library__loading"
          role="status"
          data-testid="script-library-loading"
        >
          Loading scripts…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && scripts.length === 0 && (
        <div
          className="script-library__empty"
          data-testid="script-library-empty"
        >
          <p>No saved scripts</p>
          <p className="script-library__hint">
            Click <strong>+ New</strong> to create your first automation script.
          </p>
        </div>
      )}

      {/* Script list */}
      {!isLoading && scripts.length > 0 && (
        <ul className="script-library__list" role="list">
          {scripts.map((script) => (
            <li
              key={script.id}
              className="script-library__item"
              data-testid={`script-item-${script.id}`}
            >
              <button
                type="button"
                className="script-library__item-btn"
                onClick={() => onSelect(script.id)}
                data-testid={`script-select-${script.id}`}
              >
                <div className="script-library__item-header">
                  <span className="script-library__item-name">
                    {script.isLoginScript && (
                      <span
                        className="script-library__login-badge"
                        title="Login script"
                      >
                        🔑
                      </span>
                    )}
                    {script.name}
                  </span>
                  <span className="script-library__item-date">
                    {formatDate(script.updatedAt)}
                  </span>
                </div>
                {script.description && (
                  <span className="script-library__item-desc">
                    {script.description}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`script-library__delete-btn ${deleteConfirm === script.id ? "script-library__delete-btn--confirm" : ""}`}
                onClick={() => handleDelete(script.id)}
                data-testid={`script-delete-${script.id}`}
                title={
                  deleteConfirm === script.id
                    ? "Click again to confirm"
                    : `Delete "${script.name}"`
                }
                aria-label={`Delete script "${script.name}"`}
              >
                {deleteConfirm === script.id ? "Confirm?" : "✕"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
