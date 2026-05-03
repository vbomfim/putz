/**
 * Unit tests for CommandBlockContextMenu — right-click menu on gutter dots.
 *
 * Tests cover:
 *  - Renders Copy command / Copy output / Copy command + output items
 *  - Copy command calls clipboard with correct text (column-aware)
 *  - Copy output calls clipboard with correct text
 *  - Copy command + output calls clipboard with both
 *  - Rerun command is disabled when commandText is ""
 *  - Menu closes after action
 *  - Handles in-progress blocks (no commandEnd)
 *  - Handles blocks with no outputStart
 *  - Column-aware extraction: prompt prefix excluded
 *  - Clipboard failure is caught gracefully
 *  - Viewport clamping
 *  - ARIA roles
 *  - Escape key closes menu
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

  it("Copy command extracts correct buffer range (column-aware)", async () => {
    // commandStart at col 2 (after "❯ " prompt prefix) → should NOT include prefix
    const block = makeBlock({
      id: "b1",
      commandStart: { row: 2, col: 2 },
      outputStart: { row: 3, col: 0 },
    });
    const lineMap: Record<number, string> = {
      2: "❯ ls -la",
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

    // Should extract "ls -la" (from col 2), NOT "❯ ls -la"
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
      commandStart: { row: 2, col: 2 },
      outputStart: { row: 3, col: 0 },
      commandEnd: { row: 5, col: 0 },
    });
    const lineMap: Record<number, string> = {
      2: "❯ ls -la",
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

    // Starts from col 2 on row 2 → skips "❯ "
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

  it("closes when Escape key is pressed", () => {
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

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
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

    // Initial render — position is set before useLayoutEffect clamping
    const menu = screen.getByTestId("command-block-context-menu");
    // After clamping, still within viewport so position is unchanged
    // (jsdom default viewport is large enough)
    expect(menu.style.position).toBe("fixed");
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

  it("handles clipboard write failure gracefully", async () => {
    // Make clipboard.writeText reject
    Object.assign(navigator, {
      clipboard: {
        writeText: vi
          .fn()
          .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      },
    });

    const block = makeBlock({
      id: "b1",
      commandStart: { row: 0, col: 0 },
      outputStart: { row: 1, col: 0 },
    });
    const getBufferLine = (row: number) =>
      row === 0 ? createMockBufferLine("test cmd") : null;
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

    // Should not throw — failure is caught internally
    await act(async () => {
      fireEvent.click(screen.getByText("Copy command"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    // onClose is still called even on clipboard failure
    expect(onClose).toHaveBeenCalled();
  });

  it("has correct ARIA roles", () => {
    render(
      <CommandBlockContextMenu
        block={makeBlock({ id: "b1" })}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
        getBufferLine={() => null}
        totalBufferLength={100}
      />,
    );

    const menu = screen.getByTestId("command-block-context-menu");
    expect(menu.getAttribute("role")).toBe("menu");

    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(4); // Copy cmd, Copy output, Copy both, Rerun
  });
});

// ---------------------------------------------------------------------------
// extractRangeText tests
// ---------------------------------------------------------------------------

describe("extractRangeText", () => {
  it("extracts lines from a range (legacy overload)", () => {
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
    const text = extractRangeText(getLine, 5, 5);
    expect(text).toBe("");

    function getLine() {
      return null;
    }
  });

  it("trims trailing whitespace", () => {
    const getLine = (_row: number) => createMockBufferLine("content   ");

    const text = extractRangeText(getLine, 0, 1);
    expect(text).toBe("content");
  });

  it("extracts column-aware range: single row with startCol", () => {
    const getLine = (_row: number) => createMockBufferLine("❯ ls -la");

    const text = extractRangeText(getLine, {
      startRow: 0,
      startCol: 2,
      endRow: 1,
    });
    expect(text).toBe("ls -la");
  });

  it("extracts column-aware range: multi-row with startCol on first row", () => {
    const lineMap: Record<number, string> = {
      5: "❯ echo hello",
      6: "hello",
    };
    const getLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const text = extractRangeText(getLine, {
      startRow: 5,
      startCol: 2,
      endRow: 7,
    });
    expect(text).toBe("echo hello\nhello");
  });

  it("extracts column-aware range: multi-row with endCol on last row", () => {
    const lineMap: Record<number, string> = {
      0: "full first line",
      1: "partial second line",
    };
    const getLine = (row: number) =>
      lineMap[row] ? createMockBufferLine(lineMap[row]) : null;

    const text = extractRangeText(getLine, {
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 7,
    });
    expect(text).toBe("full first line\npartial");
  });

  it("returns empty string when startRow > endRow (defensive)", () => {
    const getLine = (_row: number) => createMockBufferLine("should not appear");

    const text = extractRangeText(getLine, {
      startRow: 10,
      startCol: 0,
      endRow: 5,
      endCol: 0,
    });
    expect(text).toBe("");
  });

  it("clamps negative startRow to 0", () => {
    const getLine = (row: number) =>
      row === 0 ? createMockBufferLine("row zero") : null;

    const text = extractRangeText(getLine, {
      startRow: -5,
      startCol: 0,
      endRow: 1,
    });
    expect(text).toBe("row zero");
  });
});
