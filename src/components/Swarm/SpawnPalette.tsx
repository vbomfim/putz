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
  type SpawnRecipe,
} from "../../stores/swarmSpawnStore";

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

  // Refresh on open so .putz/spawn.json edits take effect without restart.
  useEffect(() => {
    if (open && workspaceRoot) {
      void refresh(workspaceRoot);
    }
  }, [open, workspaceRoot, refresh]);

  // Reset query + selection on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setSpawning(false);
      // Defer focus until the input mounts.
      queueMicrotask(() => inputRef.current?.focus());
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
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.command.toLowerCase().includes(q),
    );
  }, [recipes, query]);

  const freeFormCandidate = useMemo(
    () =>
      filtered.length === 0 && query.trim().length > 0
        ? recipeFromFreeFormInput(query)
        : null,
    [filtered.length, query],
  );

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
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (spawning) return;
        if (filtered.length > 0) {
          const target = filtered[activeIndex] ?? filtered[0];
          if (target) void spawn(target);
        } else if (freeFormCandidate) {
          void spawn(freeFormCandidate);
        }
      }
    },
    [activeIndex, filtered, freeFormCandidate, spawn, spawning],
  );

  if (!open) return null;

  return (
    <div
      data-testid="swarm-spawn-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 1001,
      }}
    >
      <div
        data-testid="swarm-spawn-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Spawn palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 90vw)",
          background: "var(--bg-primary, #1a1a1a)",
          color: "var(--text-primary, #e1e4e8)",
          borderRadius: "8px",
          border: "1px solid var(--border-color, #2a2a2a)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
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
          style={{
            padding: "10px 14px",
            background: "transparent",
            color: "inherit",
            border: "none",
            borderBottom: "1px solid var(--border-color, #2a2a2a)",
            outline: "none",
            fontSize: "14px",
          }}
        />
        {error && (
          <div
            data-testid="swarm-spawn-error"
            role="alert"
            style={{
              padding: "6px 14px",
              background: "rgba(239, 68, 68, 0.1)",
              color: "var(--swarm-ring-urgent, #ef4444)",
              fontSize: "11px",
              borderBottom: "1px solid var(--border-color, #2a2a2a)",
            }}
          >
            {error}
          </div>
        )}
        <ul
          role="listbox"
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          {filtered.length > 0 ? (
            filtered.map((r, idx) => (
              <li key={r.name} role="option" aria-selected={idx === activeIndex}>
                <button
                  type="button"
                  data-testid="swarm-spawn-item"
                  data-recipe-name={r.name}
                  data-active={idx === activeIndex ? "true" : "false"}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => void spawn(r)}
                  disabled={spawning}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background:
                      idx === activeIndex
                        ? "var(--bg-secondary, #15171a)"
                        : "transparent",
                    color: "inherit",
                    border: "none",
                    cursor: spawning ? "wait" : "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    {r.name}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      opacity: 0.7,
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.command}
                    {r.args && r.args.length > 0 ? " " + r.args.join(" ") : ""}
                  </span>
                </button>
              </li>
            ))
          ) : freeFormCandidate ? (
            <li role="option" aria-selected="true">
              <button
                type="button"
                data-testid="swarm-spawn-freeform"
                onClick={() => void spawn(freeFormCandidate)}
                disabled={spawning}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: "var(--bg-secondary, #15171a)",
                  color: "inherit",
                  border: "none",
                  cursor: spawning ? "wait" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Spawn free-form
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    opacity: 0.7,
                    fontFamily: "monospace",
                  }}
                >
                  {freeFormCandidate.command}
                  {ffArgs.length > 0 ? " " + ffArgs.join(" ") : ""}
                </span>
              </button>
            </li>
          ) : (
            <li
              data-testid="swarm-spawn-empty"
              style={{
                padding: "20px 14px",
                fontSize: "12px",
                opacity: 0.65,
                textAlign: "center",
              }}
            >
              {recipes.length === 0
                ? "No recipes in .putz/spawn.json — type a command and press Enter."
                : "No matches. Type a command and press Enter to spawn free-form."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
