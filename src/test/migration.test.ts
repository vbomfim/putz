/**
 * Unit tests for persistence migration (v0.3.x → v1.0).
 *
 * Covers:
 * - Filtering tabs with removed content types (ssh, vault, chatview, etc.)
 * - Stripping removed fields (status, connectionId, etc.)
 * - Fixing activeTabId after tab removal
 * - Edge cases: null, undefined, empty, corrupted data
 * - Schema version upgrade path
 * - Workspace-level migration with multiple regions
 *
 * Tags: [TDD], [AC1-clean-boot], [AC3-no-data-loss]
 * @module migration.test
 */
import { describe, it, expect } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  VALID_CONTENT_TYPES,
  isValidContentType,
  stripRemovedFields,
  migrateRegion,
  migrateWorkspaceLayout,
} from "../utils/migratePersistence";

// ─── Schema Version ──────────────────────────────────────────────────

describe("schema version", () => {
  it("current schema version is 1", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});

// ─── VALID_CONTENT_TYPES ─────────────────────────────────────────────

describe("VALID_CONTENT_TYPES", () => {
  it("includes all v1.0 content types", () => {
    const expected = [
      "terminal",
      "editor",
      "diff",
      "search",
      "history",
      "templates",
      "settings",
      "markdown",
      "csv",
      "bookmarks",
      "drawio",
      "git-graph",
      "radio",
    ];
    for (const t of expected) {
      expect(VALID_CONTENT_TYPES.has(t)).toBe(true);
    }
  });

  it("does NOT include removed content types", () => {
    const removed = ["ssh", "vault", "chatview", "sftp", "serial", "telnet"];
    for (const t of removed) {
      expect(VALID_CONTENT_TYPES.has(t)).toBe(false);
    }
  });
});

// ─── isValidContentType ──────────────────────────────────────────────

describe("isValidContentType", () => {
  it("returns true for valid types", () => {
    expect(isValidContentType("terminal")).toBe(true);
    expect(isValidContentType("editor")).toBe(true);
    expect(isValidContentType("radio")).toBe(true);
  });

  it("returns false for removed types", () => {
    expect(isValidContentType("ssh")).toBe(false);
    expect(isValidContentType("vault")).toBe(false);
    expect(isValidContentType("chatview")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidContentType(null)).toBe(false);
    expect(isValidContentType(undefined)).toBe(false);
    expect(isValidContentType(42)).toBe(false);
    expect(isValidContentType({})).toBe(false);
  });
});

// ─── stripRemovedFields ──────────────────────────────────────────────

describe("stripRemovedFields", () => {
  it("strips the status field from a tab", () => {
    const tab = {
      id: "tab-1",
      title: "Terminal 1",
      type: "terminal",
      sessionId: "sess-1",
      status: "connected",
    };
    const result = stripRemovedFields(tab);
    expect(result).not.toHaveProperty("status");
    expect(result.id).toBe("tab-1");
    expect(result.type).toBe("terminal");
  });

  it("strips connectionId and other removed fields", () => {
    const tab = {
      id: "tab-2",
      title: "SSH Session",
      type: "ssh",
      sessionId: "sess-2",
      connectionId: "conn-1",
      remoteHost: "192.168.1.1",
      remotePort: 22,
      sshConfig: { key: "value" },
      serialConfig: { baud: 9600 },
    };
    const result = stripRemovedFields(tab);
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("connectionId");
    expect(result).not.toHaveProperty("remoteHost");
    expect(result).not.toHaveProperty("remotePort");
    expect(result).not.toHaveProperty("sshConfig");
    expect(result).not.toHaveProperty("serialConfig");
  });

  it("preserves valid RegionTab fields", () => {
    const tab = {
      id: "tab-3",
      title: "Editor",
      type: "editor",
      sessionId: "editor-1",
      editorFilePath: "/home/user/file.ts",
      editorScriptId: "script-1",
    };
    const result = stripRemovedFields(tab);
    expect(result.id).toBe("tab-3");
    expect(result.title).toBe("Editor");
    expect(result.type).toBe("editor");
    expect(result.sessionId).toBe("editor-1");
    expect(result.editorFilePath).toBe("/home/user/file.ts");
    expect(result.editorScriptId).toBe("script-1");
  });
});

// ─── migrateRegion ───────────────────────────────────────────────────

describe("migrateRegion", () => {
  it("removes tabs with removed content types (ssh)", () => {
    const region = {
      id: "region-1",
      tabs: [
        { id: "t1", title: "SSH", type: "ssh", sessionId: "s1" },
        { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe("t2");
    expect(result.tabs[0].type).toBe("terminal");
  });

  it("removes tabs with removed content type (vault)", () => {
    const region = {
      id: "region-1",
      tabs: [{ id: "t1", title: "Vault", type: "vault", sessionId: "s1" }],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(0);
    expect(result.activeTabId).toBe("");
  });

  it("removes tabs with chatview content type", () => {
    const region = {
      id: "region-1",
      tabs: [
        { id: "t1", title: "Chat", type: "chatview", sessionId: "s1" },
        { id: "t2", title: "Term", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].type).toBe("terminal");
  });

  it("strips removed fields (status) from kept tabs", () => {
    const region = {
      id: "region-1",
      tabs: [
        {
          id: "t1",
          title: "Terminal",
          type: "terminal",
          sessionId: "s1",
          status: "connected",
        },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).not.toHaveProperty("status");
    expect(result.tabs[0].id).toBe("t1");
  });

  it("fixes activeTabId when it pointed to a removed tab", () => {
    const region = {
      id: "region-1",
      tabs: [
        { id: "t1", title: "SSH", type: "ssh", sessionId: "s1" },
        { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t1", // points to the SSH tab that will be removed
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.activeTabId).toBe("t2"); // fixed to first remaining
  });

  it("preserves activeTabId when it points to a kept tab", () => {
    const region = {
      id: "region-1",
      tabs: [
        { id: "t1", title: "Terminal 1", type: "terminal", sessionId: "s1" },
        { id: "t2", title: "Terminal 2", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t2",
      tabPosition: "bottom",
    };
    const result = migrateRegion(region);
    expect(result.activeTabId).toBe("t2");
    expect(result.tabPosition).toBe("bottom");
  });

  it("handles empty tabs array", () => {
    const region = {
      id: "region-1",
      tabs: [],
      activeTabId: "",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(0);
    expect(result.activeTabId).toBe("");
  });

  it("handles missing tabs field", () => {
    const region = {
      id: "region-1",
      activeTabId: "whatever",
      tabPosition: "top",
    };
    const result = migrateRegion(region as Record<string, unknown>);
    expect(result.tabs).toHaveLength(0);
    expect(result.activeTabId).toBe("");
  });

  it("handles null tab entries in the array", () => {
    const region = {
      id: "region-1",
      tabs: [
        null,
        { id: "t1", title: "Terminal", type: "terminal", sessionId: "s1" },
        undefined,
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region as Record<string, unknown>);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe("t1");
  });

  it("defaults missing tabPosition to 'top'", () => {
    const region = {
      id: "region-1",
      tabs: [],
      activeTabId: "",
    };
    const result = migrateRegion(region as Record<string, unknown>);
    expect(result.tabPosition).toBe("top");
  });

  it("preserves all valid tab types through migration", () => {
    const validTypes = [
      "terminal",
      "editor",
      "diff",
      "search",
      "history",
      "templates",
      "settings",
      "markdown",
      "csv",
      "bookmarks",
      "drawio",
      "git-graph",
      "radio",
    ];
    const tabs = validTypes.map((type, i) => ({
      id: `t${i}`,
      title: `Tab ${i}`,
      type,
      sessionId: `s${i}`,
    }));
    const region = {
      id: "region-1",
      tabs,
      activeTabId: "t0",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(validTypes.length);
  });

  it("handles mixed valid and invalid tabs", () => {
    const region = {
      id: "region-1",
      tabs: [
        {
          id: "t1",
          title: "SSH",
          type: "ssh",
          sessionId: "s1",
          status: "connected",
        },
        { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
        { id: "t3", title: "Vault", type: "vault", sessionId: "s3" },
        {
          id: "t4",
          title: "Editor",
          type: "editor",
          sessionId: "s4",
          editorFilePath: "/tmp/f",
        },
        { id: "t5", title: "SFTP", type: "sftp", sessionId: "s5" },
        { id: "t6", title: "Serial", type: "serial", sessionId: "s6" },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs.map((t) => t.type)).toEqual(["terminal", "editor"]);
    expect(result.activeTabId).toBe("t2"); // fixed from removed t1
  });
});

// ─── migrateWorkspaceLayout ──────────────────────────────────────────

describe("migrateWorkspaceLayout", () => {
  it("migrates all regions in a layout snapshot", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [
            { id: "t1", title: "SSH", type: "ssh", sessionId: "s1" },
            { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
          ],
          activeTabId: "t1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.regions.r1.tabs).toHaveLength(1);
    expect(result!.regions.r1.tabs[0].type).toBe("terminal");
    expect(result!.regions.r1.activeTabId).toBe("t2");
  });

  it("returns null for null input", () => {
    expect(migrateWorkspaceLayout(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(migrateWorkspaceLayout(undefined)).toBeNull();
  });

  it("returns null if regions field is missing", () => {
    const raw = { layout: { type: "region", regionId: "r1" } };
    expect(migrateWorkspaceLayout(raw as Record<string, unknown>)).toBeNull();
  });

  it("preserves layout tree structure", () => {
    const layout = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "region", regionId: "r1" },
        { type: "region", regionId: "r2" },
      ],
      ratio: 0.5,
    };
    const raw = {
      layout,
      regions: {
        r1: {
          id: "r1",
          tabs: [
            { id: "t1", title: "Term", type: "terminal", sessionId: "s1" },
          ],
          activeTabId: "t1",
          tabPosition: "top",
        },
        r2: {
          id: "r2",
          tabs: [{ id: "t2", title: "Edit", type: "editor", sessionId: "s2" }],
          activeTabId: "t2",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.layout).toEqual(layout); // layout tree preserved exactly
    expect(result!.focusedRegionId).toBe("r1");
  });

  it("migrates multiple regions independently", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [{ id: "t1", title: "Vault", type: "vault", sessionId: "s1" }],
          activeTabId: "t1",
          tabPosition: "top",
        },
        r2: {
          id: "r2",
          tabs: [
            { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
            { id: "t3", title: "SSH", type: "ssh", sessionId: "s3" },
          ],
          activeTabId: "t3",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r2",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.regions.r1.tabs).toHaveLength(0);
    expect(result!.regions.r2.tabs).toHaveLength(1);
    expect(result!.regions.r2.tabs[0].type).toBe("terminal");
    expect(result!.regions.r2.activeTabId).toBe("t2");
  });

  it("handles region data that is not an object", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: "not-an-object",
        r2: null,
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(
      raw as unknown as Record<string, unknown>,
    );
    expect(result).not.toBeNull();
    // Invalid regions are skipped
    expect(Object.keys(result!.regions)).toHaveLength(0);
  });
});

// ─── Integration: Full old-to-new upgrade scenario ───────────────────

describe("full upgrade scenario", () => {
  it("migrates a v0.3.x workspace with mixed old and new tabs", () => {
    // Simulates what localStorage might look like for a v0.3.x user
    const oldWorkspaceData = {
      layout: {
        type: "split",
        direction: "horizontal",
        children: [
          { type: "region", regionId: "main" },
          { type: "region", regionId: "side" },
        ],
        ratio: 0.7,
      },
      regions: {
        main: {
          id: "main",
          tabs: [
            {
              id: "tab-ssh-1",
              title: "router-01",
              type: "ssh",
              sessionId: "sess-ssh-1",
              status: "connected",
              connectionId: "conn-router-01",
              remoteHost: "192.168.1.1",
              remotePort: 22,
            },
            {
              id: "tab-term-1",
              title: "Terminal 1",
              type: "terminal",
              sessionId: "sess-term-1",
              status: "local",
            },
            {
              id: "tab-vault",
              title: "Credential Vault",
              type: "vault",
              sessionId: "vault-view",
            },
          ],
          activeTabId: "tab-ssh-1",
          tabPosition: "top",
        },
        side: {
          id: "side",
          tabs: [
            {
              id: "tab-editor-1",
              title: "config.yaml",
              type: "editor",
              sessionId: "editor-config",
              editorFilePath: "/etc/config.yaml",
            },
            {
              id: "tab-chat",
              title: "AI Chat",
              type: "chatview",
              sessionId: "chat-1",
            },
          ],
          activeTabId: "tab-editor-1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "main",
    };

    const result = migrateWorkspaceLayout(oldWorkspaceData);
    expect(result).not.toBeNull();

    // Main region: SSH and Vault removed, Terminal kept (status stripped)
    const mainRegion = result!.regions.main;
    expect(mainRegion.tabs).toHaveLength(1);
    expect(mainRegion.tabs[0].id).toBe("tab-term-1");
    expect(mainRegion.tabs[0].type).toBe("terminal");
    expect(mainRegion.tabs[0]).not.toHaveProperty("status");
    expect(mainRegion.activeTabId).toBe("tab-term-1"); // fixed from removed tab-ssh-1

    // Side region: Editor kept, ChatView removed
    const sideRegion = result!.regions.side;
    expect(sideRegion.tabs).toHaveLength(1);
    expect(sideRegion.tabs[0].id).toBe("tab-editor-1");
    expect(sideRegion.tabs[0].type).toBe("editor");
    expect(sideRegion.tabs[0].editorFilePath).toBe("/etc/config.yaml");
    expect(sideRegion.activeTabId).toBe("tab-editor-1"); // still valid

    // Layout tree and focus preserved
    expect(result!.layout).toEqual(oldWorkspaceData.layout);
    expect(result!.focusedRegionId).toBe("main");
  });

  it("all tabs removed → empty region with no crash", () => {
    const data = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [
            { id: "t1", title: "SSH", type: "ssh", sessionId: "s1" },
            { id: "t2", title: "Vault", type: "vault", sessionId: "s2" },
          ],
          activeTabId: "t1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(data);
    expect(result).not.toBeNull();
    expect(result!.regions.r1.tabs).toHaveLength(0);
    expect(result!.regions.r1.activeTabId).toBe("");
  });
});
