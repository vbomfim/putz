/**
 * SFTP file browser panel component.
 *
 * Displays a remote file tree with columns for name, size, permissions,
 * and modified date. Supports navigation, context menu operations, and
 * drag-drop file transfers.
 *
 * Opens alongside SSH sessions via Ctrl+Shift+F or toolbar icon.
 *
 * @module SFTPPanel
 */
import { useCallback, useState, useRef } from "react";
import type { RemoteFileEntry, RemoteFileStat, SftpContextAction } from "./types";
import { formatFileSize, formatPermissions } from "./types";
import { useSftp } from "./useSftp";
import "./SFTP.css";

interface SFTPPanelProps {
  /** SSH connection ID to open SFTP on. */
  connectionId: string;
  /** Callback when the panel is closed. */
  onClose?: () => void;
}

/**
 * SFTP file browser panel.
 *
 * Shows remote file tree with name, size, permissions, date columns.
 * Provides context menu for Download, Upload, Rename, Delete, New Folder, Properties.
 */
export function SFTPPanel({ connectionId, onClose }: SFTPPanelProps) {
  const {
    isReady,
    error,
    currentPath,
    files,
    isLoading,
    navigateTo,
    navigateUp,
    refresh,
    download,
    upload,
    rename,
    deleteFile,
    mkdir,
    stat,
    close,
  } = useSftp({ connectionId });

  const [selectedFile, setSelectedFile] = useState<RemoteFileEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: RemoteFileEntry | null;
  } | null>(null);
  const [properties, setProperties] = useState<RemoteFileStat | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleFileDoubleClick = useCallback(
    async (entry: RemoteFileEntry) => {
      if (entry.isDir) {
        await navigateTo(entry.path);
      }
    },
    [navigateTo],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: RemoteFileEntry | null) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextAction = useCallback(
    async (action: SftpContextAction) => {
      const file = contextMenu?.file;
      closeContextMenu();

      switch (action) {
        case "download":
          if (file && !file.isDir) {
            // In a real app, use a file save dialog
            const localPath = `/tmp/${file.name}`;
            try {
              await download(file.path, localPath);
            } catch (err: unknown) {
              console.error("[SFTPPanel] Download failed:", err);
            }
          }
          break;
        case "rename":
          if (file) {
            setRenameTarget(file.path);
            setRenameValue(file.name);
          }
          break;
        case "delete":
          if (file) {
            try {
              await deleteFile(file.path);
              await refresh();
            } catch (err: unknown) {
              console.error("[SFTPPanel] Delete failed:", err);
            }
          }
          break;
        case "newFolder":
          setNewFolderName("");
          break;
        case "properties":
          if (file) {
            try {
              const fileStat = await stat(file.path);
              setProperties(fileStat);
            } catch (err: unknown) {
              console.error("[SFTPPanel] Stat failed:", err);
            }
          }
          break;
      }
    },
    [contextMenu, closeContextMenu, download, deleteFile, refresh, stat],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const parent = renameTarget.split("/").slice(0, -1).join("/") || "/";
    const newPath = `${parent}/${renameValue.trim()}`;
    try {
      await rename(renameTarget, newPath);
      await refresh();
    } catch (err: unknown) {
      console.error("[SFTPPanel] Rename failed:", err);
    }
    setRenameTarget(null);
    setRenameValue("");
  }, [renameTarget, renameValue, rename, refresh]);

  const handleNewFolderSubmit = useCallback(async () => {
    if (newFolderName === null || !newFolderName.trim()) return;
    const path =
      currentPath === "/"
        ? `/${newFolderName.trim()}`
        : `${currentPath}/${newFolderName.trim()}`;
    try {
      await mkdir(path);
      await refresh();
    } catch (err: unknown) {
      console.error("[SFTPPanel] Mkdir failed:", err);
    }
    setNewFolderName(null);
  }, [newFolderName, currentPath, mkdir, refresh]);

  const handleClose = useCallback(async () => {
    await close();
    onClose?.();
  }, [close, onClose]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFiles = e.dataTransfer.files;
      for (let i = 0; i < droppedFiles.length; i++) {
        const file = droppedFiles[i];
        const remotePath =
          currentPath === "/"
            ? `/${file.name}`
            : `${currentPath}/${file.name}`;
        try {
          // Note: In Tauri, drag-drop gives us the file path
          await upload(file.name, remotePath);
        } catch (err: unknown) {
          console.error("[SFTPPanel] Upload failed:", err);
        }
      }
    },
    [currentPath, upload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const formatDate = (timestamp: number | undefined): string => {
    if (!timestamp) return "—";
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (error) {
    return (
      <div className="sftp-panel sftp-error" role="alert">
        <p>{error}</p>
        <button onClick={handleClose}>Close</button>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="sftp-panel sftp-loading" role="status">
        <p>Connecting SFTP…</p>
      </div>
    );
  }

  return (
    <div
      className="sftp-panel"
      ref={panelRef}
      onClick={closeContextMenu}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      role="region"
      aria-label="SFTP File Browser"
    >
      {/* Toolbar */}
      <div className="sftp-toolbar">
        <button
          className="sftp-btn"
          onClick={navigateUp}
          disabled={currentPath === "/"}
          title="Go up one directory"
          aria-label="Navigate up"
        >
          ↑
        </button>
        <button
          className="sftp-btn"
          onClick={refresh}
          disabled={isLoading}
          title="Refresh"
          aria-label="Refresh directory"
        >
          ↻
        </button>
        <span className="sftp-path" title={currentPath}>
          {currentPath}
        </span>
        <button
          className="sftp-btn sftp-close-btn"
          onClick={handleClose}
          title="Close SFTP panel"
          aria-label="Close SFTP panel"
        >
          ✕
        </button>
      </div>

      {/* File list */}
      <div className="sftp-file-list" role="table" aria-label="Remote files">
        <div className="sftp-file-header" role="row">
          <span className="sftp-col-name" role="columnheader">
            Name
          </span>
          <span className="sftp-col-size" role="columnheader">
            Size
          </span>
          <span className="sftp-col-perms" role="columnheader">
            Permissions
          </span>
          <span className="sftp-col-date" role="columnheader">
            Modified
          </span>
        </div>

        {isLoading && (
          <div className="sftp-loading-indicator" role="status">
            Loading…
          </div>
        )}

        {!isLoading && files.length === 0 && (
          <div className="sftp-empty">Empty directory</div>
        )}

        {files.map((entry) => (
          <div
            key={entry.path}
            className={`sftp-file-row ${selectedFile?.path === entry.path ? "selected" : ""} ${entry.isDir ? "is-dir" : ""}`}
            role="row"
            onClick={() => setSelectedFile(entry)}
            onDoubleClick={() => handleFileDoubleClick(entry)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFileDoubleClick(entry);
            }}
            aria-selected={selectedFile?.path === entry.path}
          >
            <span className="sftp-col-name" role="cell">
              <span className="sftp-icon">{entry.isDir ? "📁" : "📄"}</span>
              {renameTarget === entry.path ? (
                <input
                  className="sftp-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit();
                    if (e.key === "Escape") {
                      setRenameTarget(null);
                      setRenameValue("");
                    }
                  }}
                  autoFocus
                  aria-label="New file name"
                />
              ) : (
                entry.name
              )}
            </span>
            <span className="sftp-col-size" role="cell">
              {entry.isDir ? "—" : formatFileSize(entry.size)}
            </span>
            <span className="sftp-col-perms" role="cell">
              {entry.permissions !== undefined
                ? formatPermissions(entry.permissions & 0o777)
                : "—"}
            </span>
            <span className="sftp-col-date" role="cell">
              {formatDate(entry.modified)}
            </span>
          </div>
        ))}

        {newFolderName !== null && (
          <div className="sftp-file-row new-folder" role="row">
            <span className="sftp-col-name" role="cell">
              <span className="sftp-icon">📁</span>
              <input
                className="sftp-rename-input"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={handleNewFolderSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewFolderSubmit();
                  if (e.key === "Escape") setNewFolderName(null);
                }}
                placeholder="New folder name"
                autoFocus
                aria-label="New folder name"
              />
            </span>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="sftp-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="File actions"
        >
          {contextMenu.file && !contextMenu.file.isDir && (
            <button
              className="sftp-menu-item"
              onClick={() => handleContextAction("download")}
              role="menuitem"
            >
              Download
            </button>
          )}
          {contextMenu.file && (
            <>
              <button
                className="sftp-menu-item"
                onClick={() => handleContextAction("rename")}
                role="menuitem"
              >
                Rename
              </button>
              <button
                className="sftp-menu-item sftp-menu-danger"
                onClick={() => handleContextAction("delete")}
                role="menuitem"
              >
                Delete
              </button>
              <div className="sftp-menu-separator" role="separator" />
              <button
                className="sftp-menu-item"
                onClick={() => handleContextAction("properties")}
                role="menuitem"
              >
                Properties
              </button>
            </>
          )}
          <div className="sftp-menu-separator" role="separator" />
          <button
            className="sftp-menu-item"
            onClick={() => handleContextAction("newFolder")}
            role="menuitem"
          >
            New Folder
          </button>
        </div>
      )}

      {/* Properties dialog */}
      {properties && (
        <div
          className="sftp-properties-overlay"
          onClick={() => setProperties(null)}
          role="dialog"
          aria-label="File properties"
        >
          <div className="sftp-properties" onClick={(e) => e.stopPropagation()}>
            <h3>Properties</h3>
            <dl>
              <dt>Path</dt>
              <dd>{properties.path}</dd>
              <dt>Type</dt>
              <dd>{properties.isDir ? "Directory" : "File"}</dd>
              <dt>Size</dt>
              <dd>{formatFileSize(properties.size)}</dd>
              {properties.permissions !== undefined && (
                <>
                  <dt>Permissions</dt>
                  <dd>{formatPermissions(properties.permissions & 0o777)}</dd>
                </>
              )}
              {properties.modified !== undefined && (
                <>
                  <dt>Modified</dt>
                  <dd>{formatDate(properties.modified)}</dd>
                </>
              )}
              {properties.uid !== undefined && (
                <>
                  <dt>Owner UID</dt>
                  <dd>{properties.uid}</dd>
                </>
              )}
              {properties.gid !== undefined && (
                <>
                  <dt>Group GID</dt>
                  <dd>{properties.gid}</dd>
                </>
              )}
            </dl>
            <button onClick={() => setProperties(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
