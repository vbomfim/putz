/**
 * Extended contract tests for the Session Manager IPC layer.
 *
 * These tests validate the sessionApi module's contract with the Rust backend:
 * - Every API function calls the correct IPC command with the correct arguments
 * - Error responses are propagated correctly
 * - Data shapes match the expected Rust backend contract
 * - Import/export data round-trip integrity
 *
 * Tags: [CONTRACT], [AC-1] through [AC-9]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Tauri IPC ─────────────────────────────────────────────────
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Import after mocking
import * as api from "../components/SessionManager/sessionApi";
import type {
  SessionProfile,
  SessionNode,
  CreateSessionInput,
  UpdateSessionInput,
  MoveSessionInput,
} from "../components/SessionManager/types";
import { PROTOCOL_DEFAULT_PORTS } from "../components/SessionManager/types";

// ─── Test Data ──────────────────────────────────────────────────────

const mockProfile: SessionProfile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Test Server",
  folderId: "root",
  protocol: "ssh",
  host: "10.0.0.1",
  port: 22,
  username: "admin",
  createdAt: "2024-01-15T10:30:00Z",
  updatedAt: "2024-06-20T14:45:00Z",
};

const mockTree: SessionNode[] = [
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
        name: "Router",
        protocol: "ssh",
        host: "10.0.0.1",
        port: 22,
        username: "admin",
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
//  sessionApi → IPC Command Mapping
// ═══════════════════════════════════════════════════════════════════

describe("sessionApi — IPC Command Contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ── session_list ──────────────────────────────────────────────

  it("[CONTRACT] sessionList calls 'session_list' with no args", async () => {
    mockInvoke.mockResolvedValue(mockTree);

    const result = await api.sessionList();

    expect(mockInvoke).toHaveBeenCalledWith("session_list");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockTree);
  });

  // ── session_get ───────────────────────────────────────────────

  it("[CONTRACT] sessionGet calls 'session_get' with { id }", async () => {
    mockInvoke.mockResolvedValue(mockProfile);

    const result = await api.sessionGet("abc-123");

    expect(mockInvoke).toHaveBeenCalledWith("session_get", { id: "abc-123" });
    expect(result).toEqual(mockProfile);
  });

  // ── session_create ────────────────────────────────────────────

  it("[CONTRACT] [AC-1] sessionCreate calls 'session_create' with { input }", async () => {
    mockInvoke.mockResolvedValue("new-uuid");

    const input: CreateSessionInput = {
      name: "New Server",
      protocol: "ssh",
      host: "192.168.1.1",
      port: 22,
      username: "admin",
      folderId: "folder-1",
    };

    const result = await api.sessionCreate(input);

    expect(mockInvoke).toHaveBeenCalledWith("session_create", { input });
    expect(result).toBe("new-uuid");
  });

  // ── session_update ────────────────────────────────────────────

  it("[CONTRACT] [AC-5] sessionUpdate calls 'session_update' with { id, input }", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const input: UpdateSessionInput = {
      name: "Updated Name",
      port: 2222,
    };

    await api.sessionUpdate("sess-001", input);

    expect(mockInvoke).toHaveBeenCalledWith("session_update", {
      id: "sess-001",
      input,
    });
  });

  // ── session_delete ────────────────────────────────────────────

  it("[CONTRACT] [AC-7] sessionDelete calls 'session_delete' with { id }", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await api.sessionDelete("sess-001");

    expect(mockInvoke).toHaveBeenCalledWith("session_delete", { id: "sess-001" });
  });

  // ── session_move ──────────────────────────────────────────────

  it("[CONTRACT] [AC-2] sessionMove calls 'session_move' with { input }", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const input: MoveSessionInput = {
      id: "sess-001",
      targetFolderId: "folder-2",
      sortOrder: 3,
    };

    await api.sessionMove(input);

    expect(mockInvoke).toHaveBeenCalledWith("session_move", { input });
  });

  // ── session_duplicate ─────────────────────────────────────────

  it("[CONTRACT] [AC-6] sessionDuplicate calls 'session_duplicate' with { id }", async () => {
    mockInvoke.mockResolvedValue("dup-uuid");

    const result = await api.sessionDuplicate("sess-001");

    expect(mockInvoke).toHaveBeenCalledWith("session_duplicate", { id: "sess-001" });
    expect(result).toBe("dup-uuid");
  });

  // ── session_search ────────────────────────────────────────────

  it("[CONTRACT] [AC-3] sessionSearch calls 'session_search' with { query }", async () => {
    mockInvoke.mockResolvedValue([mockProfile]);

    const result = await api.sessionSearch("core-rtr");

    expect(mockInvoke).toHaveBeenCalledWith("session_search", { query: "core-rtr" });
    expect(result).toEqual([mockProfile]);
  });

  // ── session_export ────────────────────────────────────────────

  it("[CONTRACT] [AC-8] sessionExport calls 'session_export' with no args", async () => {
    const exportData = '{"version":1,"sessions":[],"folders":[]}';
    mockInvoke.mockResolvedValue(exportData);

    const result = await api.sessionExport();

    expect(mockInvoke).toHaveBeenCalledWith("session_export");
    expect(result).toBe(exportData);
  });

  // ── session_import ────────────────────────────────────────────

  it("[CONTRACT] [AC-8] sessionImport calls 'session_import' with { data }", async () => {
    mockInvoke.mockResolvedValue(5);

    const data = '{"version":1,"sessions":[...],"folders":[]}';
    const result = await api.sessionImport(data);

    expect(mockInvoke).toHaveBeenCalledWith("session_import", { data });
    expect(result).toBe(5);
  });

  // ── session_create_folder ─────────────────────────────────────

  it("[CONTRACT] [AC-2] sessionCreateFolder calls 'session_create_folder' with { name, parentId }", async () => {
    mockInvoke.mockResolvedValue("new-folder-id");

    const result = await api.sessionCreateFolder("DC Servers", "root");

    expect(mockInvoke).toHaveBeenCalledWith("session_create_folder", {
      name: "DC Servers",
      parentId: "root",
    });
    expect(result).toBe("new-folder-id");
  });

  // ── session_delete_folder ─────────────────────────────────────

  it("[CONTRACT] sessionDeleteFolder calls 'session_delete_folder' with { id }", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await api.sessionDeleteFolder("folder-old");

    expect(mockInvoke).toHaveBeenCalledWith("session_delete_folder", {
      id: "folder-old",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Error Propagation Contract
// ═══════════════════════════════════════════════════════════════════

describe("sessionApi — Error Propagation Contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("[CONTRACT] sessionGet rejects when backend returns error", async () => {
    mockInvoke.mockRejectedValue("Session not found: invalid-id");

    await expect(api.sessionGet("invalid-id")).rejects.toBe(
      "Session not found: invalid-id",
    );
  });

  it("[CONTRACT] sessionCreate rejects on validation error", async () => {
    mockInvoke.mockRejectedValue("Invalid input: name is empty");

    const input: CreateSessionInput = {
      name: "",
      protocol: "ssh",
    };

    await expect(api.sessionCreate(input)).rejects.toBe(
      "Invalid input: name is empty",
    );
  });

  it("[CONTRACT] sessionDelete rejects when session not found", async () => {
    mockInvoke.mockRejectedValue("Session not found: nonexistent");

    await expect(api.sessionDelete("nonexistent")).rejects.toBe(
      "Session not found: nonexistent",
    );
  });

  it("[CONTRACT] sessionDeleteFolder rejects when folder not empty", async () => {
    mockInvoke.mockRejectedValue("Folder not empty: folder-1");

    await expect(api.sessionDeleteFolder("folder-1")).rejects.toBe(
      "Folder not empty: folder-1",
    );
  });

  it("[CONTRACT] sessionImport rejects on malformed JSON", async () => {
    mockInvoke.mockRejectedValue("Parse error: expected '{' at line 1");

    await expect(api.sessionImport("not-json")).rejects.toBe(
      "Parse error: expected '{' at line 1",
    );
  });

  it("[CONTRACT] sessionMove rejects when target folder not found", async () => {
    mockInvoke.mockRejectedValue("Folder not found: nonexistent-folder");

    const input: MoveSessionInput = {
      id: "sess-001",
      targetFolderId: "nonexistent-folder",
    };

    await expect(api.sessionMove(input)).rejects.toBe(
      "Folder not found: nonexistent-folder",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Data Shape Contract — validates TypeScript types survive round-trip
// ═══════════════════════════════════════════════════════════════════

describe("Data Shape Contract — Round-Trip Integrity", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("[CONTRACT] SessionProfile preserves all fields through get", async () => {
    const fullProfile: SessionProfile = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Full Profile Test",
      folderId: "folder-1",
      protocol: "ssh",
      host: "10.0.0.1",
      port: 2222,
      username: "netadmin",
      credentialId: "cred-vault-001",
      serialPort: undefined,
      serialBaud: undefined,
      colorScheme: "dracula",
      autoLog: true,
      jumpHostId: "jump-host-001",
      createdAt: "2024-01-15T10:30:00Z",
      updatedAt: "2024-06-20T14:45:00Z",
    };

    mockInvoke.mockResolvedValue(fullProfile);
    const result = await api.sessionGet(fullProfile.id);

    // Every field should survive the round-trip
    expect(result.id).toBe(fullProfile.id);
    expect(result.name).toBe(fullProfile.name);
    expect(result.folderId).toBe(fullProfile.folderId);
    expect(result.protocol).toBe(fullProfile.protocol);
    expect(result.host).toBe(fullProfile.host);
    expect(result.port).toBe(fullProfile.port);
    expect(result.username).toBe(fullProfile.username);
    expect(result.credentialId).toBe(fullProfile.credentialId);
    expect(result.colorScheme).toBe(fullProfile.colorScheme);
    expect(result.autoLog).toBe(fullProfile.autoLog);
    expect(result.jumpHostId).toBe(fullProfile.jumpHostId);
    expect(result.createdAt).toBe(fullProfile.createdAt);
    expect(result.updatedAt).toBe(fullProfile.updatedAt);
  });

  it("[CONTRACT] SessionNode tree structure is recursive", async () => {
    const nestedTree: SessionNode[] = [
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
            expanded: false,
            children: [
              {
                type: "session",
                id: "s1",
                name: "Deep Session",
                protocol: "ssh",
                host: "10.0.0.1",
                port: 22,
              },
            ],
          },
        ],
      },
    ];

    mockInvoke.mockResolvedValue(nestedTree);
    const result = await api.sessionList();

    // Verify recursive structure
    expect(result[0].type).toBe("folder");
    const folder1 = result[0] as SessionNode & { type: "folder"; children: SessionNode[] };
    expect(folder1.children[0].type).toBe("folder");
    const folder2 = folder1.children[0] as SessionNode & { type: "folder"; children: SessionNode[] };
    expect(folder2.children[0].type).toBe("session");
    expect(folder2.children[0].name).toBe("Deep Session");
  });

  it("[CONTRACT] export/import JSON includes version field", async () => {
    const exportedData = JSON.stringify({
      version: 1,
      sessions: [
        {
          id: "s1",
          name: "Test",
          folderId: "root",
          protocol: "ssh",
          host: "10.0.0.1",
          port: 22,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
      folders: [],
    });

    mockInvoke.mockResolvedValue(exportedData);
    const result = await api.sessionExport();

    const parsed = JSON.parse(result);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(Array.isArray(parsed.folders)).toBe(true);
  });

  it("[CONTRACT] protocol default ports are exhaustive", () => {
    // Every valid protocol should have an entry in PROTOCOL_DEFAULT_PORTS
    const protocols = ["ssh", "telnet", "serial", "local"] as const;
    for (const p of protocols) {
      expect(p in PROTOCOL_DEFAULT_PORTS).toBe(true);
    }

    // SSH and Telnet have well-known ports
    expect(PROTOCOL_DEFAULT_PORTS.ssh).toBe(22);
    expect(PROTOCOL_DEFAULT_PORTS.telnet).toBe(23);

    // Serial and Local have no default port
    expect(PROTOCOL_DEFAULT_PORTS.serial).toBeUndefined();
    expect(PROTOCOL_DEFAULT_PORTS.local).toBeUndefined();
  });

  it("[CONTRACT] all 12 session commands are covered by sessionApi", () => {
    // Verify the API module exports all expected functions
    expect(typeof api.sessionList).toBe("function");
    expect(typeof api.sessionGet).toBe("function");
    expect(typeof api.sessionCreate).toBe("function");
    expect(typeof api.sessionUpdate).toBe("function");
    expect(typeof api.sessionDelete).toBe("function");
    expect(typeof api.sessionMove).toBe("function");
    expect(typeof api.sessionDuplicate).toBe("function");
    expect(typeof api.sessionSearch).toBe("function");
    expect(typeof api.sessionExport).toBe("function");
    expect(typeof api.sessionImport).toBe("function");
    expect(typeof api.sessionCreateFolder).toBe("function");
    expect(typeof api.sessionDeleteFolder).toBe("function");
  });

  it("[CONTRACT] CreateSessionInput can omit optional fields", async () => {
    mockInvoke.mockResolvedValue("new-id");

    const minimalInput: CreateSessionInput = {
      name: "Minimal",
      protocol: "local",
    };

    await api.sessionCreate(minimalInput);

    expect(mockInvoke).toHaveBeenCalledWith("session_create", {
      input: {
        name: "Minimal",
        protocol: "local",
      },
    });
  });

  it("[CONTRACT] UpdateSessionInput sends only changed fields", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const partialUpdate: UpdateSessionInput = {
      port: 8080,
    };

    await api.sessionUpdate("sess-001", partialUpdate);

    expect(mockInvoke).toHaveBeenCalledWith("session_update", {
      id: "sess-001",
      input: { port: 8080 },
    });
  });

  it("[CONTRACT] MoveSessionInput sortOrder is optional", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const moveWithoutSort: MoveSessionInput = {
      id: "sess-001",
      targetFolderId: "folder-2",
    };

    await api.sessionMove(moveWithoutSort);

    expect(mockInvoke).toHaveBeenCalledWith("session_move", {
      input: {
        id: "sess-001",
        targetFolderId: "folder-2",
      },
    });
  });
});
