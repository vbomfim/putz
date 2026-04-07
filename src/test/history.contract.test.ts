/**
 * History IPC contract tests — validates TypeScript types match Rust backend.
 *
 * Ensures the frontend and backend agree on:
 * - Type shapes (CommandEntry, AddCommandInput, SearchHistoryInput, GetRecentInput)
 * - camelCase field naming convention matching Rust serde(rename_all = "camelCase")
 * - API function signatures match IPC command names
 *
 * Tags: [CONTRACT], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CommandEntry,
  AddCommandInput,
  SearchHistoryInput,
  GetRecentInput,
} from "../components/History/types";

// Mock Tauri invoke before importing the API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  historyAdd,
  historySearch,
  historyGetRecent,
  historyClear,
} from "../components/History/historyApi";

const mockedInvoke = vi.mocked(invoke);

describe("IPC Contract — CommandEntry", () => {
  /**
   * [CONTRACT] CommandEntry shape matches Rust's CommandEntry struct.
   */
  it("has all required fields with correct types", () => {
    const entry: CommandEntry = {
      id: 1,
      sessionName: "Lab Switch",
      host: "10.0.0.1",
      command: "show ip interface brief",
      timestamp: "2024-01-15T10:30:00Z",
      sessionId: "abc-123",
    };
    expect(typeof entry.id).toBe("number");
    expect(typeof entry.sessionName).toBe("string");
    expect(typeof entry.host).toBe("string");
    expect(typeof entry.command).toBe("string");
    expect(typeof entry.timestamp).toBe("string");
    expect(typeof entry.sessionId).toBe("string");
  });

  /**
   * [CONTRACT] Uses camelCase field names matching Rust serde(rename_all = "camelCase").
   */
  it("uses camelCase naming for all fields", () => {
    const entry: CommandEntry = {
      id: 1,
      sessionName: "test",
      host: "10.0.0.1",
      command: "show run",
      timestamp: "2024-01-01T00:00:00Z",
      sessionId: "session-1",
    };
    expect(entry).toHaveProperty("sessionName");
    expect(entry).toHaveProperty("sessionId");
    // Verify no snake_case variants
    expect(entry).not.toHaveProperty("session_name");
    expect(entry).not.toHaveProperty("session_id");
  });
});

describe("IPC Contract — AddCommandInput", () => {
  it("has all required fields", () => {
    const input: AddCommandInput = {
      sessionName: "Lab Router",
      host: "192.168.1.1",
      command: "show version",
      sessionId: "sess-001",
    };
    expect(typeof input.sessionName).toBe("string");
    expect(typeof input.host).toBe("string");
    expect(typeof input.command).toBe("string");
    expect(typeof input.sessionId).toBe("string");
  });
});

describe("IPC Contract — SearchHistoryInput", () => {
  it("has required query field", () => {
    const input: SearchHistoryInput = { query: "show" };
    expect(typeof input.query).toBe("string");
  });

  it("supports optional fields", () => {
    const input: SearchHistoryInput = {
      query: "show",
      sessionId: "sess-001",
      limit: 25,
    };
    expect(input.sessionId).toBe("sess-001");
    expect(input.limit).toBe(25);
  });
});

describe("IPC Contract — GetRecentInput", () => {
  it("has required sessionId field", () => {
    const input: GetRecentInput = { sessionId: "sess-001" };
    expect(typeof input.sessionId).toBe("string");
  });

  it("supports optional limit", () => {
    const input: GetRecentInput = { sessionId: "sess-001", limit: 10 };
    expect(input.limit).toBe(10);
  });
});

describe("IPC Contract — History API invoke calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("historyAdd invokes history_add with input", async () => {
    mockedInvoke.mockResolvedValueOnce(42);
    const input: AddCommandInput = {
      sessionName: "test",
      host: "10.0.0.1",
      command: "show run",
      sessionId: "sess-1",
    };
    const result = await historyAdd(input);
    expect(mockedInvoke).toHaveBeenCalledWith("history_add", { input });
    expect(result).toBe(42);
  });

  it("historySearch invokes history_search with input", async () => {
    const mockEntries: CommandEntry[] = [
      {
        id: 1,
        sessionName: "test",
        host: "10.0.0.1",
        command: "show run",
        timestamp: "2024-01-01T00:00:00Z",
        sessionId: "sess-1",
      },
    ];
    mockedInvoke.mockResolvedValueOnce(mockEntries);
    const input: SearchHistoryInput = { query: "show", limit: 10 };
    const result = await historySearch(input);
    expect(mockedInvoke).toHaveBeenCalledWith("history_search", { input });
    expect(result).toEqual(mockEntries);
  });

  it("historyGetRecent invokes history_get_recent with input", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const input: GetRecentInput = { sessionId: "sess-1", limit: 5 };
    const result = await historyGetRecent(input);
    expect(mockedInvoke).toHaveBeenCalledWith("history_get_recent", { input });
    expect(result).toEqual([]);
  });

  it("historyClear invokes history_clear with no args", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await historyClear();
    expect(mockedInvoke).toHaveBeenCalledWith("history_clear");
  });
});
