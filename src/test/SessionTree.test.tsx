/**
 * SessionTree component tests.
 *
 * Tags: [AC-2], [AC-4], [AC-7], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionTree } from "../components/SessionManager/SessionTree";
import type { SessionNode } from "../components/SessionManager/types";

// Mock Tauri API (SessionTree doesn't call it directly, but just in case)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe("SessionTree", () => {
  const defaultHandlers = {
    onSessionOpen: vi.fn(),
    onSessionEdit: vi.fn(),
    onSessionDelete: vi.fn(),
    onSessionDuplicate: vi.fn(),
    onNewSession: vi.fn(),
    onNewFolder: vi.fn(),
    onFolderDelete: vi.fn(),
  };

  beforeEach(() => {
    Object.values(defaultHandlers).forEach((fn) => fn.mockReset());
  });

  const sampleNodes: SessionNode[] = [
    {
      type: "folder",
      id: "f1",
      name: "Production",
      parentId: "root",
      sortOrder: 0,
      expanded: true,
      children: [
        {
          type: "session",
          id: "s1",
          name: "Web Server",
          protocol: "ssh",
          host: "10.0.0.1",
          port: 22,
          username: "admin",
        },
      ],
    },
    {
      type: "session",
      id: "s2",
      name: "Local Shell",
      protocol: "local",
    },
  ];

  // ─── Rendering ───────────────────────────────────────────

  it("renders tree with ARIA role", () => {
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);
    const tree = screen.getByRole("tree");
    expect(tree).toBeInTheDocument();
  });

  it("renders folder nodes", () => {
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("renders session nodes", () => {
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);
    expect(screen.getByText("Web Server")).toBeInTheDocument();
    expect(screen.getByText("Local Shell")).toBeInTheDocument();
  });

  it("shows host info for sessions with host", () => {
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
  });

  it("renders treeitems with ARIA roles", () => {
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);
    const items = screen.getAllByRole("treeitem");
    expect(items.length).toBeGreaterThanOrEqual(3); // folder + 2 sessions
  });

  // ─── Empty State ─────────────────────────────────────────

  it("shows empty state when no nodes", () => {
    render(<SessionTree nodes={[]} {...defaultHandlers} />);
    expect(screen.getByTestId("session-tree-empty")).toBeInTheDocument();
    expect(screen.getByText("No saved sessions yet.")).toBeInTheDocument();
  });

  it("shows create button in empty state", () => {
    render(<SessionTree nodes={[]} {...defaultHandlers} />);
    const btn = screen.getByTestId("session-create-first");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Create your first session");
  });

  it("calls onNewSession from empty state button", async () => {
    const user = userEvent.setup();
    render(<SessionTree nodes={[]} {...defaultHandlers} />);

    const btn = screen.getByTestId("session-create-first");
    await user.click(btn);
    expect(defaultHandlers.onNewSession).toHaveBeenCalled();
  });

  it("shows search empty state when searching", () => {
    render(<SessionTree nodes={[]} {...defaultHandlers} isSearching={true} />);
    expect(
      screen.getByText("No sessions match your search."),
    ).toBeInTheDocument();
  });

  // ─── Interaction: Double-click ────────────────────────────

  it("[AC-4] double-click session fires onSessionOpen", async () => {
    const user = userEvent.setup();
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);

    const session = screen.getByText("Local Shell");
    await user.dblClick(session);
    expect(defaultHandlers.onSessionOpen).toHaveBeenCalledWith("s2");
  });

  // ─── Interaction: Folder toggle ───────────────────────────

  it("collapses folder on click", async () => {
    const user = userEvent.setup();
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);

    // Initially expanded — Web Server visible
    expect(screen.getByText("Web Server")).toBeInTheDocument();

    // Click folder to collapse
    const folder = screen.getByText("Production");
    await user.click(folder);

    // Web Server should be hidden
    expect(screen.queryByText("Web Server")).not.toBeInTheDocument();
  });

  // ─── Search highlighting ─────────────────────────────────

  it("highlights matching text during search", () => {
    render(
      <SessionTree
        nodes={sampleNodes}
        {...defaultHandlers}
        searchQuery="Web"
        isSearching={true}
      />,
    );

    const highlight = document.querySelector(".session-search-highlight");
    expect(highlight).toBeInTheDocument();
    expect(highlight?.textContent).toBe("Web");
  });

  // ─── Context menu ────────────────────────────────────────

  it("shows context menu on right-click session", async () => {
    const user = userEvent.setup();
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);

    const session = screen.getByText("Local Shell");
    await user.pointer({ target: session, keys: "[MouseRight]" });

    const menu = screen.getByTestId("session-context-menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("shows folder context menu on right-click folder", async () => {
    const user = userEvent.setup();
    render(<SessionTree nodes={sampleNodes} {...defaultHandlers} />);

    const folder = screen.getByText("Production");
    await user.pointer({ target: folder, keys: "[MouseRight]" });

    expect(screen.getByText("New Session")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.getByText("Delete Folder")).toBeInTheDocument();
  });
});
