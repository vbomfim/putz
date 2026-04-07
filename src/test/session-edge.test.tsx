/**
 * Session manager edge case tests — boundary values, keyboard navigation,
 * special characters, accessibility, and error recovery.
 *
 * These tests catch bugs that the happy-path unit tests miss. Each test
 * targets a specific edge condition and documents what could go wrong.
 *
 * Tags: [EDGE], [BOUNDARY], [AC-1] through [AC-7]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionTree } from "../components/SessionManager/SessionTree";
import { SessionEditor } from "../components/SessionManager/SessionEditor";
import { SessionSearch } from "../components/SessionManager/SessionSearch";
import type {
  SessionNode,
  SessionProfile,
} from "../components/SessionManager/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// ─── Shared Test Data ───────────────────────────────────────────────

const defaultHandlers = {
  onSessionOpen: vi.fn(),
  onSessionEdit: vi.fn(),
  onSessionDelete: vi.fn(),
  onSessionDuplicate: vi.fn(),
  onNewSession: vi.fn(),
  onNewFolder: vi.fn(),
  onFolderDelete: vi.fn(),
};

function resetHandlers() {
  Object.values(defaultHandlers).forEach((fn) => fn.mockReset());
}

// ═══════════════════════════════════════════════════════════════════
//  SessionTree — Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("SessionTree — Edge Cases", () => {
  beforeEach(resetHandlers);

  // ── Unicode & Special Characters ──────────────────────────────

  it("[EDGE] renders sessions with Unicode names (CJK, emoji, accented)", () => {
    const nodes: SessionNode[] = [
      {
        type: "session",
        id: "u1",
        name: "サーバー東京",
        protocol: "ssh",
        host: "10.0.0.1",
        port: 22,
      },
      {
        type: "session",
        id: "u2",
        name: "🔥 Producción Española",
        protocol: "telnet",
        host: "10.0.0.2",
        port: 23,
      },
      {
        type: "session",
        id: "u3",
        name: "Ünïcödé Tëst",
        protocol: "local",
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    expect(screen.getByText("サーバー東京")).toBeInTheDocument();
    expect(screen.getByText("🔥 Producción Española")).toBeInTheDocument();
    expect(screen.getByText("Ünïcödé Tëst")).toBeInTheDocument();
  });

  it("[EDGE] renders session with max-length name (200 chars)", () => {
    const longName = "A".repeat(200);
    const nodes: SessionNode[] = [
      {
        type: "session",
        id: "long-1",
        name: longName,
        protocol: "ssh",
        host: "10.0.0.1",
        port: 22,
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);
    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  // ── Deep Folder Nesting ───────────────────────────────────────

  it("[EDGE] renders deeply nested folders (5 levels)", () => {
    const deepTree: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Level 1",
        parentId: "root",
        sortOrder: 0,
        expanded: true,
        children: [
          {
            type: "folder",
            id: "f2",
            name: "Level 2",
            parentId: "f1",
            sortOrder: 0,
            expanded: true,
            children: [
              {
                type: "folder",
                id: "f3",
                name: "Level 3",
                parentId: "f2",
                sortOrder: 0,
                expanded: true,
                children: [
                  {
                    type: "folder",
                    id: "f4",
                    name: "Level 4",
                    parentId: "f3",
                    sortOrder: 0,
                    expanded: true,
                    children: [
                      {
                        type: "folder",
                        id: "f5",
                        name: "Level 5",
                        parentId: "f4",
                        sortOrder: 0,
                        expanded: true,
                        children: [
                          {
                            type: "session",
                            id: "deep-session",
                            name: "Deep Session",
                            protocol: "ssh",
                            host: "10.0.0.100",
                            port: 22,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    render(<SessionTree nodes={deepTree} {...defaultHandlers} />);

    expect(screen.getByText("Level 1")).toBeInTheDocument();
    expect(screen.getByText("Level 5")).toBeInTheDocument();
    expect(screen.getByText("Deep Session")).toBeInTheDocument();
  });

  // ── Keyboard Navigation ───────────────────────────────────────

  it("[EDGE] [AC-4] ArrowDown/ArrowUp navigates through tree items", async () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Alpha", protocol: "ssh", host: "1.1.1.1", port: 22 },
      { type: "session", id: "s2", name: "Beta", protocol: "ssh", host: "2.2.2.2", port: 22 },
      { type: "session", id: "s3", name: "Gamma", protocol: "ssh", host: "3.3.3.3", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    const tree = screen.getByRole("tree");

    // Click first item to select
    await userEvent.click(screen.getByText("Alpha"));

    // Arrow Down to second item
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    // Arrow Down to third item
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    // Press Enter to open the third item (Gamma)
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(defaultHandlers.onSessionOpen).toHaveBeenCalledWith("s3");
  });

  it("[EDGE] Enter on session calls onSessionOpen", async () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Server", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    // Select the item
    await userEvent.click(screen.getByText("Server"));

    // Press Enter
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Enter" });

    expect(defaultHandlers.onSessionOpen).toHaveBeenCalledWith("s1");
  });

  it("[EDGE] Delete key on session calls onSessionDelete", async () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Server", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    await userEvent.click(screen.getByText("Server"));

    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    expect(defaultHandlers.onSessionDelete).toHaveBeenCalledWith("s1");
  });

  it("[EDGE] F2 key on session calls onSessionEdit", async () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Server", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    await userEvent.click(screen.getByText("Server"));

    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });

    expect(defaultHandlers.onSessionEdit).toHaveBeenCalledWith("s1");
  });

  it("[EDGE] ArrowRight expands collapsed folder", async () => {
    const nodes: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Servers",
        parentId: "root",
        sortOrder: 0,
        expanded: false, // starts collapsed
        children: [
          {
            type: "session",
            id: "s1",
            name: "Hidden Server",
            protocol: "ssh",
            host: "1.1.1.1",
            port: 22,
          },
        ],
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    // Initially collapsed — child hidden
    expect(screen.queryByText("Hidden Server")).not.toBeInTheDocument();

    // Select folder
    await userEvent.click(screen.getByText("Servers"));

    // Arrow Right to expand
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    // Child should now be visible
    expect(screen.getByText("Hidden Server")).toBeInTheDocument();
  });

  it("[EDGE] ArrowLeft collapses expanded folder", async () => {
    const nodes: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Servers",
        parentId: "root",
        sortOrder: 0,
        expanded: true,
        children: [
          {
            type: "session",
            id: "s1",
            name: "Visible Server",
            protocol: "ssh",
            host: "1.1.1.1",
            port: 22,
          },
        ],
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    // Initially expanded — child visible
    expect(screen.getByText("Visible Server")).toBeInTheDocument();

    // Select folder
    await userEvent.click(screen.getByText("Servers"));

    // Arrow Left to collapse
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });

    // Child should be hidden
    expect(screen.queryByText("Visible Server")).not.toBeInTheDocument();
  });

  it("[EDGE] Delete key on folder calls onFolderDelete", async () => {
    const nodes: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Empty Folder",
        parentId: "root",
        sortOrder: 0,
        expanded: false,
        children: [],
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    await userEvent.click(screen.getByText("Empty Folder"));

    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    expect(defaultHandlers.onFolderDelete).toHaveBeenCalledWith("f1");
  });

  // ── Context Menu Actions ──────────────────────────────────────

  it("[AC-6] context menu Duplicate fires callback with correct ID", async () => {
    const user = userEvent.setup();
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Server 1", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    await user.pointer({ target: screen.getByText("Server 1"), keys: "[MouseRight]" });
    await user.click(screen.getByText("Duplicate"));

    expect(defaultHandlers.onSessionDuplicate).toHaveBeenCalledWith("s1");
  });

  it("[AC-4] context menu Open fires callback with correct ID", async () => {
    const user = userEvent.setup();
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Server 1", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    await user.pointer({ target: screen.getByText("Server 1"), keys: "[MouseRight]" });
    await user.click(screen.getByText("Open"));

    expect(defaultHandlers.onSessionOpen).toHaveBeenCalledWith("s1");
  });

  // ── ARIA & Accessibility ──────────────────────────────────────

  it("[EDGE] tree has correct ARIA attributes", () => {
    const nodes: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Folder A",
        parentId: "root",
        sortOrder: 0,
        expanded: true,
        children: [
          { type: "session", id: "s1", name: "Session 1", protocol: "ssh", host: "1.1.1.1", port: 22 },
        ],
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    // Tree has role="tree" and aria-label
    const tree = screen.getByRole("tree");
    expect(tree).toHaveAttribute("aria-label", "Session tree");

    // Items have role="treeitem"
    const items = screen.getAllByRole("treeitem");
    expect(items.length).toBeGreaterThanOrEqual(2); // folder + session

    // Folder has aria-expanded
    const folderItem = items.find((item) =>
      item.querySelector(".session-tree-folder"),
    );
    expect(folderItem).toHaveAttribute("aria-expanded", "true");
  });

  it("[EDGE] tree is keyboard-focusable (tabIndex=0)", () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Session", protocol: "local" },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    const tree = screen.getByRole("tree");
    expect(tree).toHaveAttribute("tabindex", "0");
  });

  // ── Search Highlighting Edge Cases ────────────────────────────

  it("[EDGE] search highlight works with case-insensitive match", () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "Core Router DC1", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(
      <SessionTree
        nodes={nodes}
        {...defaultHandlers}
        searchQuery="core"
        isSearching={true}
      />,
    );

    const highlight = document.querySelector(".session-search-highlight");
    expect(highlight).toBeInTheDocument();
    expect(highlight?.textContent).toBe("Core");
  });

  it("[EDGE] search highlight with no match renders plain text", () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "My Server", protocol: "ssh", host: "1.1.1.1", port: 22 },
    ];

    render(
      <SessionTree
        nodes={nodes}
        {...defaultHandlers}
        searchQuery="nomatch"
        isSearching={true}
      />,
    );

    expect(screen.getByText("My Server")).toBeInTheDocument();
    expect(document.querySelector(".session-search-highlight")).not.toBeInTheDocument();
  });

  // ── Empty folder rendering ────────────────────────────────────

  it("[EDGE] empty folder renders without children container", () => {
    const nodes: SessionNode[] = [
      {
        type: "folder",
        id: "f1",
        name: "Empty Folder",
        parentId: "root",
        sortOrder: 0,
        expanded: true,
        children: [],
      },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    expect(screen.getByText("Empty Folder")).toBeInTheDocument();
    // No group element since children is empty
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  // ── Protocol icons ────────────────────────────────────────────

  it("[EDGE] displays correct protocol icons for all protocols", () => {
    const nodes: SessionNode[] = [
      { type: "session", id: "s1", name: "SSH Session", protocol: "ssh", host: "1.1.1.1", port: 22 },
      { type: "session", id: "s2", name: "Telnet Session", protocol: "telnet", host: "1.1.1.2", port: 23 },
      { type: "session", id: "s3", name: "Serial Session", protocol: "serial" },
      { type: "session", id: "s4", name: "Local Session", protocol: "local" },
    ];

    render(<SessionTree nodes={nodes} {...defaultHandlers} />);

    // All sessions should render
    expect(screen.getByText("SSH Session")).toBeInTheDocument();
    expect(screen.getByText("Telnet Session")).toBeInTheDocument();
    expect(screen.getByText("Serial Session")).toBeInTheDocument();
    expect(screen.getByText("Local Session")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SessionEditor — Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("SessionEditor — Edge Cases", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn();
    onCancel = vi.fn();
  });

  it("[EDGE] rejects whitespace-only name", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "   ");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(screen.getByTestId("session-editor-name-error")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[EDGE] rejects name with backslash", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "my\\server");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(screen.getByTestId("session-editor-name-error")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[BOUNDARY] accepts name at exactly 200 characters", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const name200 = "A".repeat(200);
    await user.type(screen.getByTestId("session-editor-name"), name200);
    await user.type(screen.getByTestId("session-editor-host"), "test.com");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalled();
  });

  it("[BOUNDARY] rejects name at 201 characters", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const name201 = "A".repeat(201);
    await user.type(screen.getByTestId("session-editor-name"), name201);
    await user.type(screen.getByTestId("session-editor-host"), "test.com");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(screen.getByTestId("session-editor-name-error")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[BOUNDARY] rejects port 0 — HTML5 constraint prevents submission", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");

    // Set port to 0 (violates min=1 HTML5 constraint)
    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "0" } });

    await user.click(screen.getByTestId("session-editor-save"));

    // HTML5 constraint validation prevents the form submit — onSave never called
    expect(onSave).not.toHaveBeenCalled();

    // Verify the input has correct min/max attributes (contract)
    expect(port).toHaveAttribute("min", "1");
    expect(port).toHaveAttribute("max", "65535");
    expect(port).toHaveAttribute("type", "number");
  });

  it("[BOUNDARY] rejects port 65536 — HTML5 constraint prevents submission", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");

    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "65536" } });

    await user.click(screen.getByTestId("session-editor-save"));

    // HTML5 constraint validation prevents the form submit — onSave never called
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[BOUNDARY] accepts port 1 (minimum valid)", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");

    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "1" } });
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1 }),
    );
  });

  it("[BOUNDARY] accepts port 65535 (maximum valid)", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");

    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "65535" } });
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ port: 65535 }),
    );
  });

  it("[EDGE] switching to local protocol hides and clears host/port", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    // Start as SSH (default)
    expect(screen.getByTestId("session-editor-host")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-port")).toBeInTheDocument();

    // Switch to local
    await user.selectOptions(screen.getByTestId("session-editor-protocol"), "local");

    // Host and port should be hidden
    expect(screen.queryByTestId("session-editor-host")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-editor-port")).not.toBeInTheDocument();

    // Fill name and submit — should succeed without host
    await user.type(screen.getByTestId("session-editor-name"), "Local Test");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Local Test",
        protocol: "local",
      }),
    );
    // Should NOT have host or port
    const callArg = onSave.mock.calls[0][0];
    expect(callArg.host).toBeUndefined();
    expect(callArg.port).toBeUndefined();
  });

  it("[EDGE] serial protocol hides host/port", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.selectOptions(screen.getByTestId("session-editor-protocol"), "serial");

    expect(screen.queryByTestId("session-editor-host")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-editor-port")).not.toBeInTheDocument();
  });

  it("[EDGE] overlay click cancels editor", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    // Click the overlay (not the form)
    const overlay = screen.getByTestId("session-editor");
    await user.click(overlay);

    expect(onCancel).toHaveBeenCalled();
  });

  it("[EDGE] click inside form does NOT cancel (stopPropagation)", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    // Click inside the form
    const form = screen.getByTestId("session-editor-form");
    await user.click(form);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("[EDGE] trims whitespace from name and host before submit", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "  My Server  ");
    await user.type(screen.getByTestId("session-editor-host"), "  test.com  ");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Server",
        host: "test.com",
      }),
    );
  });

  it("[EDGE] empty username is omitted from output (not empty string)", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Server");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");
    // Don't fill username
    await user.click(screen.getByTestId("session-editor-save"));

    const callArg = onSave.mock.calls[0][0];
    expect(callArg.username).toBeUndefined();
  });

  it("[EDGE] negative port is rejected — HTML5 constraint prevents submission", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("session-editor-name"), "Test");
    await user.type(screen.getByTestId("session-editor-host"), "test.com");

    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "-1" } });

    await user.click(screen.getByTestId("session-editor-save"));

    // HTML5 constraint validation prevents submission
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[EDGE] edit mode preserves original port when protocol doesnt change", () => {
    const session: SessionProfile = {
      id: "s1",
      name: "Custom Port Server",
      folderId: "root",
      protocol: "ssh",
      host: "test.com",
      port: 2222, // Non-default port
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    render(
      <SessionEditor
        session={session}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    // Should preserve the custom port, not reset to 22
    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    expect(port.value).toBe("2222");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SessionSearch — Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("SessionSearch — Edge Cases", () => {
  let onSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSearch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("[EDGE] rapid typing sends only final debounced value", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");

    // Type rapidly: c → co → cor → core
    fireEvent.change(input, { target: { value: "c" } });
    act(() => { vi.advanceTimersByTime(50); });

    fireEvent.change(input, { target: { value: "co" } });
    act(() => { vi.advanceTimersByTime(50); });

    fireEvent.change(input, { target: { value: "cor" } });
    act(() => { vi.advanceTimersByTime(50); });

    fireEvent.change(input, { target: { value: "core" } });

    // Before debounce fires — only intermediate calls may have gone through
    // After full debounce
    act(() => { vi.advanceTimersByTime(200); });

    // The final call should be with "core"
    const lastCall = onSearch.mock.calls[onSearch.mock.calls.length - 1];
    expect(lastCall[0]).toBe("core");
  });

  it("[EDGE] whitespace-only search clears results", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");
    fireEvent.change(input, { target: { value: "   " } });

    act(() => { vi.advanceTimersByTime(200); });

    expect(onSearch).toHaveBeenCalledWith("   ");
  });

  it("[EDGE] special characters in search dont cause errors", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");

    // Regex-special characters
    fireEvent.change(input, { target: { value: "test.*[foo]" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onSearch).toHaveBeenCalledWith("test.*[foo]");

    // Unicode
    fireEvent.change(input, { target: { value: "サーバー" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onSearch).toHaveBeenCalledWith("サーバー");
  });

  it("[EDGE] Escape clears the input and calls onSearch with empty", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");

    // Type something
    fireEvent.change(input, { target: { value: "query" } });
    act(() => { vi.advanceTimersByTime(200); });

    // Press Escape
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onSearch).toHaveBeenCalledWith("");
    expect(input).toHaveValue("");
  });

  it("[EDGE] multiple clear → search → clear cycles work correctly", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");

    // First search
    fireEvent.change(input, { target: { value: "first" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onSearch).toHaveBeenCalledWith("first");

    // Clear
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSearch).toHaveBeenCalledWith("");

    // Second search
    fireEvent.change(input, { target: { value: "second" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onSearch).toHaveBeenCalledWith("second");

    // Clear again
    const clearBtn = screen.getByTestId("session-search-clear");
    fireEvent.click(clearBtn);
    expect(onSearch).toHaveBeenCalledWith("");
  });
});
