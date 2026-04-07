/**
 * SessionTree — collapsible tree view for sessions and folders.
 *
 * Renders a tree of SessionNode items with:
 * - Collapsible folders
 * - Double-click to open sessions
 * - Keyboard navigation (Arrow keys, Enter, Delete, F2)
 * - Right-click context menu
 * - ARIA tree roles
 * - Search highlight support
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { SessionNode } from "./types";

interface SessionTreeProps {
  /** Tree nodes to render. */
  nodes: SessionNode[];
  /** Called when a session is double-clicked or Enter is pressed. */
  onSessionOpen: (sessionId: string) => void;
  /** Called when "Edit" is selected from context menu. */
  onSessionEdit: (sessionId: string) => void;
  /** Called when "Delete" is selected. */
  onSessionDelete: (sessionId: string) => void;
  /** Called when "Duplicate" is selected. */
  onSessionDuplicate: (sessionId: string) => void;
  /** Called to create a new session. */
  onNewSession: (folderId?: string) => void;
  /** Called to create a new folder. */
  onNewFolder: (parentId?: string) => void;
  /** Called when a folder is deleted. */
  onFolderDelete: (folderId: string) => void;
  /** Search query for highlighting. */
  searchQuery?: string;
  /** Whether the tree is in search/filter mode. */
  isSearching?: boolean;
}

/** Context menu state. */
interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
  nodeType: "folder" | "session";
}

