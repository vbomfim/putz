import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { SpawnPalette } from "../components/Swarm/SpawnPalette";
import {
  useSwarmSpawnStore,
  _resetSwarmSpawnStoreForTests,
  type SpawnRecipe,
} from "../stores/swarmSpawnStore";

function makeRecipe(name: string, cmd = "echo"): SpawnRecipe {
  return { name, cmd, args: ["hi"] };
}

describe("SpawnPalette", () => {
  beforeEach(() => {
    _resetSwarmSpawnStoreForTests();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <SpawnPalette
        open={false}
        onClose={vi.fn()}
        workspaceRoot="/ws"
        invoke={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("triggers refresh on open via store invoke", async () => {
    const storeInvoke = vi.fn().mockResolvedValue({
      recipes: [],
      error: null,
    });
    const { setSpawnStoreInvokeFn } = await import(
      "../stores/swarmSpawnStore"
    );
    setSpawnStoreInvokeFn(storeInvoke);
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot="/ws"
        invoke={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(storeInvoke).toHaveBeenCalledWith(
        "swarm_read_workspace_recipes",
        expect.objectContaining({ workspaceRoot: "/ws" }),
      ),
    );
    setSpawnStoreInvokeFn(null);
  });

  it("lists recipes from the store (default gh-copilot prepended)", () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("alpha"), makeRecipe("beta")],
      error: null,
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    const items = screen.getAllByTestId("swarm-spawn-item");
    // A4 (FR-019): the default "Spawn: copilot" entry is always
    // prepended, ahead of user-defined recipes.
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-recipe-name", "Spawn: copilot");
    expect(items[1]).toHaveAttribute("data-recipe-name", "alpha");
    expect(items[2]).toHaveAttribute("data-recipe-name", "beta");
  });

  it("default 'Spawn: copilot' is available even when .putz/spawn.json is missing (A4 / FR-019)", () => {
    useSwarmSpawnStore.setState({
      recipes: [],
      error: null,
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    const items = screen.getAllByTestId("swarm-spawn-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-recipe-name", "Spawn: copilot");
  });

  it("filters by query", () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("alpha"), makeRecipe("beta")],
      error: null,
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    fireEvent.change(screen.getByTestId("swarm-spawn-input"), {
      target: { value: "bet" },
    });
    const items = screen.getAllByTestId("swarm-spawn-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-recipe-name", "beta");
  });

  it("offers free-form spawn alongside recipe matches when query has content (E3 / FR-015)", () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("alpha")],
      error: null,
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    // "alpha" matches recipe "alpha" — but free-form must STILL be
    // reachable (E3: spec drift fix; previously only shown when zero
    // recipe matches).
    fireEvent.change(screen.getByTestId("swarm-spawn-input"), {
      target: { value: "alpha" },
    });
    expect(screen.getAllByTestId("swarm-spawn-item")).toHaveLength(1);
    expect(screen.getByTestId("swarm-spawn-freeform")).toBeInTheDocument();
  });

  it("offers free-form spawn when no recipe matches", () => {
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    fireEvent.change(screen.getByTestId("swarm-spawn-input"), {
      target: { value: "ls -la" },
    });
    expect(screen.getByTestId("swarm-spawn-freeform")).toBeInTheDocument();
  });

  it("invokes swarm_spawn_from_recipe and closes on click", async () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("alpha", "echo")],
      error: null,
      loading: false,
    });
    const invoke = vi.fn().mockResolvedValueOnce("colleague-id-1");
    const onClose = vi.fn();
    const onSpawned = vi.fn();
    render(
      <SpawnPalette
        open={true}
        onClose={onClose}
        workspaceRoot={null}
        invoke={invoke}
        onSpawned={onSpawned}
      />,
    );
    // Click the user recipe specifically (default gh-copilot is also
    // present at index 0 thanks to A4).
    await act(async () => {
      const items = screen.getAllByTestId("swarm-spawn-item");
      const alpha = items.find(
        (el) => el.getAttribute("data-recipe-name") === "alpha",
      );
      if (!alpha) throw new Error("alpha recipe not found");
      fireEvent.click(alpha);
    });
    await waitFor(() => expect(onSpawned).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith(
      "swarm_spawn_from_recipe",
      expect.objectContaining({
        recipe: expect.objectContaining({ name: "alpha", cmd: "echo" }),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSpawnError on failure and stays open", async () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("alpha")],
      error: null,
      loading: false,
    });
    const invoke = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const onClose = vi.fn();
    const onSpawnError = vi.fn();
    render(
      <SpawnPalette
        open={true}
        onClose={onClose}
        workspaceRoot={null}
        invoke={invoke}
        onSpawnError={onSpawnError}
      />,
    );
    await act(async () => {
      const items = screen.getAllByTestId("swarm-spawn-item");
      const alpha = items.find(
        (el) => el.getAttribute("data-recipe-name") === "alpha",
      );
      if (!alpha) throw new Error("alpha recipe not found");
      fireEvent.click(alpha);
    });
    await waitFor(() => expect(onSpawnError).toHaveBeenCalled());
    expect(onSpawnError.mock.calls[0][1]).toBe("boom");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ESC closes", () => {
    const onClose = vi.fn();
    render(
      <SpawnPalette
        open={true}
        onClose={onClose}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders typed error.message from store", () => {
    useSwarmSpawnStore.setState({
      recipes: [],
      error: { kind: "malformed_json", message: "Malformed .putz/spawn.json" },
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    expect(screen.getByTestId("swarm-spawn-error")).toHaveTextContent(
      "Malformed .putz/spawn.json",
    );
  });

  it("ArrowDown moves active selection", () => {
    useSwarmSpawnStore.setState({
      recipes: [makeRecipe("a"), makeRecipe("b"), makeRecipe("c")],
      error: null,
      loading: false,
    });
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    const input = screen.getByTestId("swarm-spawn-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const items = screen.getAllByTestId("swarm-spawn-item");
    expect(items[2]).toHaveAttribute("data-active", "true");
  });

  it("dialog has role=dialog and aria-modal", () => {
    render(
      <SpawnPalette
        open={true}
        onClose={vi.fn()}
        workspaceRoot={null}
        invoke={vi.fn().mockResolvedValue({ recipes: [], error: null })}
      />,
    );
    const dialog = screen.getByTestId("swarm-spawn-panel");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
