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
import { describe, it, expect, vi } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  VALID_TAB_TYPES,
  REMOVED_FEATURE_STORAGE_KEYS,
  isValidContentType,
  isValidRegionTabShape,
  stripToValidFields,
  migrateRegion,
  migrateWorkspaceLayout,
  clearRemovedFeatureStorage,
} from "../utils/migratePersistence";

// ─── Schema Version ──────────────────────────────────────────────────

describe("schema version", () => {
  it("current schema version is 3", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });
});

// ─── VALID_TAB_TYPES ─────────────────────────────────────────────────

describe("VALID_TAB_TYPES", () => {
  it("includes all v1.1 content types", () => {
    const expected = [
      "terminal",
      "editor",
      "diff",
      "search",
      "settings",
      "markdown",
      "csv",
      "bookmarks",
      "drawio",
      "git-graph",
      "radio",
    ];
    for (const t of expected) {
      expect(VALID_TAB_TYPES.has(t)).toBe(true);
    }
  });

  it("does NOT include removed content types", () => {
    const removed = [
      "ssh",
      "vault",
      "chatview",
      "sftp",
      "serial",
      "telnet",
      // Removed in templates+history decommission
      "history",
      "templates",
    ];
    for (const t of removed) {
      expect(VALID_TAB_TYPES.has(t)).toBe(false);
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

// ─── stripToValidFields ──────────────────────────────────────────────

describe("stripToValidFields", () => {
  it("strips the status field from a tab", () => {
    const tab = {
      id: "tab-1",
      title: "Terminal 1",
      type: "terminal",
      sessionId: "sess-1",
      status: "connected",
    };
    const result = stripToValidFields(tab);
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
    const result = stripToValidFields(tab);
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
    const result = stripToValidFields(tab);
    expect(result.id).toBe("tab-3");
    expect(result.title).toBe("Editor");
    expect(result.type).toBe("editor");
    expect(result.sessionId).toBe("editor-1");
    expect(result.editorFilePath).toBe("/home/user/file.ts");
    expect(result.editorScriptId).toBe("script-1");
  });

  it("preserves diff-related fields", () => {
    const tab = {
      id: "tab-diff",
      title: "Diff",
      type: "diff",
      sessionId: "diff-1",
      diffLeftPath: "/a.ts",
      diffRightPath: "/b.ts",
      diffLeftContent: "left",
      diffRightContent: "right",
    };
    const result = stripToValidFields(tab);
    expect(result.diffLeftPath).toBe("/a.ts");
    expect(result.diffRightPath).toBe("/b.ts");
    expect(result.diffLeftContent).toBe("left");
    expect(result.diffRightContent).toBe("right");
  });

  it("strips unknown/adversarial keys not in the allowlist", () => {
    const tab = {
      id: "tab-4",
      title: "Term",
      type: "terminal",
      sessionId: "s4",
      remoteUser: "admin",
      unknownField: "should-be-dropped",
    };
    const result = stripToValidFields(tab);
    expect(result).not.toHaveProperty("remoteUser");
    expect(result).not.toHaveProperty("unknownField");
    expect(result.id).toBe("tab-4");
  });

  it("returns a null-prototype object", () => {
    const tab = { id: "x", title: "t", type: "terminal", sessionId: "s" };
    const result = stripToValidFields(tab);
    expect(Object.getPrototypeOf(result)).toBeNull();
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

// ─── Schema version stamping ─────────────────────────────────────────

describe("schema version stamping", () => {
  it("stamps CURRENT_SCHEMA_VERSION on migrated output", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [
            { id: "t1", title: "Term", type: "terminal", sessionId: "s1" },
          ],
          activeTabId: "t1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("input with schemaVersion: 1 is still validated (defense-in-depth)", () => {
    const raw = {
      schemaVersion: 1,
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [
            {
              id: "t1",
              title: "Term",
              type: "terminal",
              sessionId: "s1",
              status: "stale-field",
            },
          ],
          activeTabId: "t1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Even with schemaVersion: 1, fields are still cleaned
    expect(result!.regions.r1.tabs[0]).not.toHaveProperty("status");
  });

  it("input with schemaVersion: undefined is migrated", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [{ id: "t1", title: "SSH", type: "ssh", sessionId: "s1" }],
          activeTabId: "t1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result!.regions.r1.tabs).toHaveLength(0);
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────

describe("idempotency", () => {
  it("migrating twice equals migrating once", () => {
    const input = {
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
          ],
          activeTabId: "tab-editor-1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "main",
    };
    const once = migrateWorkspaceLayout(input);
    const twice = migrateWorkspaceLayout(
      once as unknown as Record<string, unknown>,
    );
    expect(twice).toEqual(once);
  });
});

// ─── Prototype pollution defense ─────────────────────────────────────

describe("prototype pollution defense", () => {
  it("rejects __proto__ keys in tab data", () => {
    const polluted = JSON.parse(
      '{"__proto__": {"polluted": true}, "id": "x", "title": "t", "type": "terminal", "sessionId": "s"}',
    );
    const result = stripToValidFields(polluted);
    expect((result as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("rejects constructor key", () => {
    const tab = {
      constructor: "evil",
      id: "x",
      title: "t",
      type: "terminal",
      sessionId: "s",
    };
    const result = stripToValidFields(tab as Record<string, unknown>);
    expect(result).not.toHaveProperty("constructor");
    expect(result.id).toBe("x");
  });

  it("rejects prototype key", () => {
    const tab = {
      prototype: { evil: true },
      id: "x",
      title: "t",
      type: "terminal",
      sessionId: "s",
    };
    const result = stripToValidFields(tab as Record<string, unknown>);
    expect(result).not.toHaveProperty("prototype");
    expect(result.id).toBe("x");
  });
});

// ─── All decommissioned types filtered ───────────────────────────────

describe("all decommissioned types from epic #86 are filtered", () => {
  const removedTypes = [
    "keys",
    "quick-connect",
    "session-manager",
    "ping",
    "config-diff",
    "interface-status",
    "mac-arp-viewer",
    "chatview",
    "compliance",
    "forwarding",
    "backup",
    "ssh",
    "vault",
    "sftp",
    "serial",
    "telnet",
    // Removed in templates+history decommission (this PR)
    "history",
    "templates",
  ];

  for (const removedType of removedTypes) {
    it(`filters out "${removedType}" tabs`, () => {
      const region = {
        id: "r1",
        tabs: [
          { id: "t1", title: "Removed", type: removedType, sessionId: "s1" },
          { id: "t2", title: "Terminal", type: "terminal", sessionId: "s2" },
        ],
        activeTabId: "t1",
        tabPosition: "top",
      };
      const result = migrateRegion(region);
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].type).toBe("terminal");
    });
  }
});

// ─── clearRemovedFeatureStorage ──────────────────────────────────────

describe("clearRemovedFeatureStorage", () => {
  /**
   * In-memory Storage shim. Returns the same object exposed by `localStorage`
   * so tests can inspect what keys were touched without polluting the real DOM.
   */
  function makeStorage(initial: Record<string, string> = {}) {
    const data = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      removeItem: (k: string) => {
        data.delete(k);
      },
      _data: data,
    };
  }

  it("REMOVED_FEATURE_STORAGE_KEYS includes the templates and history keys", () => {
    expect(REMOVED_FEATURE_STORAGE_KEYS).toContain("putz-history");
    expect(REMOVED_FEATURE_STORAGE_KEYS).toContain("putz-templates");
  });

  it("removes only the keys belonging to decommissioned features", () => {
    const storage = makeStorage({
      "putz-history": '{"entries":[]}',
      "putz-templates": '{"templates":[]}',
      "putz-bookmarks": '{"keep":true}',
      "putz-settings": '{"keep":true}',
    });
    const removed = clearRemovedFeatureStorage(storage);
    expect(removed).toEqual(
      expect.arrayContaining(["putz-history", "putz-templates"]),
    );
    expect(storage._data.has("putz-history")).toBe(false);
    expect(storage._data.has("putz-templates")).toBe(false);
    expect(storage._data.has("putz-bookmarks")).toBe(true);
    expect(storage._data.has("putz-settings")).toBe(true);
  });

  it("is idempotent — second call removes nothing", () => {
    const storage = makeStorage({ "putz-history": "x" });
    expect(clearRemovedFeatureStorage(storage)).toEqual(["putz-history"]);
    expect(clearRemovedFeatureStorage(storage)).toEqual([]);
  });

  it("returns [] when no removed keys are present", () => {
    const storage = makeStorage({ "putz-bookmarks": "x" });
    expect(clearRemovedFeatureStorage(storage)).toEqual([]);
  });

  it("returns [] and does not throw when storage is null", () => {
    expect(clearRemovedFeatureStorage(null)).toEqual([]);
  });

  it("does not throw when storage.getItem throws (hostile shim)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("boom");
      },
      removeItem: () => {},
    };
    expect(() => clearRemovedFeatureStorage(hostile)).not.toThrow();
    expect(clearRemovedFeatureStorage(hostile)).toEqual([]);
  });
});

// ─── Schema v2: legacy template/history tabs are filtered ────────────

describe("schema v2 — templates/history legacy tab filtering", () => {
  it("strips legacy 'history' tabs from a persisted region", () => {
    const region = {
      id: "r1",
      tabs: [
        { id: "h1", title: "History", type: "history", sessionId: "s1" },
        { id: "t1", title: "Terminal", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "h1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs.map((t) => t.type)).toEqual(["terminal"]);
    expect(result.activeTabId).toBe("t1"); // promoted from removed h1
  });

  it("strips legacy 'templates' tabs from a persisted region", () => {
    const region = {
      id: "r1",
      tabs: [
        {
          id: "tpl1",
          title: "Templates",
          type: "templates",
          sessionId: "s1",
        },
      ],
      activeTabId: "tpl1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(0);
    expect(result.activeTabId).toBe("");
  });

  it("workspace layout migration drops template+history tabs across regions", () => {
    const raw = {
      layout: { type: "region", regionId: "r1" },
      regions: {
        r1: {
          id: "r1",
          tabs: [
            { id: "h1", title: "History", type: "history", sessionId: "s1" },
            {
              id: "tpl1",
              title: "Templates",
              type: "templates",
              sessionId: "s2",
            },
            { id: "t1", title: "Terminal", type: "terminal", sessionId: "s3" },
          ],
          activeTabId: "h1",
          tabPosition: "top",
        },
      },
      focusedRegionId: "r1",
      schemaVersion: 1,
    };
    const result = migrateWorkspaceLayout(raw);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result!.regions.r1.tabs.map((t) => t.type)).toEqual(["terminal"]);
  });
});

// ─── RegionTab shape validation (#3) ─────────────────────────────────

describe("isValidRegionTabShape", () => {
  it("accepts a fully-formed terminal tab", () => {
    const tab = {
      id: "t1",
      title: "Terminal",
      type: "terminal",
      sessionId: "sess-1",
    } as unknown as Parameters<typeof isValidRegionTabShape>[0];
    expect(isValidRegionTabShape(tab)).toBe(true);
  });

  it("rejects a tab missing id", () => {
    const tab = {
      title: "Terminal",
      type: "terminal",
      sessionId: "sess-1",
    } as unknown as Parameters<typeof isValidRegionTabShape>[0];
    expect(isValidRegionTabShape(tab)).toBe(false);
  });

  it("rejects a tab with empty-string id", () => {
    const tab = {
      id: "",
      title: "T",
      type: "terminal",
      sessionId: "s",
    } as unknown as Parameters<typeof isValidRegionTabShape>[0];
    expect(isValidRegionTabShape(tab)).toBe(false);
  });

  it("rejects a tab with non-string sessionId", () => {
    const tab = {
      id: "t1",
      title: "T",
      type: "terminal",
      sessionId: 42,
    } as unknown as Parameters<typeof isValidRegionTabShape>[0];
    expect(isValidRegionTabShape(tab)).toBe(false);
  });

  it("rejects a tab with missing title", () => {
    const tab = {
      id: "t1",
      type: "terminal",
      sessionId: "s",
    } as unknown as Parameters<typeof isValidRegionTabShape>[0];
    expect(isValidRegionTabShape(tab)).toBe(false);
  });
});

describe("migrateRegion — shape validation drops malformed tabs", () => {
  it("drops a terminal tab missing id, keeps valid tabs", () => {
    const region = {
      id: "r1",
      tabs: [
        // Missing id — must be dropped
        { title: "Bad", type: "terminal", sessionId: "s1" },
        // Valid
        { id: "t2", title: "Good", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t2",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe("t2");
  });

  it("drops a tab whose sessionId is non-string", () => {
    const region = {
      id: "r1",
      tabs: [
        { id: "t1", title: "Bad", type: "terminal", sessionId: 99 },
        { id: "t2", title: "Good", type: "terminal", sessionId: "s2" },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs.map((t) => t.id)).toEqual(["t2"]);
    // activeTabId pointed to a dropped tab → falls through to first surviving
    expect(result.activeTabId).toBe("t2");
  });

  it("normalizes invalid tabPosition (e.g. 'diagonal') to default 'top'", () => {
    const region = {
      id: "r1",
      tabs: [{ id: "t1", title: "T", type: "terminal", sessionId: "s1" }],
      activeTabId: "t1",
      tabPosition: "diagonal",
    };
    const result = migrateRegion(region);
    expect(result.tabPosition).toBe("top");
  });

  it("preserves valid non-default tabPosition values", () => {
    for (const pos of ["bottom", "left", "right", "top"] as const) {
      const region = {
        id: "r1",
        tabs: [{ id: "t1", title: "T", type: "terminal", sessionId: "s1" }],
        activeTabId: "t1",
        tabPosition: pos,
      };
      expect(migrateRegion(region).tabPosition).toBe(pos);
    }
  });

  it("logs the count of dropped invalid tabs (not the contents — privacy)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const region = {
      id: "r1",
      tabs: [
        { id: "t1", title: "Good", type: "terminal", sessionId: "s1" },
        // Missing id
        { title: "Bad1", type: "terminal", sessionId: "s2" },
        // Missing title
        { id: "t3", type: "terminal", sessionId: "s3" },
      ],
      activeTabId: "t1",
      tabPosition: "top",
    };
    const result = migrateRegion(region);
    expect(result.tabs).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("dropped 2 tab(s)");
    // Privacy: must not include sessionId / title contents
    expect(message).not.toContain("s2");
    expect(message).not.toContain("s3");
    expect(message).not.toContain("Bad1");
    warn.mockRestore();
  });
});

// ─── clearRemovedFeatureStorage — read-failure independence (#2) ─────

describe("clearRemovedFeatureStorage — removeItem is independent of getItem", () => {
  it("still calls removeItem when getItem throws (hostile shim)", () => {
    const removed: string[] = [];
    const hostile = {
      getItem: () => {
        throw new Error("read denied");
      },
      removeItem: (k: string) => {
        removed.push(k);
      },
    };
    const result = clearRemovedFeatureStorage(hostile);
    // Returned array is empty because we couldn't confirm presence,
    // BUT removeItem was attempted on every key — that's the privacy contract.
    expect(result).toEqual([]);
    for (const key of REMOVED_FEATURE_STORAGE_KEYS) {
      expect(removed).toContain(key);
    }
  });

  it("does not crash when removeItem throws", () => {
    const hostile = {
      getItem: () => "x",
      removeItem: () => {
        throw new Error("write denied");
      },
    };
    expect(() => clearRemovedFeatureStorage(hostile)).not.toThrow();
  });

  it("does not crash when both getItem and removeItem throw", () => {
    const hostile = {
      getItem: () => {
        throw new Error("read denied");
      },
      removeItem: () => {
        throw new Error("write denied");
      },
    };
    expect(() => clearRemovedFeatureStorage(hostile)).not.toThrow();
    expect(clearRemovedFeatureStorage(hostile)).toEqual([]);
  });

  it("returns the keys whose presence was confirmed before removal", () => {
    const data = new Map<string, string>([
      ["putz-history", '{"x":1}'],
      ["putz-templates", '{"y":2}'],
    ]);
    const storage = {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
    const removed = clearRemovedFeatureStorage(storage);
    expect(removed).toContain("putz-history");
    expect(removed).toContain("putz-templates");
  });
});
