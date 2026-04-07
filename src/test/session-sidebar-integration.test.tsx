/**
 * Session Sidebar integration tests — full user flows through the sidebar.
 *
 * These tests exercise the REAL component wiring: user action → API call →
 * state update → DOM re-render. The Tauri IPC layer is mocked at the boundary
 * (invoke function), but all React component logic runs for real.
 *
 * Tags: [AC-1] through [AC-9], [INTEGRATION], [BOUNDARY]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionNode, SessionProfile } from "../components/SessionManager/types";

// ─── Mock Tauri IPC ─────────────────────────────────────────────────
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Import after mocking
import { SessionSidebar } from "../components/SessionManager/SessionSidebar";

// ─── Test Data ──────────────────────────────────────────────────────

const sshSession: SessionProfile = {
  id: "sess-001",
  name: "DC1 Core Router",
  folderId: "folder-prod",
  protocol: "ssh",
  host: "10.0.0.1",
  port: 22,
  username: "admin",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const treeWithSessions: SessionNode[] = [
  {
    type: "folder",
    id: "folder-prod",
    name: "Production",
    parentId: "root",
    sortOrder: 0,
    expanded: true,
    children: [
      {
        type: "session",
        id: "sess-001",
        name: "DC1 Core Router",
        protocol: "ssh",
        host: "10.0.0.1",
        port: 22,
        username: "admin",
      },
      {
        type: "session",
        id: "sess-002",
        name: "Legacy Switch",
        protocol: "telnet",
        host: "10.0.0.2",
        port: 23,
        username: "cisco",
      },
    ],
  },
  {
    type: "session",
    id: "sess-003",
    name: "Local Shell",
    protocol: "local",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

function setupMockInvoke(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    session_list: treeWithSessions,
    session_get: sshSession,
    session_create: "new-uuid-abc",
    session_update: undefined,
    session_delete: undefined,
    session_duplicate: "dup-uuid-xyz",
    session_search: [sshSession],
    session_export: '{"version":1,"sessions":[],"folders":[]}',
    session_import: 1,
    session_create_folder: "new-folder-id",
    session_delete_folder: undefined,
    ...overrides,
  };

  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in defaults) {
      const val = defaults[cmd];
      if (typeof val === "function") return (val as (a: unknown) => unknown)(args);
      return val;
    }
    throw new Error(`Unmocked command: ${cmd}`);
  });
}

function renderSidebar(props: Partial<React.ComponentProps<typeof SessionSidebar>> = {}) {
  const defaultProps = {
    isOpen: true,
    onToggle: vi.fn(),
    onSessionOpen: vi.fn(),
    ...props,
  };
  return { ...render(<SessionSidebar {...defaultProps} />), ...defaultProps };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("SessionSidebar — Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMockInvoke();
    // Mock window.confirm for delete confirmation dialogs
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-9: Persistence — sidebar loads tree from backend on mount
  // ────────────────────────────────────────────────────────────────

  it("[AC-9] loads and renders session tree from backend on mount", async () => {
    renderSidebar();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_list");
    });

    // Verify tree is rendered with backend data
    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
      expect(screen.getByText("Legacy Switch")).toBeInTheDocument();
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });
  });

  it("[AC-9] shows empty state when backend returns no sessions", async () => {
    setupMockInvoke({ session_list: [] });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("No saved sessions yet.")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-1: Create new session — full flow
  // ────────────────────────────────────────────────────────────────

  it("[AC-1] create session: click + → fill form → save → tree reloads", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // After creation, the tree reloads with the new session
    let callCount = 0;
    setupMockInvoke({
      session_list: () => {
        callCount++;
        if (callCount <= 1) return treeWithSessions;
        // After create, return updated tree with new session
        return [
          ...treeWithSessions,
          {
            type: "session",
            id: "new-uuid-abc",
            name: "New Router",
            protocol: "ssh",
            host: "192.168.1.1",
            port: 22,
          },
        ];
      },
    });

    renderSidebar();

    // Wait for initial tree load
    await waitFor(() => {
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
    });

    // Click "New Session"
    await user.click(screen.getByTestId("session-add-btn"));

    // Editor should open
    expect(screen.getByTestId("session-editor")).toBeInTheDocument();
    expect(screen.getByText("New Session")).toBeInTheDocument();

    // Fill in the form
    await user.type(screen.getByTestId("session-editor-name"), "New Router");
    await user.type(screen.getByTestId("session-editor-host"), "192.168.1.1");
    await user.type(screen.getByTestId("session-editor-username"), "netadmin");

    // Submit
    await user.click(screen.getByTestId("session-editor-save"));

    // Verify the IPC call was made with correct data
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_create", {
        input: expect.objectContaining({
          name: "New Router",
          protocol: "ssh",
          host: "192.168.1.1",
          port: 22,
          username: "netadmin",
        }),
      });
    });

    // Editor should close
    await waitFor(() => {
      expect(screen.queryByTestId("session-editor")).not.toBeInTheDocument();
    });

    // Tree should reload (session_list called again)
    await waitFor(() => {
      expect(screen.getByText("New Router")).toBeInTheDocument();
    });
  });

  it("[AC-1] create session with telnet protocol auto-fills port 23", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("session-add-btn"));

    // Switch protocol to telnet
    await user.selectOptions(screen.getByTestId("session-editor-protocol"), "telnet");

    // Port should auto-fill to 23
    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    expect(port.value).toBe("23");

    // Fill required fields
    await user.type(screen.getByTestId("session-editor-name"), "Telnet Device");
    await user.type(screen.getByTestId("session-editor-host"), "10.0.0.99");

    // Submit
    await user.click(screen.getByTestId("session-editor-save"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_create", {
        input: expect.objectContaining({
          name: "Telnet Device",
          protocol: "telnet",
          host: "10.0.0.99",
          port: 23,
        }),
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-4: Open a session
  // ────────────────────────────────────────────────────────────────

  it("[AC-4] double-click session → fetches profile → calls onSessionOpen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSessionOpen } = renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
    });

    // Double-click the session
    await user.dblClick(screen.getByText("DC1 Core Router"));

    // Should fetch full profile via session_get
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_get", { id: "sess-001" });
    });

    // Should call onSessionOpen with the full profile
    await waitFor(() => {
      expect(onSessionOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "sess-001",
          name: "DC1 Core Router",
          protocol: "ssh",
          host: "10.0.0.1",
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-5: Edit a session — context menu → edit → save
  // ────────────────────────────────────────────────────────────────

  it("[AC-5] right-click → Edit → modify → save → tree reloads", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Right-click session to open context menu
    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });

    // Click Edit in context menu
    await user.click(screen.getByText("Edit"));

    // Should fetch the session profile for editing
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_get", { id: "sess-003" });
    });

    // Editor should open in edit mode
    await waitFor(() => {
      expect(screen.getByText("Edit Session")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-6: Duplicate a session
  // ────────────────────────────────────────────────────────────────

  it("[AC-6] right-click → Duplicate → tree reloads with copy", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    let callCount = 0;
    setupMockInvoke({
      session_list: () => {
        callCount++;
        if (callCount <= 1) return treeWithSessions;
        // After duplicate, tree includes copy
        return [
          ...treeWithSessions,
          {
            type: "session",
            id: "dup-uuid-xyz",
            name: "Local Shell (copy)",
            protocol: "local",
          },
        ];
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Right-click to open context menu
    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });

    // Click Duplicate
    await user.click(screen.getByText("Duplicate"));

    // Verify IPC call
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_duplicate", { id: "sess-003" });
    });

    // Tree should reload with the duplicate
    await waitFor(() => {
      expect(screen.getByText("Local Shell (copy)")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-7: Delete a session
  // ────────────────────────────────────────────────────────────────

  it("[AC-7] right-click → Delete → session removed from tree", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    let callCount = 0;
    setupMockInvoke({
      session_list: () => {
        callCount++;
        if (callCount <= 1) return treeWithSessions;
        // After delete, local shell is gone
        return treeWithSessions.filter((n) => n.id !== "sess-003");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Right-click → Delete
    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });
    await user.click(screen.getByText("Delete"));

    // Verify confirmation dialog was shown
    expect(window.confirm).toHaveBeenCalledOnce();

    // Verify IPC call
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_delete", { id: "sess-003" });
    });

    // Session should be gone from tree
    await waitFor(() => {
      expect(screen.queryByText("Local Shell")).not.toBeInTheDocument();
    });
  });

  it("[AC-7] delete cancelled by user does not call backend", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Mock confirm to return false (user cancels)
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Clear invoke calls from render phase
    mockInvoke.mockClear();

    // Right-click → Delete
    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });
    await user.click(screen.getByText("Delete"));

    // Confirm should have been called
    expect(window.confirm).toHaveBeenCalled();

    // session_delete should NOT have been called (user cancelled)
    expect(mockInvoke).not.toHaveBeenCalledWith("session_delete", expect.anything());

    // Session should still be in the tree
    expect(screen.getByText("Local Shell")).toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-3: Search sessions
  // ────────────────────────────────────────────────────────────────

  it("[AC-3] search → shows filtered results → clear → full tree returns", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    setupMockInvoke({
      session_search: (args: unknown) => {
        const { query } = args as { query: string };
        if (query.includes("core")) {
          return [sshSession]; // Only the SSH session matches
        }
        return [];
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Type search query
    const searchInput = screen.getByTestId("session-search-input");
    await user.type(searchInput, "core");

    // Wait for debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Verify search IPC was called
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_search", { query: "core" });
    });

    // Filtered results should show only matching session
    // Note: search highlighting splits "DC1 Core Router" into
    // "DC1 " + <mark>Core</mark> + " Router", so we check by test ID
    await waitFor(() => {
      expect(screen.getByTestId("tree-session-sess-001")).toBeInTheDocument();
    });

    // Clear search
    const clearBtn = screen.getByTestId("session-search-clear");
    await user.click(clearBtn);

    // Full tree should return (Production folder + Local Shell)
    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
      expect(screen.getByText("Production")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-2: Folder operations
  // ────────────────────────────────────────────────────────────────

  it("[AC-2] right-click folder → New Folder → creates subfolder", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
    });

    // Right-click on Production folder
    const folder = screen.getByText("Production");
    await user.pointer({ target: folder, keys: "[MouseRight]" });

    // Click "New Folder"
    await user.click(screen.getByText("New Folder"));

    // Verify IPC call with parent folder ID
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_create_folder", {
        name: "New Folder",
        parentId: "folder-prod",
      });
    });
  });

  it("[AC-2] right-click folder → Delete Folder → calls backend", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
    });

    const folder = screen.getByText("Production");
    await user.pointer({ target: folder, keys: "[MouseRight]" });

    await user.click(screen.getByText("Delete Folder"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_delete_folder", {
        id: "folder-prod",
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  Error handling — API failures
  // ────────────────────────────────────────────────────────────────

  it("[BOUNDARY] shows error when session_list fails", async () => {
    setupMockInvoke({
      session_list: () => {
        throw new Error("Network error: connection refused");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByTestId("session-sidebar-error")).toBeInTheDocument();
      expect(screen.getByText(/Failed to load sessions/)).toBeInTheDocument();
    });
  });

  it("[BOUNDARY] shows error and dismisses on button click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    setupMockInvoke({
      session_list: () => {
        throw new Error("Storage corrupted");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByTestId("session-sidebar-error")).toBeInTheDocument();
    });

    // Click dismiss
    await user.click(screen.getByText("Dismiss"));

    // Error should be gone
    expect(screen.queryByTestId("session-sidebar-error")).not.toBeInTheDocument();
  });

  it("[BOUNDARY] shows error when session_delete fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    setupMockInvoke({
      session_delete: () => {
        throw new Error("Session not found");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    // Try to delete
    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });
    await user.click(screen.getByText("Delete"));

    await waitFor(() => {
      expect(screen.getByText(/Failed to delete session/)).toBeInTheDocument();
    });
  });

  it("[BOUNDARY] shows error when session_duplicate fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    setupMockInvoke({
      session_duplicate: () => {
        throw new Error("Duplicate name conflict");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Local Shell")).toBeInTheDocument();
    });

    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });
    await user.click(screen.getByText("Duplicate"));

    await waitFor(() => {
      expect(screen.getByText(/Failed to duplicate session/)).toBeInTheDocument();
    });
  });

  it("[BOUNDARY] shows error when session_create fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    setupMockInvoke({
      session_create: () => {
        throw new Error("Invalid input: name too long");
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("DC1 Core Router")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("session-add-btn"));
    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "1.1.1.1");
    await user.click(screen.getByTestId("session-editor-save"));

    await waitFor(() => {
      expect(screen.getByText(/Failed to save session/)).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  Empty state → first session flow
  // ────────────────────────────────────────────────────────────────

  it("[AC-1] [EDGE] first-launch: empty state → Create first session → editor opens", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setupMockInvoke({ session_list: [] });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("No saved sessions yet.")).toBeInTheDocument();
    });

    // Click "Create your first session"
    await user.click(screen.getByTestId("session-create-first"));

    // Editor opens
    expect(screen.getByTestId("session-editor")).toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────────────
  //  AC-2: Folder context menu → New Session in folder
  // ────────────────────────────────────────────────────────────────

  it("[AC-2] right-click folder → New Session → editor opens with folder context", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
    });

    // Right-click folder → New Session
    const folder = screen.getByText("Production");
    await user.pointer({ target: folder, keys: "[MouseRight]" });
    await user.click(screen.getByText("New Session"));

    // Editor should open
    await waitFor(() => {
      expect(screen.getByTestId("session-editor")).toBeInTheDocument();
    });
  });
});
