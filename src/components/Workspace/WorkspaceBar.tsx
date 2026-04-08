/**
 * WorkspaceBar — vertical sidebar for switching between workspaces.
 *
 * Renders a narrow bar on the left edge of the window with colored
 * circles for each workspace. Supports click-to-switch, right-click
 * context menu (rename, change color, delete), and a "+" button.
 *
 * @module WorkspaceBar
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useWorkspaceStore, WORKSPACE_COLORS } from "../../stores/workspaceStore";
import "./WorkspaceBar.css";

/** Extracts the first character of a name for the workspace icon. */
function getInitial(name: string): string {
  return name.charAt(0).toUpperCase() || "?";
}

/** Context menu state. */
interface ContextMenuState {
  workspaceId: string;
  x: number;
  y: number;
}

export function WorkspaceBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const setWorkspaceColor = useWorkspaceStore((s) => s.setWorkspaceColor);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu && !colorPickerFor) return;
    const handleClick = () => {
      setContextMenu(null);
      setColorPickerFor(null);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu, colorPickerFor]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, workspaceId: string) => {
      e.preventDefault();
      setContextMenu({ workspaceId, x: e.clientX, y: e.clientY });
      setColorPickerFor(null);
    },
    [],
  );

  const handleRenameStart = useCallback(() => {
    if (!contextMenu) return;
    const ws = workspaces.find((w) => w.id === contextMenu.workspaceId);
    if (ws) {
      setRenamingId(ws.id);
      setRenameValue(ws.name);
    }
    setContextMenu(null);
  }, [contextMenu, workspaces]);

  const handleRenameSubmit = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameWorkspace(renamingId, renameValue);
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, renameWorkspace]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setRenamingId(null);
        setRenameValue("");
      }
    },
    [handleRenameSubmit],
  );

  const handleDelete = useCallback(() => {
    if (contextMenu) {
      removeWorkspace(contextMenu.workspaceId);
      setContextMenu(null);
    }
  }, [contextMenu, removeWorkspace]);

  const handleChangeColor = useCallback(() => {
    if (contextMenu) {
      setColorPickerFor(contextMenu.workspaceId);
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleColorSelect = useCallback(
    (color: string) => {
      if (colorPickerFor) {
        setWorkspaceColor(colorPickerFor, color);
        setColorPickerFor(null);
      }
    },
    [colorPickerFor, setWorkspaceColor],
  );

  const handleAddWorkspace = useCallback(() => {
    const count = workspaces.length + 1;
    addWorkspace(`Workspace ${count}`);
  }, [workspaces.length, addWorkspace]);

  return (
    <nav
      className="workspace-bar"
      data-testid="workspace-bar"
      role="navigation"
      aria-label="Workspaces"
    >
      {workspaces.map((ws) => (
        <div key={ws.id} className="workspace-item-wrapper">
          {renamingId === ws.id ? (
            <input
              ref={renameInputRef}
              className="workspace-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              data-testid={`workspace-rename-${ws.id}`}
              aria-label="Rename workspace"
            />
          ) : (
            <button
              className={`workspace-item ${
                ws.id === activeWorkspaceId ? "workspace-item--active" : ""
              }`}
              style={{ backgroundColor: ws.color }}
              onClick={() => switchWorkspace(ws.id)}
              onContextMenu={(e) => handleContextMenu(e, ws.id)}
              title={ws.name}
              tabIndex={0}
              data-testid={`workspace-item-${ws.id}`}
              aria-label={`Switch to workspace ${ws.name}`}
              aria-current={ws.id === activeWorkspaceId ? "true" : undefined}
            >
              {getInitial(ws.name)}
            </button>
          )}
        </div>
      ))}

      <button
        className="workspace-add"
        onClick={handleAddWorkspace}
        title="New Workspace"
        data-testid="workspace-add"
        aria-label="Create new workspace"
      >
        +
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="workspace-context-menu"
          data-testid="workspace-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="workspace-context-item"
            onClick={handleRenameStart}
          >
            Rename
          </button>
          <button
            className="workspace-context-item"
            onClick={handleChangeColor}
          >
            Change Color
          </button>
          <button
            className="workspace-context-item workspace-context-item--danger"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}

      {/* Color picker popover */}
      {colorPickerFor && (
        <div
          className="workspace-color-picker"
          data-testid="workspace-color-picker"
          onClick={(e) => e.stopPropagation()}
        >
          {WORKSPACE_COLORS.map((color) => (
            <button
              key={color}
              className="workspace-color-swatch"
              style={{ backgroundColor: color }}
              onClick={() => handleColorSelect(color)}
              title={color}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
