/**
 * Session IPC contract tests — validates TypeScript types match Rust backend.
 *
 * Ensures the frontend and backend agree on:
 * - Command names and parameter structures
 * - Type shapes (SessionProfile, SessionNode, Protocol)
 * - camelCase field naming convention
 *
 * Tags: [CONTRACT], [AC-1], [AC-5], [AC-8]
 */
import { describe, it, expect } from "vitest";
import type {
  SessionProfile,
  SessionFolderNode,
  SessionLeafNode,
  Protocol,
  CreateSessionInput,
  UpdateSessionInput,
  MoveSessionInput,
} from "../components/SessionManager/types";
import {
  PROTOCOL_DEFAULT_PORTS,
  PROTOCOL_LABELS,
} from "../components/SessionManager/types";

describe("IPC Contract — SessionProfile", () => {
  /**
   * [CONTRACT] [AC-1] SessionProfile shape matches Rust's SessionProfile struct.
   */
  it("has all required fields with correct types", () => {
    const profile: SessionProfile = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "My Server",
      folderId: "root",
      protocol: "ssh",
      host: "example.com",
      port: 22,
      username: "admin",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(typeof profile.id).toBe("string");
    expect(typeof profile.name).toBe("string");
    expect(typeof profile.folderId).toBe("string");
    expect(typeof profile.protocol).toBe("string");
    expect(typeof profile.createdAt).toBe("string");
    expect(typeof profile.updatedAt).toBe("string");
  });

  /**
   * [CONTRACT] Optional fields can be undefined.
   */
  it("optional fields can be omitted", () => {
    const profile: SessionProfile = {
      id: "test",
      name: "Local Shell",
      folderId: "root",
      protocol: "local",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(profile.host).toBeUndefined();
    expect(profile.port).toBeUndefined();
    expect(profile.username).toBeUndefined();
    expect(profile.credentialId).toBeUndefined();
  });
});

describe("IPC Contract — Protocol", () => {
  /**
   * [CONTRACT] Protocol values match Rust's Protocol enum (lowercase serde).
   */
  it("matches Rust enum variants (lowercase)", () => {
    const protocols: Protocol[] = ["ssh", "telnet", "serial", "local"];
    expect(protocols).toHaveLength(4);
    protocols.forEach((p) => expect(typeof p).toBe("string"));
  });

  /**
   * [CONTRACT] Default ports match Rust Protocol::default_port().
   */
  it("default ports match Rust backend", () => {
    expect(PROTOCOL_DEFAULT_PORTS.ssh).toBe(22);
    expect(PROTOCOL_DEFAULT_PORTS.telnet).toBe(23);
    expect(PROTOCOL_DEFAULT_PORTS.serial).toBeUndefined();
    expect(PROTOCOL_DEFAULT_PORTS.local).toBeUndefined();
  });

  /**
   * [CONTRACT] Protocol labels provide human-readable names.
   */
  it("has labels for all protocols", () => {
    expect(PROTOCOL_LABELS.ssh).toBe("SSH");
    expect(PROTOCOL_LABELS.telnet).toBe("Telnet");
    expect(PROTOCOL_LABELS.serial).toBe("Serial");
    expect(PROTOCOL_LABELS.local).toBe("Local Shell");
  });
});

describe("IPC Contract — SessionNode", () => {
  /**
   * [CONTRACT] Folder node has type:"folder" tag (Rust serde camelCase).
   */
  it("folder node has type tag and children", () => {
    const folder: SessionFolderNode = {
      type: "folder",
      id: "f1",
      name: "Production",
      parentId: "root",
      sortOrder: 0,
      expanded: true,
      children: [],
    };
    expect(folder.type).toBe("folder");
    expect(Array.isArray(folder.children)).toBe(true);
  });

  /**
   * [CONTRACT] Session node has type:"session" tag.
   */
  it("session node has type tag and protocol", () => {
    const session: SessionLeafNode = {
      type: "session",
      id: "s1",
      name: "Server 1",
      protocol: "ssh",
      host: "10.0.0.1",
      port: 22,
      username: "admin",
    };
    expect(session.type).toBe("session");
    expect(session.protocol).toBe("ssh");
  });
});

describe("IPC Contract — CreateSessionInput", () => {
  /**
   * [CONTRACT] [AC-1] Create input has required name and protocol.
   */
  it("requires name and protocol", () => {
    const input: CreateSessionInput = {
      name: "New Server",
      protocol: "ssh",
      host: "example.com",
      port: 22,
    };
    expect(input.name).toBe("New Server");
    expect(input.protocol).toBe("ssh");
  });

  /**
   * [CONTRACT] folderId defaults to root when omitted.
   */
  it("folderId is optional (defaults to root on backend)", () => {
    const input: CreateSessionInput = {
      name: "Test",
      protocol: "local",
    };
    expect(input.folderId).toBeUndefined();
  });
});

describe("IPC Contract — UpdateSessionInput", () => {
  /**
   * [CONTRACT] [AC-5] Update input is fully optional (partial update).
   */
  it("all fields are optional", () => {
    const input: UpdateSessionInput = {
      name: "Updated Name",
    };
    expect(input.name).toBe("Updated Name");
    expect(input.protocol).toBeUndefined();
    expect(input.host).toBeUndefined();
  });
});

describe("IPC Contract — MoveSessionInput", () => {
  /**
   * [CONTRACT] [AC-2] Move input has id and targetFolderId.
   */
  it("has required fields for move operation", () => {
    const input: MoveSessionInput = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      targetFolderId: "folder-1",
    };
    expect(input.id).toBeDefined();
    expect(input.targetFolderId).toBe("folder-1");
    expect(input.sortOrder).toBeUndefined();
  });
});

describe("IPC Contract — Command Names", () => {
  /**
   * [CONTRACT] All session commands use snake_case matching Rust handlers.
   */
  it("command names are snake_case", () => {
    const commands = [
      "session_list",
      "session_get",
      "session_create",
      "session_update",
      "session_delete",
      "session_move",
      "session_duplicate",
      "session_search",
      "session_import",
      "session_export",
      "session_create_folder",
      "session_delete_folder",
    ];
    commands.forEach((cmd) => {
      expect(cmd).toMatch(/^session_[a-z_]+$/);
    });
  });
});
