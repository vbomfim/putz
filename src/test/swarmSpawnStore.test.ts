/**
 * Tests for `swarmSpawnStore` — `.putz/spawn.json` recipe loader.
 *
 * Covers (TDD):
 *  - refresh: reads via injected invoke, stores recipes
 *  - refresh: handles malformed file (error returned in result)
 *  - refresh: handles IPC failure (rejected promise)
 *  - clear: resets state
 *  - recipeFromFreeFormInput: parses, ignores blank, no shell expansion
 *  - toWireRecipe: round-trips correctly
 *
 * Tags: [TDD]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useSwarmSpawnStore,
  setSpawnStoreInvokeFn,
  recipeFromFreeFormInput,
  toWireRecipe,
  _resetSwarmSpawnStoreForTests,
} from "../stores/swarmSpawnStore";

beforeEach(() => {
  _resetSwarmSpawnStoreForTests();
});

describe("swarmSpawnStore — refresh", () => {
  it("loads valid recipes from the injected invoke", async () => {
    setSpawnStoreInvokeFn(
      vi.fn().mockResolvedValue({
        recipes: [
          {
            name: "review",
            command: "gh",
            args: ["copilot", "--mode", "review"],
            cwd: null,
            env: { REVIEW: "1" },
            initial_prompt: null,
          },
        ],
        error: null,
      }),
    );
    await useSwarmSpawnStore.getState().refresh("/work/root");
    const state = useSwarmSpawnStore.getState();
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.recipes).toHaveLength(1);
    expect(state.recipes[0].name).toBe("review");
    expect(state.recipes[0].args).toEqual(["copilot", "--mode", "review"]);
    expect(state.recipes[0].env).toEqual({ REVIEW: "1" });
    // snake_case → camelCase round-trip
    expect(state.recipes[0].initialPrompt).toBeNull();
  });

  it("propagates a structured error from the result without throwing", async () => {
    setSpawnStoreInvokeFn(
      vi.fn().mockResolvedValue({
        recipes: [],
        error: "JSON parse error: trailing comma at line 3",
      }),
    );
    await useSwarmSpawnStore.getState().refresh("/work/root");
    const state = useSwarmSpawnStore.getState();
    expect(state.recipes).toHaveLength(0);
    expect(state.error).toMatch(/JSON parse error/);
  });

  it("captures rejected invoke as a string error (no throw)", async () => {
    setSpawnStoreInvokeFn(
      vi.fn().mockRejectedValue(new Error("permission denied")),
    );
    await useSwarmSpawnStore.getState().refresh("/work/root");
    const state = useSwarmSpawnStore.getState();
    expect(state.error).toMatch(/permission denied/);
    expect(state.recipes).toHaveLength(0);
  });

  it("passes workspaceRoot to invoke as a snake_case-friendly key", async () => {
    const invoke = vi.fn().mockResolvedValue({ recipes: [], error: null });
    setSpawnStoreInvokeFn(invoke);
    await useSwarmSpawnStore.getState().refresh("/work/root");
    expect(invoke).toHaveBeenCalledWith("swarm_read_workspace_recipes", {
      workspaceRoot: "/work/root",
    });
  });

  it("clear resets recipes and error", async () => {
    setSpawnStoreInvokeFn(
      vi.fn().mockResolvedValue({
        recipes: [{ name: "x", command: "y" }],
        error: null,
      }),
    );
    await useSwarmSpawnStore.getState().refresh("/work");
    useSwarmSpawnStore.getState().clear();
    expect(useSwarmSpawnStore.getState().recipes).toHaveLength(0);
    expect(useSwarmSpawnStore.getState().error).toBeNull();
  });
});

describe("recipeFromFreeFormInput", () => {
  it("returns null for empty / whitespace-only input", () => {
    expect(recipeFromFreeFormInput("")).toBeNull();
    expect(recipeFromFreeFormInput("   ")).toBeNull();
  });

  it("splits on whitespace and uses the first token as command + name", () => {
    const r = recipeFromFreeFormInput("ls -la /tmp");
    expect(r).not.toBeNull();
    expect(r!.command).toBe("ls");
    expect(r!.name).toBe("ls");
    expect(r!.args).toEqual(["-la", "/tmp"]);
  });

  it("does not perform shell expansion of $vars or globs", () => {
    // We pass through verbatim — actual expansion (if any) happens
    // only inside the spawned PTY. The point is we don't pre-evaluate.
    const r = recipeFromFreeFormInput("echo $HOME");
    expect(r!.args).toEqual(["$HOME"]);
  });
});

describe("toWireRecipe", () => {
  it("converts camelCase back to snake_case for invoke", () => {
    const w = toWireRecipe({
      name: "x",
      command: "y",
      args: ["a"],
      cwd: "/p",
      env: { K: "V" },
      initialPrompt: "hi",
    });
    expect(w).toEqual({
      name: "x",
      command: "y",
      args: ["a"],
      cwd: "/p",
      env: { K: "V" },
      initial_prompt: "hi",
    });
  });

  it("fills defaults for absent optional fields", () => {
    const w = toWireRecipe({ name: "x", command: "y" });
    expect(w.args).toEqual([]);
    expect(w.env).toEqual({});
    expect(w.cwd).toBeNull();
    expect(w.initial_prompt).toBeNull();
  });
});
