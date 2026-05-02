/**
 * SessionSidebar — collapsible left sidebar containing the session manager.
 *
 * Layout:
 * - Search bar at top
 * - Session tree in the middle (scrollable)
 * - "+" button at bottom
 * - Toggle with Ctrl+B keyboard shortcut
 *
 * Manages session state and coordinates between search, tree, and editor.
 */
import { useState, useCallback, useEffect } from "react";
import { SessionSearch } from "./SessionSearch";
import { SessionTree } from "./SessionTree";
import { SessionEditor } from "./SessionEditor";
import type {
  SessionNode,
  SessionProfile,
  CreateSessionInput,
  UpdateSessionInput,
} from "./types";
import * as api from "./sessionApi";

interface SessionSidebarProps {
  /** Called when a session is opened (double-click or Enter). */
  onSessionOpen: (session: SessionProfile) => void;
  /** Whether the sidebar is visible. */
  isOpen: boolean;
  /** Toggle sidebar visibility. */
  onToggle: () => void;
}

/** Editor state for create/edit mode. */
interface EditorState {
  mode: "create" | "edit";
  session?: SessionProfile;
  folderId?: string;
}

export function SessionSidebar({
  onSessionOpen,
  isOpen,
  onToggle,
}: SessionSidebarProps) {
  const [tree, setTree] = useState<SessionNode[]>([]);
  const [searchResults, setSearchResults] = useState<SessionNode[] | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the session tree from the backend. */
  const loadTree = useCallback(async () => {
    try {
      const nodes = await api.sessionList();
      setTree(nodes);
      setError(null);
    } catch (err: unknown) {
      setError(`Failed to load sessions: ${String(err)}`);
    }
  }, []);

  // Load tree on mount
  useEffect(() => {
    if (isOpen) {
      loadTree();
    }
  }, [isOpen, loadTree]);

  // Ctrl+B keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        onToggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onToggle]);

  /** Handles search query changes. */
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await api.sessionSearch(query);
      // Convert search results (SessionProfile[]) to tree nodes
      const nodes: SessionNode[] = results.map((s) => ({
        type: "session" as const,
        id: s.id,
        name: s.name,
        protocol: s.protocol,
        host: s.host,
        port: s.port,
        username: s.username,
      }));
      setSearchResults(nodes);
    } catch {
      setSearchResults([]);
    }
  }, []);

  /** Opens a session by ID. */
  const handleSessionOpen = useCallback(
    async (sessionId: string) => {
      try {
        const session = await api.sessionGet(sessionId);
        onSessionOpen(session);
      } catch (err: unknown) {
        setError(`Failed to open session: ${String(err)}`);
      }
    },
    [onSessionOpen],
  );

  /** Opens the editor in edit mode. */
  const handleSessionEdit = useCallback(async (sessionId: string) => {
    try {
      const session = await api.sessionGet(sessionId);
      setEditor({ mode: "edit", session });
    } catch (err: unknown) {
      setError(`Failed to load session: ${String(err)}`);
    }
  }, []);

  /** Deletes a session after confirmation. */
  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      if (!window.confirm("Delete this session? This cannot be undone.")) {
        return;
      }
      try {
        await api.sessionDelete(sessionId);
        await loadTree();
      } catch (err: unknown) {
        setError(`Failed to delete session: ${String(err)}`);
      }
    },
    [loadTree],
  );

  /** Duplicates a session. */
  const handleSessionDuplicate = useCallback(
    async (sessionId: string) => {
      try {
        await api.sessionDuplicate(sessionId);
        await loadTree();
      } catch (err: unknown) {
        setError(`Failed to duplicate session: ${String(err)}`);
      }
    },
    [loadTree],
  );

  /** Opens the editor in create mode. */
  const handleNewSession = useCallback((folderId?: string) => {
    setEditor({ mode: "create", folderId: folderId ?? "root" });
  }, []);

  /** Creates a new folder. */
  const handleNewFolder = useCallback(
    async (parentId?: string) => {
      const name = "New Folder";
      try {
        await api.sessionCreateFolder(name, parentId ?? "root");
        await loadTree();
      } catch (err: unknown) {
        setError(`Failed to create folder: ${String(err)}`);
      }
    },
    [loadTree],
  );

  /** Deletes a folder after confirmation. */
  const handleFolderDelete = useCallback(
    async (folderId: string) => {
      if (!window.confirm("Delete this folder? This cannot be undone.")) {
        return;
      }
      try {
        await api.sessionDeleteFolder(folderId);
        await loadTree();
      } catch (err: unknown) {
        setError(`Failed to delete folder: ${String(err)}`);
      }
    },
    [loadTree],
  );

  /** Handles editor save (create or update). */
  const handleEditorSave = useCallback(
    async (input: CreateSessionInput | UpdateSessionInput) => {
      setIsSaving(true);
      try {
        if (editor?.mode === "edit" && editor.session) {
          await api.sessionUpdate(
            editor.session.id,
            input as UpdateSessionInput,
          );
        } else {
          await api.sessionCreate(input as CreateSessionInput);
        }
        setEditor(null);
        await loadTree();
      } catch (err: unknown) {
        setError(`Failed to save session: ${String(err)}`);
      } finally {
        setIsSaving(false);
      }
    },
    [editor, loadTree],
  );

  if (!isOpen) return null;

  const displayNodes = searchResults ?? tree;

  return (
    <aside
      className="session-sidebar"
      data-testid="session-sidebar"
      aria-label="Session Manager"
    >
      <div className="session-sidebar-header">
        <h3 className="session-sidebar-title">Sessions</h3>
        <button
          className="session-sidebar-close"
          onClick={onToggle}
          type="button"
          aria-label="Close sidebar"
          data-testid="session-sidebar-close"
        >
          ×
        </button>
      </div>

      <SessionSearch onSearch={handleSearch} />

      {error && (
        <div
          className="session-sidebar-error"
          data-testid="session-sidebar-error"
        >
          {error}
          <button onClick={() => setError(null)} type="button">
            Dismiss
          </button>
        </div>
      )}

      <div className="session-sidebar-tree">
        <SessionTree
          nodes={displayNodes}
          onSessionOpen={handleSessionOpen}
          onSessionEdit={handleSessionEdit}
          onSessionDelete={handleSessionDelete}
          onSessionDuplicate={handleSessionDuplicate}
          onNewSession={handleNewSession}
          onNewFolder={handleNewFolder}
          onFolderDelete={handleFolderDelete}
          searchQuery={searchQuery}
          isSearching={!!searchResults}
        />
      </div>

      <div className="session-sidebar-footer">
        <button
          className="session-sidebar-add"
          onClick={() => handleNewSession()}
          type="button"
          aria-label="New session"
          data-testid="session-add-btn"
        >
          + New Session
        </button>
      </div>

      {editor && (
        <SessionEditor
          session={editor.session}
          folderId={editor.folderId}
          onSave={handleEditorSave}
          onCancel={() => setEditor(null)}
          isSaving={isSaving}
        />
      )}
    </aside>
  );
}
