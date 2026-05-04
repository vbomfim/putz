import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { SpawnPalette } from "../components/Swarm/SpawnPalette";
import {
  useSwarmSpawnStore,
  _resetSwarmSpawnStoreForTests,
  type SpawnRecipe,
} from "../stores/swarmSpawnStore";

function makeRecipe(name: string, command = "echo"): SpawnRecipe {
  return { name, command, args: ["hi"] };
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

  it("lists recipes from the store", () => {
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
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-recipe-name", "alpha");
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
    await act(async () => {
      fireEvent.click(screen.getByTestId("swarm-spawn-item"));
    });
    await waitFor(() => expect(onSpawned).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith(
      "swarm_spawn_from_recipe",
      expect.objectContaining({
        recipe: expect.objectContaining({ name: "alpha", command: "echo" }),
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
      fireEvent.click(screen.getByTestId("swarm-spawn-item"));
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

  it("renders error from store", () => {
    useSwarmSpawnStore.setState({
      recipes: [],
      error: "Malformed .putz/spawn.json",
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
