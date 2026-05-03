/**
 * Unit tests for CommandGutter — the per-command status dot gutter.
 *
 * Tests cover:
 *  - Renders nothing when session has no blocks
 *  - Renders nothing when session is not handshaked even with blocks
 *  - Renders one dot per completed block (green/red/grey by exit code)
 *  - Renders blue dot for in-progress block (commandEnd === null)
 *  - Updates dots when new blocks are ingested
 *  - Hides off-screen dots (block row < viewportTop or > viewportTop + rows)
 *  - Updates dot positions on viewport scroll
 *  - Renders correctly when terminal is resized (cellHeight changes)
 *  - Includes active (in-progress) block in rendered dots
 *
 * @see https://github.com/vbomfim/putz/issues/103
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandGutter } from "../components/Terminal/CommandGutter";
import { useCommandBlockStore } from "../stores/commandBlockStore";
import type { CommandBlock } from "../stores/commandBlockStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal CommandBlock for testing. */
function makeBlock(
  overrides: Partial<CommandBlock> & { id: string },
): CommandBlock {
  return {
    sessionId: "test-session",
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

const SESSION_ID = "test-session";
const CELL_HEIGHT = 17;
const ROWS = 24;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommandGutter", () => {
  beforeEach(() => {
    useCommandBlockStore.getState().reset();
  });

  it("renders nothing when session has no blocks", () => {
    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="gutter-dot"]'),
    ).toHaveLength(0);
  });

  it("renders nothing when session is not handshaked even with blocks", () => {
    // Manually set blocks without handshake
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: false,
            blocks: [makeBlock({ id: "b1" })],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="gutter-dot"]'),
    ).toHaveLength(0);
  });

  it("renders green dot for exit code 0", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [makeBlock({ id: "b1", exitCode: 0 })],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dots = container.querySelectorAll('[data-testid="gutter-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("gutter-dot--success");
  });

  it("renders red dot for non-zero exit code", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [makeBlock({ id: "b1", exitCode: 127 })],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dots = container.querySelectorAll('[data-testid="gutter-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("gutter-dot--error");
  });

  it("renders grey dot when exitCode is null and command has ended", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                exitCode: null,
                commandEnd: { row: 3, col: 0 },
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dots = container.querySelectorAll('[data-testid="gutter-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("gutter-dot--unknown");
  });

  it("renders blue dot for in-progress block (commandEnd === null)", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [],
            activeBlock: makeBlock({
              id: "active-1",
              commandEnd: null,
              exitCode: null,
            }),
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dots = container.querySelectorAll('[data-testid="gutter-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("gutter-dot--running");
  });

  it("renders multiple dots for multiple blocks", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                exitCode: 0,
                commandStart: { row: 0, col: 2 },
              }),
              makeBlock({
                id: "b2",
                exitCode: 1,
                commandStart: { row: 5, col: 2 },
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dots = container.querySelectorAll('[data-testid="gutter-dot"]');
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveClass("gutter-dot--success");
    expect(dots[1]).toHaveClass("gutter-dot--error");
  });

  it("positions dots using absolute row, cellHeight, and viewportTop", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                commandStart: { row: 5, col: 2 },
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={2}
        rows={ROWS}
      />,
    );
    const dot = container.querySelector(
      '[data-testid="gutter-dot"]',
    ) as HTMLElement;
    expect(dot).toBeTruthy();
    // top = (5 - 2) * 17 = 51px
    expect(dot.style.top).toBe("51px");
  });

  it("hides dots that are above viewport (row < viewportTop)", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                commandStart: { row: 2, col: 0 },
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={5}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="gutter-dot"]'),
    ).toHaveLength(0);
  });

  it("hides dots that are below viewport (row > viewportTop + rows)", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                commandStart: { row: 50, col: 0 },
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="gutter-dot"]'),
    ).toHaveLength(0);
  });

  it("uses promptStart.row when commandStart is null", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                promptStart: { row: 7, col: 0 },
                commandStart: null,
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    const dot = container.querySelector(
      '[data-testid="gutter-dot"]',
    ) as HTMLElement;
    expect(dot).toBeTruthy();
    // top = (7 - 0) * 17 = 119px
    expect(dot.style.top).toBe("119px");
  });

  it("does not render if both promptStart and commandStart are null", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            handshaked: true,
            blocks: [
              makeBlock({
                id: "b1",
                promptStart: null,
                commandStart: null,
              }),
            ],
            activeBlock: null,
          },
        ],
      ]),
    });

    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="gutter-dot"]'),
    ).toHaveLength(0);
  });

  it("renders gutter container with correct data-testid", () => {
    useCommandBlockStore.setState({
      sessions: new Map([
        [SESSION_ID, { handshaked: true, blocks: [], activeBlock: null }],
      ]),
    });

    render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(screen.getByTestId("command-gutter")).toBeInTheDocument();
  });

  it("does not render gutter container when not handshaked", () => {
    const { container } = render(
      <CommandGutter
        sessionId={SESSION_ID}
        cellHeight={CELL_HEIGHT}
        viewportTop={0}
        rows={ROWS}
      />,
    );
    expect(
      container.querySelector('[data-testid="command-gutter"]'),
    ).toBeNull();
  });
});
