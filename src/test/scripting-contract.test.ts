/**
 * Contract tests for the Scripting IPC layer.
 *
 * Verifies that scriptApi.ts functions call the correct Tauri commands
 * with the expected parameters and return types.
 *
 * Tags: [TDD], [CONTRACT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  scriptList,
  scriptGet,
  scriptSave,
  scriptDelete,
  scriptRun,
  scriptRunMulti,
  scriptStatus,
  scriptStop,
  scriptRecordStart,
  scriptRecordStop,
} from "../components/Scripting/scriptApi";

import type {
  ScriptMeta,
  ScriptWithContent,
  ScriptRunResult,
} from "../components/Scripting/types";

describe("Scripting API contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ─── script_list ────────────────────────────────────────────

  it("scriptList calls script_list with no params", async () => {
    const mockScripts: ScriptMeta[] = [
      {
        id: "s1",
        name: "Test",
        description: "",
        filename: "test.js",
        isLoginScript: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockInvoke.mockResolvedValue(mockScripts);

    const result = await scriptList();
    expect(mockInvoke).toHaveBeenCalledWith("script_list");
    expect(result).toEqual(mockScripts);
  });

  // ─── script_get ─────────────────────────────────────────────

  it("scriptGet calls script_get with id", async () => {
    const mockScript: ScriptWithContent = {
      meta: {
        id: "s1",
        name: "Test",
        description: "",
        filename: "test.js",
        isLoginScript: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      content: "send('test');",
    };
    mockInvoke.mockResolvedValue(mockScript);

    const result = await scriptGet("s1");
    expect(mockInvoke).toHaveBeenCalledWith("script_get", { id: "s1" });
    expect(result).toEqual(mockScript);
  });

  // ─── script_save ────────────────────────────────────────────

  it("scriptSave calls script_save with input", async () => {
    mockInvoke.mockResolvedValue("new-id");

    const input = {
      name: "New Script",
      content: "send('hello');",
    };
    const result = await scriptSave(input);

    expect(mockInvoke).toHaveBeenCalledWith("script_save", { input });
    expect(result).toBe("new-id");
  });

  it("scriptSave passes optional fields", async () => {
    mockInvoke.mockResolvedValue("update-id");

    const input = {
      id: "existing-id",
      name: "Updated Script",
      description: "Updated description",
      content: "send('updated');",
      isLoginScript: true,
    };
    const result = await scriptSave(input);

    expect(mockInvoke).toHaveBeenCalledWith("script_save", { input });
    expect(result).toBe("update-id");
  });

  // ─── script_delete ──────────────────────────────────────────

  it("scriptDelete calls script_delete with id", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await scriptDelete("s1");
    expect(mockInvoke).toHaveBeenCalledWith("script_delete", { id: "s1" });
  });

  // ─── script_run ─────────────────────────────────────────────

  it("scriptRun calls script_run with input", async () => {
    mockInvoke.mockResolvedValue("run-123");

    const input = { scriptId: "s1", sessionId: "sess-1" };
    const result = await scriptRun(input);

    expect(mockInvoke).toHaveBeenCalledWith("script_run", { input });
    expect(result).toBe("run-123");
  });

  // ─── script_run_multi ───────────────────────────────────────

  it("scriptRunMulti calls script_run_multi with input", async () => {
    mockInvoke.mockResolvedValue(["run-1", "run-2"]);

    const input = { scriptId: "s1", sessionIds: ["sess-1", "sess-2"] };
    const result = await scriptRunMulti(input);

    expect(mockInvoke).toHaveBeenCalledWith("script_run_multi", { input });
    expect(result).toEqual(["run-1", "run-2"]);
  });

  // ─── script_status ──────────────────────────────────────────

  it("scriptStatus calls script_status with runId", async () => {
    const mockResult: ScriptRunResult = {
      runId: "run-123",
      scriptId: "s1",
      sessionId: "sess-1",
      status: "completed",
      output: [],
      startedAt: "2024-01-01T00:00:00Z",
      finishedAt: "2024-01-01T00:01:00Z",
      error: null,
    };
    mockInvoke.mockResolvedValue(mockResult);

    const result = await scriptStatus("run-123");
    expect(mockInvoke).toHaveBeenCalledWith("script_status", {
      runId: "run-123",
    });
    expect(result).toEqual(mockResult);
  });

  // ─── script_stop ────────────────────────────────────────────

  it("scriptStop calls script_stop with runId", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await scriptStop("run-123");
    expect(mockInvoke).toHaveBeenCalledWith("script_stop", {
      runId: "run-123",
    });
  });

  // ─── script_record_start ────────────────────────────────────

  it("scriptRecordStart calls script_record_start with sessionId", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await scriptRecordStart("sess-1");
    expect(mockInvoke).toHaveBeenCalledWith("script_record_start", {
      sessionId: "sess-1",
    });
  });

  // ─── script_record_stop ─────────────────────────────────────

  it("scriptRecordStop calls script_record_stop with sessionId", async () => {
    mockInvoke.mockResolvedValue('send("show version\\r\\n");');

    const result = await scriptRecordStop("sess-1");
    expect(mockInvoke).toHaveBeenCalledWith("script_record_stop", {
      sessionId: "sess-1",
    });
    expect(result).toBe('send("show version\\r\\n");');
  });

  // ─── Error handling ─────────────────────────────────────────

  it("rejects with error message from backend", async () => {
    mockInvoke.mockRejectedValue("Script not found");

    await expect(scriptGet("nonexistent")).rejects.toBe("Script not found");
  });
});
