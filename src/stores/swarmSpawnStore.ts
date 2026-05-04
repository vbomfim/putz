/**
 * Workspace `.putz/spawn.json` recipe store (T4 / FR-019).
 *
 * Loads recipes via the `swarm_read_workspace_recipes` Tauri command
 * and exposes them to the Cmd+K spawn palette. Recipes are loaded
 * fresh from disk on each `refresh()` — no localStorage caching, so
 * the user's edits to `.putz/spawn.json` take effect on the next
 * palette open without an app reload.
 *
 * **Component boundary (rewritability):** the store owns ONLY the
 * cached recipe list + load error. The `invoke` dependency is
 * injectable via `setInvokeFn` so component tests don't need to
 * mock `@tauri-apps/api/core` globally.
 *
 * @privacy Tier-2 — recipe `initial_prompt` carries user-authored
 * content. Loaded into memory only. The store never logs recipe
 * fields and never persists them.
 *
 * @module stores/swarmSpawnStore
 */
import { create } from "zustand";

/** Mirror of the Rust `SpawnRecipe` shape (`spawn_recipe.rs`). */
export interface SpawnRecipe {
  readonly name: string;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string | null;
  readonly env?: Readonly<Record<string, string>>;
  /** @privacy Tier-2 — see module doc. */
  readonly initialPrompt?: string | null;
}

/** Mirror of the Rust `LoadResult` shape. */
interface LoadResult {
  recipes: SpawnRecipe[];
  error: string | null;
}

interface SwarmSpawnState {
  readonly recipes: ReadonlyArray<SpawnRecipe>;
  /** One-line user-facing error if `.putz/spawn.json` is malformed. */
  readonly error: string | null;
  /** True while a `refresh` is in flight. */
  readonly loading: boolean;
  /** Re-read `.putz/spawn.json` from `workspaceRoot`. */
  refresh: (workspaceRoot: string) => Promise<void>;
  /** Clear the cached recipes (e.g., when no workspace is open). */
  clear: () => void;
}

type InvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

let invokeFn: InvokeFn | null = null;

/**
 * Inject the Tauri `invoke` function. Defaults are resolved lazily
 * so the bare module import does not pull in the Tauri runtime in
 * pure unit-test environments.
 */
export function setSpawnStoreInvokeFn(fn: InvokeFn | null): void {
  invokeFn = fn;
}

async function lazyInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (invokeFn) return invokeFn<T>(cmd, args);
  const mod = (await import("@tauri-apps/api/core")) as {
    invoke: <U>(c: string, a?: Record<string, unknown>) => Promise<U>;
  };
  return mod.invoke<T>(cmd, args);
}

/**
 * Map snake_case recipe shape from Rust to camelCase TypeScript.
 * Done in one place so component code never sees the wire shape.
 */
interface WireRecipe {
  name: string;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  initial_prompt?: string | null;
}

function fromWire(r: WireRecipe): SpawnRecipe {
  return {
    name: r.name,
    command: r.command,
    args: r.args ?? [],
    cwd: r.cwd ?? null,
    env: r.env ?? {},
    initialPrompt: r.initial_prompt ?? null,
  };
}

/** Project a UI recipe back to the wire shape for invoke calls. */
export function toWireRecipe(recipe: SpawnRecipe): WireRecipe {
  return {
    name: recipe.name,
    command: recipe.command,
    args: recipe.args ? [...recipe.args] : [],
    cwd: recipe.cwd ?? null,
    env: recipe.env ? { ...recipe.env } : {},
    initial_prompt: recipe.initialPrompt ?? null,
  };
}

export const useSwarmSpawnStore = create<SwarmSpawnState>((set) => ({
  recipes: [],
  error: null,
  loading: false,

  refresh: async (workspaceRoot: string) => {
    set({ loading: true });
    try {
      const result = await lazyInvoke<{
        recipes: WireRecipe[];
        error: string | null;
      }>("swarm_read_workspace_recipes", {
        workspaceRoot,
      });
      set({
        recipes: result.recipes.map(fromWire),
        error: result.error,
        loading: false,
      });
    } catch (err) {
      // Malformed-file errors come back inside `result.error`; we only
      // hit this branch for actual IPC / permission failures. Surface
      // a short, non-PII-leaking message to the UI.
      set({
        recipes: [],
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  clear: () => set({ recipes: [], error: null, loading: false }),
}));

/**
 * Test-only reset hook. Resets state and the invoke injection to the
 * known empty defaults.
 *
 * @internal
 */
export function _resetSwarmSpawnStoreForTests(): void {
  invokeFn = null;
  useSwarmSpawnStore.setState({ recipes: [], error: null, loading: false });
}

/**
 * Convert a free-form palette command line into a recipe.
 *
 * Splits on spaces (no shell interpretation — that runs in the
 * spawned PTY). The first token becomes the command; the rest the
 * args. Returns `null` for an empty trimmed input.
 *
 * **Security:** does NOT execute or expand the input — it only shapes
 * a recipe object, which the backend re-validates before spawning.
 * Quoting is intentionally NOT supported — users with complex needs
 * should write a recipe to `.putz/spawn.json`.
 */
export function recipeFromFreeFormInput(line: string): SpawnRecipe | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return {
    // Use the first token as the display name for the spawned tab.
    name: command,
    command,
    args,
    env: {},
    cwd: null,
    initialPrompt: null,
  };
}
