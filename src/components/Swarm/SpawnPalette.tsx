/**
 * `SpawnPalette` — modal Cmd+K palette for spawning new colleagues
 * from `.putz/spawn.json` recipes or free-form input (T4 / FR-015).
 *
 * Behavior:
 *  - role="dialog", aria-modal="true", ESC closes
 *  - On open: triggers `useSwarmSpawnStore.refresh(workspaceRoot)` so
 *    edits to .putz/spawn.json take effect without restart
 *  - Recipes shown in a list, filterable via the input
 *  - Free-form mode: when input doesn't match a recipe and contains
 *    a space, Enter sends a recipe synthesized from the input via
 *    `recipeFromFreeFormInput`
 *  - Arrow keys navigate, Enter spawns, ESC closes
 *  - Surfaces store error (parse failure) at the top of the panel
 *
 * @module components/Swarm/SpawnPalette
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSwarmSpawnStore,
  recipeFromFreeFormInput,
  toWireRecipe,
  DEFAULT_SPAWN_COPILOT,
  type SpawnRecipe,
} from "../../stores/swarmSpawnStore";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Workspace root passed to the recipe loader. */
  workspaceRoot: string | null | undefined;
  /** Tauri invoke; tests pass a fake. */
  invoke: <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  /** Notify the host that a spawn succeeded (for snackbars etc.). */
  onSpawned?: (recipe: SpawnRecipe) => void;
  /** Notify the host that a spawn failed (for surfaceable errors). */
  onSpawnError?: (recipe: SpawnRecipe, message: string) => void;
}

export function SpawnPalette({
  open,
  onClose,
  workspaceRoot,
  invoke,
  onSpawned,
  onSpawnError,
}: Props) {
  const recipes = useSwarmSpawnStore((s) => s.recipes);
  const error = useSwarmSpawnStore((s) => s.error);
  const refresh = useSwarmSpawnStore((s) => s.refresh);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [spawning, setSpawning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // D1: trap Tab focus inside the palette dialog (WAI-ARIA APG).
  useFocusTrap(dialogRef, open);
  // D1: remember the element that had focus when we opened, so we can
  // restore it on close (modal a11y best-practice — WAI-ARIA APG).
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // A4 (FR-019): the built-in "Spawn: copilot" entry MUST always be
  // available, regardless of `.putz/spawn.json`. Prepend it but de-dupe
  // if a user-defined recipe already uses the same name.
  const allRecipes = useMemo<ReadonlyArray<SpawnRecipe>>(() => {
    const hasOverride = recipes.some(
      (r) => r.name === DEFAULT_SPAWN_COPILOT.name,
    );
    return hasOverride ? recipes : [DEFAULT_SPAWN_COPILOT, ...recipes];
  }, [recipes]);

  // Refresh on open so .putz/spawn.json edits take effect without restart.
  useEffect(() => {
    if (open && workspaceRoot) {
      void refresh(workspaceRoot);
    }
  }, [open, workspaceRoot, refresh]);

  // Reset query + selection on open. Capture previous focus so we can
  // restore it on close (D1 — focus restoration).
  useEffect(() => {
    if (open) {
      previousFocusRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
      setQuery("");
      setActiveIndex(0);
      setSpawning(false);
      // Defer focus until the input mounts.
      queueMicrotask(() => inputRef.current?.focus());
    } else if (previousFocusRef.current) {
      // On close, restore focus to the trigger.
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      queueMicrotask(() => prev.focus?.());
    }
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRecipes;
    return allRecipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.cmd.toLowerCase().includes(q),
    );
  }, [allRecipes, query]);

  // E3 (FR-015): the free-form item is always reachable when the user
  // typed something — not only when filtered.length === 0. It appears
  // as the LAST option, so keyboard nav can always reach it.
  const freeFormCandidate = useMemo(
    () => (query.trim().length > 0 ? recipeFromFreeFormInput(query) : null),
    [query],
  );

  /** Combined option list for keyboard navigation. */
  const navOptions = useMemo<ReadonlyArray<SpawnRecipe>>(() => {
    if (freeFormCandidate) return [...filtered, freeFormCandidate];
    return filtered;
  }, [filtered, freeFormCandidate]);

  // Clamp activeIndex when the option list shrinks.
  useEffect(() => {
    if (activeIndex >= navOptions.length) {
      setActiveIndex(Math.max(0, navOptions.length - 1));
    }
  }, [navOptions.length, activeIndex]);

  const ffArgs: ReadonlyArray<string> = freeFormCandidate?.args ?? [];

  const spawn = useCallback(
    async (recipe: SpawnRecipe) => {
      setSpawning(true);
      try {
        await invoke("swarm_spawn_from_recipe", {
          recipe: toWireRecipe(recipe),
        });
        onSpawned?.(recipe);
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onSpawnError?.(recipe, msg);
      } finally {
        setSpawning(false);
      }
    },
    [invoke, onSpawned, onSpawnError, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(navOptions.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (spawning) return;
        const target = navOptions[activeIndex] ?? navOptions[0];
        if (target) void spawn(target);
      }
    },
    [activeIndex, navOptions, spawn, spawning],
  );

  if (!open) return null;

  return (
    <div
      className="swarm-spawn-overlay"
      data-testid="swarm-spawn-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="swarm-spawn-panel"
        data-testid="swarm-spawn-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Spawn palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="swarm-spawn-panel__input"
          data-testid="swarm-spawn-input"
          aria-label="Recipe filter or free-form command"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Recipe name or 'command arg1 arg2…'"
          maxLength={4096}
        />
        {error && (
          <div
            className="swarm-spawn-panel__error"
            data-testid="swarm-spawn-error"
            role="alert"
          >
            {error.message}
          </div>
        )}
        <ul role="listbox" className="swarm-spawn-panel__list">
          {filtered.map((r, idx) => (
            <li key={r.name} role="option" aria-selected={idx === activeIndex}>
              <button
                type="button"
                className={`swarm-spawn-item${
                  idx === activeIndex ? " swarm-spawn-item--active" : ""
                }`}
                data-testid="swarm-spawn-item"
                data-recipe-name={r.name}
                data-active={idx === activeIndex ? "true" : "false"}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => void spawn(r)}
                disabled={spawning}
              >
                <span className="swarm-spawn-item__name">{r.name}</span>
                <span className="swarm-spawn-item__cmd">
                  {r.cmd}
                  {r.args && r.args.length > 0 ? " " + r.args.join(" ") : ""}
                </span>
              </button>
            </li>
          ))}
          {freeFormCandidate && (
            <li
              role="option"
              aria-selected={activeIndex === filtered.length}
            >
              <button
                type="button"
                className={`swarm-spawn-item${
                  activeIndex === filtered.length
                    ? " swarm-spawn-item--active"
                    : ""
                }`}
                data-testid="swarm-spawn-freeform"
                data-active={
                  activeIndex === filtered.length ? "true" : "false"
                }
                onMouseEnter={() => setActiveIndex(filtered.length)}
                onClick={() => void spawn(freeFormCandidate)}
                disabled={spawning}
              >
                <span className="swarm-spawn-item__name">Spawn free-form</span>
                <span className="swarm-spawn-item__cmd">
                  {freeFormCandidate.cmd}
                  {ffArgs.length > 0 ? " " + ffArgs.join(" ") : ""}
                </span>
              </button>
            </li>
          )}
          {filtered.length === 0 && !freeFormCandidate && (
            <li className="swarm-spawn-empty" data-testid="swarm-spawn-empty">
              {recipes.length === 0
                ? "Type a command and press Enter to spawn free-form."
                : "No matches. Type a command and press Enter to spawn free-form."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
