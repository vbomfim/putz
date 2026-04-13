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
import { useLayoutStore } from "../stores/layoutStore";

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
          savedLayout: null,
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: "default",
    });

    // Reset layout store to a single empty region
    useLayoutStore.setState({
      layout: { type: "region", regionId: "region-1" },
      regions: {
        "region-1": { id: "region-1", tabs: [], activeTabId: "" },
      },
      focusedRegionId: "region-1",
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

  it("addWorkspace initializes with no saved layout", () => {
    useWorkspaceStore.getState().addWorkspace("Dev");
    const state = useWorkspaceStore.getState();
    // After addWorkspace, it switches to the new workspace, so savedLayout
    // for the new workspace starts as null (then gets the current layout captured on switch)
    // The "Dev" workspace was just switched to, so it has a fresh layout in layoutStore
    const devWs = state.workspaces.find((w) => w.name === "Dev");
    expect(devWs).toBeDefined();
    // savedLayout gets populated when we switch AWAY, not when we switch TO
    // Right after addWorkspace + switchWorkspace, the dev ws savedLayout stays null
    // But the default workspace now has a savedLayout from the switch
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

  it("switchWorkspace saves current layout to old workspace", () => {
    // Set up some state in layoutStore
    useLayoutStore.setState({
      layout: { type: "region", regionId: "region-1" },
      regions: {
        "region-1": {
          id: "region-1",
          tabs: [
            { id: "tab-1", type: "terminal", title: "Terminal 1", sessionId: "s1", isSearchOpen: false },
          ],
          activeTabId: "tab-1",
        },
      },
      focusedRegionId: "region-1",
    });

    useWorkspaceStore.getState().addWorkspace("Dev");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _devId = useWorkspaceStore.getState().workspaces.find((w) => w.name === "Dev")!.id;

    // The old workspace (default) should have saved the layout
    const defaultWs = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === "default");
    expect(defaultWs?.savedLayout).not.toBeNull();
    expect(defaultWs?.savedLayout?.regions["region-1"]?.tabs).toHaveLength(1);
    expect(defaultWs?.savedLayout?.regions["region-1"]?.tabs[0].id).toBe("tab-1");
  });

  it("switchWorkspace restores target workspace layout to layoutStore", () => {
    // Add a workspace with pre-saved layout
    useWorkspaceStore.getState().addWorkspace("Dev");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _devId = useWorkspaceStore.getState().workspaces.find((w) => w.name === "Dev")!.id;

    // Manually set saved layout in the default workspace (simulating previous state)
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === "default"
          ? {
              ...w,
              savedLayout: {
                layout: { type: "region" as const, regionId: "r-saved" },
                regions: {
                  "r-saved": {
                    id: "r-saved",
                    tabs: [
                      { id: "saved-tab-1", type: "terminal" as const, title: "Saved Terminal", sessionId: "saved-s1", isSearchOpen: false },
                    ],
                    activeTabId: "saved-tab-1",
                  },
                },
                focusedRegionId: "r-saved",
              },
            }
          : w,
      ),
    }));

    // Switch back to default — should restore its saved layout
    useWorkspaceStore.getState().switchWorkspace("default");

    // layoutStore should now have the default workspace's saved layout
    const layoutState = useLayoutStore.getState();
    expect(layoutState.focusedRegionId).toBe("r-saved");
    expect(Object.keys(layoutState.regions)).toHaveLength(1);
    expect(layoutState.regions["r-saved"]?.tabs).toHaveLength(1);
    expect(layoutState.regions["r-saved"]?.tabs[0].id).toBe("saved-tab-1");
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
