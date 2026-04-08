/**
 * Unit tests for WorkspaceBar component.
 *
 * Tags: [TDD], [AC-workspace-bar], [AC-workspace-switch-UI]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceBar } from "../components/Workspace";
import { useWorkspaceStore } from "../stores/workspaceStore";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("mock-session-id"),
}));

describe("WorkspaceBar", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();

    // Reset workspace store
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Default",
          color: "#89b4fa",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: "ws-1",
    });
  });

  // ─── Rendering ────────────────────────────────────────────

  it("renders the workspace bar", () => {
    render(<WorkspaceBar />);
    expect(screen.getByTestId("workspace-bar")).toBeInTheDocument();
  });

  it("renders workspace items for each workspace", () => {
    render(<WorkspaceBar />);
    const items = screen.getAllByTestId(/^workspace-item-/);
    expect(items).toHaveLength(1);
  });

  it("shows the first letter of the workspace name", () => {
    render(<WorkspaceBar />);
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("renders the add workspace button", () => {
    render(<WorkspaceBar />);
    expect(screen.getByTestId("workspace-add")).toBeInTheDocument();
  });

  it("marks the active workspace with active class", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    expect(item.className).toContain("workspace-item--active");
  });

  // ─── Multiple workspaces ──────────────────────────────────

  it("renders multiple workspaces", () => {
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Default",
          color: "#89b4fa",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
        {
          id: "ws-2",
          name: "Lab",
          color: "#a6e3a1",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(<WorkspaceBar />);
    const items = screen.getAllByTestId(/^workspace-item-/);
    expect(items).toHaveLength(2);
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  // ─── Click to switch ──────────────────────────────────────

  it("clicking a workspace item switches workspace", async () => {
    const switchWorkspace = vi.spyOn(
      useWorkspaceStore.getState(),
      "switchWorkspace",
    );

    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Default",
          color: "#89b4fa",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
        {
          id: "ws-2",
          name: "Lab",
          color: "#a6e3a1",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(<WorkspaceBar />);
    const labItem = screen.getByTestId("workspace-item-ws-2");
    await userEvent.click(labItem);

    // Check that the workspace store updated
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");

    switchWorkspace.mockRestore();
  });

  // ─── Add workspace ────────────────────────────────────────

  it("clicking add button creates a new workspace", async () => {
    render(<WorkspaceBar />);
    const addButton = screen.getByTestId("workspace-add");
    await userEvent.click(addButton);

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
  });

  // ─── Context menu ─────────────────────────────────────────

  it("right-clicking a workspace shows context menu", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    fireEvent.contextMenu(item);
    expect(screen.getByTestId("workspace-context-menu")).toBeInTheDocument();
  });

  it("context menu shows rename option", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    fireEvent.contextMenu(item);
    expect(screen.getByText("Rename")).toBeInTheDocument();
  });

  it("context menu shows change color option", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    fireEvent.contextMenu(item);
    expect(screen.getByText("Change Color")).toBeInTheDocument();
  });

  it("context menu shows delete option", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    fireEvent.contextMenu(item);
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  // ─── Tooltip ──────────────────────────────────────────────

  it("workspace item has title attribute for tooltip", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    expect(item.getAttribute("title")).toBe("Default");
  });

  // ─── Workspace color ──────────────────────────────────────

  it("workspace item displays the workspace color", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    expect(item.style.backgroundColor).toBeTruthy();
  });

  // ─── Accessibility ────────────────────────────────────────

  it("workspace bar has navigation role", () => {
    render(<WorkspaceBar />);
    const bar = screen.getByTestId("workspace-bar");
    expect(bar.getAttribute("role")).toBe("navigation");
  });

  it("workspace items are focusable", () => {
    render(<WorkspaceBar />);
    const item = screen.getByTestId("workspace-item-ws-1");
    expect(item.getAttribute("tabIndex")).toBe("0");
  });
});
