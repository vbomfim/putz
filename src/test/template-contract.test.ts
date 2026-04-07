/**
 * Contract tests for the template IPC layer.
 *
 * Verifies that templateApi.ts calls invoke with the correct
 * command names and argument shapes matching the Rust backend.
 *
 * Tags: [TDD], [AC-6] Command Templates
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  templateList,
  templateGet,
  templateCreate,
  templateDelete,
  templateExecute,
} from "../components/Templates/templateApi";

describe("Template IPC contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("templateList calls invoke('template_list')", async () => {
    mockInvoke.mockResolvedValue([]);
    await templateList();
    expect(mockInvoke).toHaveBeenCalledWith("template_list");
  });

  it("templateGet calls invoke('template_get', { id })", async () => {
    mockInvoke.mockResolvedValue({ meta: {}, content: "", variables: [] });
    await templateGet("abc-123");
    expect(mockInvoke).toHaveBeenCalledWith("template_get", { id: "abc-123" });
  });

  it("templateCreate calls invoke('template_create', { input })", async () => {
    mockInvoke.mockResolvedValue("new-id");
    const input = { name: "Test", content: "show version" };
    await templateCreate(input);
    expect(mockInvoke).toHaveBeenCalledWith("template_create", { input });
  });

  it("templateDelete calls invoke('template_delete', { id })", async () => {
    await templateDelete("abc-123");
    expect(mockInvoke).toHaveBeenCalledWith("template_delete", { id: "abc-123" });
  });

  it("templateExecute calls invoke('template_execute', { input })", async () => {
    mockInvoke.mockResolvedValue("rendered text");
    const input = {
      templateId: "t1",
      variables: { hostname: "R1" },
    };
    await templateExecute(input);
    expect(mockInvoke).toHaveBeenCalledWith("template_execute", { input });
  });
});
