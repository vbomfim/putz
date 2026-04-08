/**
 * Unit tests for workspace store.
 *
 * Tags: [TDD], [AC-workspace-CRUD], [AC-workspace-switch], [AC-workspace-persist]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

// Must import after localStorage mock is set up
import { useWorkspaceStore, WORKSPACE_COLORS } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";

// Mock Tauri IPC (tabStore uses invoke)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("mock-session-id"),
}));

describe("workspaceStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();

    // Reset workspace store to initial state
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "default",
          name: "Default",
          color: "#89b4fa",
          tabs: [],
          activeTabId: "",
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: "default",
    });

    // Reset tab store
    useTabStore.setState({
      tabs: [],
      activeTabId: "",
      tabCounter: 0,
    });
  });

  // ─── Default State ────────────────────────────────────────

  it("starts with one default workspace", () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe("Default");
    expect(state.workspaces[0].color).toBe("#89b4fa");
  });

  it("default workspace is active", () => {
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("default");
  });

  // ─── Add Workspace ────────────────────────────────────────

  it("addWorkspace creates a new workspace", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces[1].name).toBe("Dev");
  });

  it("addWorkspace uses provided color", () => {
    useWorkspaceStore.getState().addWorkspace("Dev", "#a6e3a1");
    const state = useWorkspaceStore.getState();
    expect(state.workspaces[1].color).toBe("#a6e3a1");
  });

  it("addWorkspace assigns a default color if none provided", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const state = useWorkspaceStore.getState();
    expect(WORKSPACE_COLORS).toContain(state.workspaces[1].color);
  });

  it("addWorkspace generates a unique ID", () => {
    useWorkspaceStore.getState().addWorkspace("A");
    useWorkspaceStore.getState().addWorkspace("B");
    const state = useWorkspaceStore.getState();
    const ids = state.workspaces.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("addWorkspace initializes with empty tabs", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const state = useWorkspaceStore.getState();
    expect(state.workspaces[1].tabs).toEqual([]);
    expect(state.workspaces[1].activeTabId).toBe("");
  });

  it("addWorkspace persists to localStorage", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  // ─── Remove Workspace ─────────────────────────────────────

  it("removeWorkspace deletes the workspace", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const devId = useWorkspaceStore.getState().workspaces[1].id;
    useWorkspaceStore.getState().removeWorkspace(devId);
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe("Default");
  });

  it("removeWorkspace prevents deleting the last workspace", () => {
    useWorkspaceStore.getState().removeWorkspace("default");
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(1);
  });

  it("removeWorkspace switches to another workspace if active is deleted", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const devId = useWorkspaceStore.getState().workspaces[1].id;
    useWorkspaceStore.getState().switchWorkspace(devId);
    useWorkspaceStore.getState().removeWorkspace(devId);
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("default");
  });

  it("removeWorkspace does nothing for unknown ID", () => {
    useWorkspaceStore.getState().removeWorkspace("nonexistent");
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
  });

  // ─── Rename Workspace ─────────────────────────────────────

  it("renameWorkspace updates the name", () => {
    useWorkspaceStore.getState().renameWorkspace("default", "Production");
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("Production");
  });

  it("renameWorkspace trims whitespace", () => {
    useWorkspaceStore.getState().renameWorkspace("default", "  Lab  ");
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("Lab");
  });

  it("renameWorkspace rejects empty names", () => {
    useWorkspaceStore.getState().renameWorkspace("default", "   ");
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("Default");
  });

  it("renameWorkspace persists to localStorage", () => {
    localStorageMock.setItem.mockClear();
    useWorkspaceStore.getState().renameWorkspace("default", "Lab");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  // ─── Set Workspace Color ──────────────────────────────────

  it("setWorkspaceColor updates the color", () => {
    useWorkspaceStore.getState().setWorkspaceColor("default", "#f38ba8");
    expect(useWorkspaceStore.getState().workspaces[0].color).toBe("#f38ba8");
  });

  it("setWorkspaceColor persists to localStorage", () => {
    localStorageMock.setItem.mockClear();
    useWorkspaceStore.getState().setWorkspaceColor("default", "#a6e3a1");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  // ─── Switch Workspace ─────────────────────────────────────

  it("switchWorkspace changes the active workspace", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const devId = useWorkspaceStore.getState().workspaces[1].id;
    useWorkspaceStore.getState().switchWorkspace(devId);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(devId);
  });

  it("switchWorkspace saves current tabs to old workspace", () => {
    // Set up some tabs in the tab store
    useTabStore.setState({
      tabs: [
        {
          id: "tab-1",
          title: "Terminal 1",
          layout: { type: "leaf", terminalSessionId: "s1" },
          status: "local",
          createdAt: Date.now(),
        },
      ],
      activeTabId: "tab-1",
      tabCounter: 1,
    });

    useWorkspaceStore.getState().addWorkspace("Dev");
    const devId = useWorkspaceStore.getState().workspaces[1].id;
    useWorkspaceStore.getState().switchWorkspace(devId);

    // The old workspace (default) should have saved the tab
    const defaultWs = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === "default");
    expect(defaultWs?.tabs).toHaveLength(1);
    expect(defaultWs?.tabs[0].id).toBe("tab-1");
  });

  it("switchWorkspace restores target workspace tabs to tabStore", () => {
    // Add a workspace with pre-saved tabs
    useWorkspaceStore.getState().addWorkspace("Dev");
    const devId = useWorkspaceStore.getState().workspaces[1].id;

    // Manually set tabs in the Dev workspace
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === devId
          ? {
              ...w,
              tabs: [
                {
                  id: "dev-tab-1",
                  title: "Dev Terminal",
                  layout: { type: "leaf" as const, terminalSessionId: "dev-s1" },
                  status: "local" as const,
                  createdAt: Date.now(),
                },
              ],
              activeTabId: "dev-tab-1",
            }
          : w,
      ),
    }));

    useWorkspaceStore.getState().switchWorkspace(devId);

    // tabStore should now have the Dev workspace's tabs
    const tabState = useTabStore.getState();
    expect(tabState.tabs).toHaveLength(1);
    expect(tabState.tabs[0].id).toBe("dev-tab-1");
    expect(tabState.activeTabId).toBe("dev-tab-1");
  });

  it("switchWorkspace does nothing for unknown ID", () => {
    const before = useWorkspaceStore.getState().activeWorkspaceId;
    useWorkspaceStore.getState().switchWorkspace("nonexistent");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(before);
  });

  it("switchWorkspace does nothing if already active", () => {
    localStorageMock.setItem.mockClear();
    useWorkspaceStore.getState().switchWorkspace("default");
    // No state change should occur
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("default");
  });

  // ─── Get Active Workspace ─────────────────────────────────

  it("getActiveWorkspace returns the active workspace", () => {
    const ws = useWorkspaceStore.getState().getActiveWorkspace();
    expect(ws.id).toBe("default");
    expect(ws.name).toBe("Default");
  });

  // ─── Persistence ──────────────────────────────────────────

  it("persists workspaces to localStorage on add", () => {
    useWorkspaceStore.getState().addWorkspace("Lab");
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[
        localStorageMock.setItem.mock.calls.length - 1
      ][1],
    );
    expect(stored.workspaces).toHaveLength(2);
  });

  it("persists activeWorkspaceId on switch", () => {
    useWorkspaceStore.getState().addWorkspace("Lab");
    const labId = useWorkspaceStore.getState().workspaces[1].id;
    useWorkspaceStore.getState().switchWorkspace(labId);
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[
        localStorageMock.setItem.mock.calls.length - 1
      ][1],
    );
    expect(stored.activeWorkspaceId).toBe(labId);
  });

  // ─── WORKSPACE_COLORS constant ────────────────────────────

  it("provides a set of preset workspace colors", () => {
    expect(WORKSPACE_COLORS).toContain("#89b4fa");
    expect(WORKSPACE_COLORS).toContain("#a6e3a1");
    expect(WORKSPACE_COLORS).toContain("#f38ba8");
    expect(WORKSPACE_COLORS.length).toBeGreaterThanOrEqual(8);
  });
});
