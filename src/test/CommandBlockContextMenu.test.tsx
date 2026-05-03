/**
 * Unit tests for CommandBlockContextMenu — right-click menu on gutter dots.
 *
 * Tests cover:
 *  - Renders Copy command / Copy output / Copy command + output items
 *  - Copy command calls clipboard with correct text
 *  - Copy output calls clipboard with correct text
 *  - Copy command + output calls clipboard with both
 *  - Rerun command is disabled when commandText is ""
 *  - Menu closes after action
 *  - Handles in-progress blocks (no commandEnd)
 *  - Handles blocks with no outputStart
 *
 * @see https://github.com/vbomfim/putz/issues/103
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandBlockContextMenu } from "../components/Terminal/CommandBlockContextMenu";
import type { CommandBlock } from "../stores/commandBlockStore";
import { extractRangeText } from "../components/Terminal/bufferUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(
  overrides: Partial<CommandBlock> & { id: string },
): CommandBlock {
  return {
    sessionId: "ctx-session",
    promptStart: { row: 0, col: 0 },
    commandStart: { row: 0, col: 2 },
    outputStart: { row: 1, col: 0 },
    commandEnd: { row: 3, col: 0 },
    exitCode: 0,
    commandText: "",
    startedAt: Date.now(),
    ...overrides,
  };
}

/** Mock buffer line for extractRangeText. */
function createMockBufferLine(text: string) {
  return {
    translateToString: (_trimRight?: boolean) => text,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommandBlockContextMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders all menu items", () => {
    const block = makeBlock({ id: "b1" });
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
        getBufferLine={(_row: number) => null}
        totalBufferLength={100}
      />,
    );

    expect(screen.getByText("Copy command")).toBeInTheDocument();
    expect(screen.getByText("Copy output")).toBeInTheDocument();
    expect(screen.getByText("Copy command + output")).toBeInTheDocument();
    expect(screen.getByText("Rerun command")).toBeInTheDocument();
  });

  it("Rerun command is disabled when commandText is empty", () => {
    const block = makeBlock({ id: "b1", commandText: "" });
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
        getBufferLine={(_row: number) => null}
        totalBufferLength={100}
      />,
    );

    const rerunBtn = screen.getByText("Rerun command");
    expect(rerunBtn.closest("button")).toBeDisabled();
  });

  it("Copy command extracts correct buffer range", async () => {
    const block = makeBlock({
      id: "b1",
      commandStart: { row: 2, col: 0 },
      outputStart: { row: 3, col: 0 },
    });
    const lineMap: Record<number, string> = {
      2: "ls -la",
    };
    const getBufferLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={getBufferLine}
        totalBufferLength={100}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Copy command"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ls -la");
    expect(onClose).toHaveBeenCalled();
  });

  it("Copy output extracts correct buffer range", async () => {
    const block = makeBlock({
      id: "b1",
      outputStart: { row: 3, col: 0 },
      commandEnd: { row: 5, col: 0 },
    });
    const lineMap: Record<number, string> = {
      3: "file1.txt",
      4: "file2.txt",
    };
    const getBufferLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={getBufferLine}
        totalBufferLength={100}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Copy output"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "file1.txt\nfile2.txt",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Copy command + output extracts both ranges", async () => {
    const block = makeBlock({
      id: "b1",
      commandStart: { row: 2, col: 0 },
      outputStart: { row: 3, col: 0 },
      commandEnd: { row: 5, col: 0 },
    });
    const lineMap: Record<number, string> = {
      2: "ls -la",
      3: "file1.txt",
      4: "file2.txt",
    };
    const getBufferLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={getBufferLine}
        totalBufferLength={100}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Copy command + output"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "ls -la\nfile1.txt\nfile2.txt",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("handles in-progress block (no commandEnd) for copy output", async () => {
    const block = makeBlock({
      id: "b1",
      outputStart: { row: 3, col: 0 },
      commandEnd: null,
      exitCode: null,
    });
    const lineMap: Record<number, string> = {
      3: "partial output...",
      4: "still running",
    };
    const getBufferLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={getBufferLine}
        totalBufferLength={5}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Copy output"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "partial output...\nstill running",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("closes menu when clicking outside (onClose called)", () => {
    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={makeBlock({ id: "b1" })}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={() => null}
        totalBufferLength={100}
      />,
    );

    // Simulate mousedown outside — the component should listen for this
    fireEvent.mouseDown(document);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders menu at the correct position", () => {
    render(
      <CommandBlockContextMenu
        block={makeBlock({ id: "b1" })}
        position={{ x: 150, y: 300 }}
        onClose={vi.fn()}
        getBufferLine={() => null}
        totalBufferLength={100}
      />,
    );

    const menu = screen.getByTestId("command-block-context-menu");
    expect(menu.style.left).toBe("150px");
    expect(menu.style.top).toBe("300px");
  });

  it("Copy command is no-op when commandStart is null", async () => {
    const block = makeBlock({
      id: "b1",
      commandStart: null,
      outputStart: { row: 3, col: 0 },
    });
    const onClose = vi.fn();
    render(
      <CommandBlockContextMenu
        block={block}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        getBufferLine={() => null}
        totalBufferLength={100}
      />,
    );

    // Copy command button should be disabled when commandStart is null
    const copyBtn = screen.getByText("Copy command");
    expect(copyBtn.closest("button")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// extractRangeText tests
// ---------------------------------------------------------------------------

describe("extractRangeText", () => {
  it("extracts lines from a range", () => {
    const lineMap: Record<number, string> = {
      0: "first line",
      1: "second line",
      2: "third line",
    };
    const getLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const text = extractRangeText(getLine, 0, 3);
    expect(text).toBe("first line\nsecond line\nthird line");
  });

  it("skips null lines", () => {
    const getLine = (row: number) =>
      row === 1 ? createMockBufferLine("only line") : null;

    const text = extractRangeText(getLine, 0, 3);
    expect(text).toBe("only line");
  });

  it("returns empty string for empty range", () => {
    const text = extractRangeText(() => null, 5, 5);
    expect(text).toBe("");
  });

  it("trims trailing whitespace", () => {
    const getLine = (_row: number) => createMockBufferLine("content   ");

    const text = extractRangeText(getLine, 0, 1);
    expect(text).toBe("content");
  });
});