export function SessionTree({
  nodes,
  onSessionOpen,
  onSessionEdit,
  onSessionDelete,
  onSessionDuplicate,
  onNewSession,
  onNewFolder,
  onFolderDelete,
  searchQuery = "",
  isSearching = false,
}: SessionTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  // Initialize expanded state from node data
  useEffect(() => {
    const expanded = new Set<string>();
    const collectExpanded = (nodeList: SessionNode[]) => {
      for (const node of nodeList) {
        if (node.type === "folder") {
          if (node.expanded || isSearching) {
            expanded.add(node.id);
          }
          collectExpanded(node.children);
        }
      }
    };
    collectExpanded(nodes);
    setExpandedFolders(expanded);
  }, [nodes, isSearching]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string, nodeType: "folder" | "session") => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId, nodeType });
      setSelectedId(nodeId);
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener("click", handler);
      return () => document.removeEventListener("click", handler);
    }
  }, [contextMenu, closeContextMenu]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedId) return;

      const flatNodes = flattenNodes(nodes);
      const currentIndex = flatNodes.findIndex((n) => n.id === selectedId);

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (currentIndex < flatNodes.length - 1) {
            setSelectedId(flatNodes[currentIndex + 1].id);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (currentIndex > 0) {
            setSelectedId(flatNodes[currentIndex - 1].id);
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const node = flatNodes[currentIndex];
          if (node?.type === "folder" && !expandedFolders.has(node.id)) {
            toggleFolder(node.id);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const leftNode = flatNodes[currentIndex];
          if (
            leftNode?.type === "folder" &&
            expandedFolders.has(leftNode.id)
          ) {
            toggleFolder(leftNode.id);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          const enterNode = flatNodes[currentIndex];
          if (enterNode?.type === "session") {
            onSessionOpen(enterNode.id);
          } else if (enterNode?.type === "folder") {
            toggleFolder(enterNode.id);
          }
          break;
        }
        case "Delete": {
          e.preventDefault();
          const delNode = flatNodes[currentIndex];
          if (delNode?.type === "session") {
            onSessionDelete(delNode.id);
          } else if (delNode?.type === "folder") {
            onFolderDelete(delNode.id);
          }
          break;
        }
        case "F2": {
          e.preventDefault();
          const editNode = flatNodes[currentIndex];
          if (editNode?.type === "session") {
            onSessionEdit(editNode.id);
          }
          break;
        }
      }
    },
    [
      selectedId,
      nodes,
      expandedFolders,
      toggleFolder,
      onSessionOpen,
      onSessionDelete,
      onSessionEdit,
      onFolderDelete,
    ],
  );

  /** Highlights matching text in a string. */
  const highlightMatch = useCallback(
    (text: string) => {
      if (!searchQuery) return text;
      const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <mark className="session-search-highlight">
            {text.slice(idx, idx + searchQuery.length)}
          </mark>
          {text.slice(idx + searchQuery.length)}
        </>
      );
    },
    [searchQuery],
  );

  const renderNode = (node: SessionNode, level: number): React.ReactNode => {
    const isSelected = selectedId === node.id;

    if (node.type === "folder") {
      const isExpanded = expandedFolders.has(node.id);
      return (
        <li
          key={node.id}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-selected={isSelected}
          data-testid={`tree-folder-${node.id}`}
        >
          <div
            className={`session-tree-item session-tree-folder ${isSelected ? "selected" : ""}`}
            style={{ paddingLeft: `${level * 16 + 8}px` }}
            onClick={() => {
              toggleFolder(node.id);
              setSelectedId(node.id);
            }}
            onContextMenu={(e) => handleContextMenu(e, node.id, "folder")}
          >
            <span className="session-tree-icon">
              {isExpanded ? "▾" : "▸"}
            </span>
            <span className="session-tree-folder-icon">📁</span>
            <span className="session-tree-label">
              {highlightMatch(node.name)}
            </span>
          </div>
          {isExpanded && node.children.length > 0 && (
            <ul role="group" className="session-tree-children">
              {node.children.map((child) => renderNode(child, level + 1))}
            </ul>
          )}
        </li>
      );
    }

    // Session node
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-selected={isSelected}
        data-testid={`tree-session-${node.id}`}
      >
        <div
          className={`session-tree-item session-tree-session ${isSelected ? "selected" : ""}`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => setSelectedId(node.id)}
          onDoubleClick={() => onSessionOpen(node.id)}
          onContextMenu={(e) => handleContextMenu(e, node.id, "session")}
        >
          <span className="session-tree-icon">
            {protocolIcon(node.protocol)}
          </span>
          <span className="session-tree-label">
            {highlightMatch(node.name)}
          </span>
          {node.host && (
            <span className="session-tree-host">{node.host}</span>
          )}
        </div>
      </li>
    );
  };

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="session-tree-empty" data-testid="session-tree-empty">
        {isSearching ? (
          <p>No sessions match your search.</p>
        ) : (
          <>
            <p>No saved sessions yet.</p>
            <button
              className="session-tree-empty-btn"
              onClick={() => onNewSession()}
              type="button"
              data-testid="session-create-first"
            >
              Create your first session
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <ul
        ref={treeRef}
        role="tree"
        className="session-tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Session tree"
        data-testid="session-tree"
      >
        {nodes.map((node) => renderNode(node, 0))}
      </ul>

      {contextMenu && (
        <div
          className="session-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="session-context-menu"
        >
          {contextMenu.nodeType === "session" ? (
            <>
              <button
                onClick={() => {
                  onSessionOpen(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
              >
                Open
              </button>
              <button
                onClick={() => {
                  onSessionEdit(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  onSessionDuplicate(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
              >
                Duplicate
              </button>
              <hr />
              <button
                onClick={() => {
                  onSessionDelete(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
                className="danger"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  onNewSession(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
              >
                New Session
              </button>
              <button
                onClick={() => {
                  onNewFolder(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
              >
                New Folder
              </button>
              <hr />
              <button
                onClick={() => {
                  onFolderDelete(contextMenu.nodeId);
                  closeContextMenu();
                }}
                type="button"
                className="danger"
              >
                Delete Folder
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Returns a protocol icon character. */
function protocolIcon(protocol: string): string {
  switch (protocol) {
    case "ssh":
      return "🔒";
    case "telnet":
      return "📡";
    case "serial":
      return "🔌";
    case "local":
      return "💻";
    default:
      return "📟";
  }
}

/** Flattens visible tree nodes for keyboard navigation. */
function flattenNodes(
  nodes: SessionNode[],
  _expandedFolders?: Set<string>,
): SessionNode[] {
  const flat: SessionNode[] = [];
  for (const node of nodes) {
    flat.push(node);
    if (node.type === "folder") {
      flat.push(...flattenNodes(node.children, _expandedFolders));
    }
  }
  return flat;
}
