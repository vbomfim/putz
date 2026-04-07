/**
 * Unit tests for the SplitContainer component.
 *
 * Tests recursive pane rendering, split layouts, and leaf terminal rendering.
 *
 * Tags: [TDD], [AC-5], [AC-6], [AC-7], [AC-8]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SplitContainer } from "../components/SplitPane";
import type { PaneNode } from "../types";

// Mock Tauri APIs for TerminalView
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock allotment since it depends on DOM measurement APIs unavailable in jsdom
vi.mock("allotment", () => {
  const AllotmentComponent = ({
    children,
    vertical,
  }: {
    children: React.ReactNode;
    vertical?: boolean;
  }) => (
    <div
      data-testid="allotment-container"
      data-vertical={vertical ? "true" : "false"}
    >
      {children}
    </div>
  );

  AllotmentComponent.Pane = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="allotment-pane">{children}</div>
  );

  return {
    Allotment: AllotmentComponent,
  };
});

// Mock allotment CSS
vi.mock("allotment/dist/style.css", () => ({}));

// Mock the tab store
vi.mock("../stores/tabStore", () => ({
  useTabStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      unsplitPane: vi.fn(),
    };
    return selector(state);
  }),
}));

describe("SplitContainer", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  describe("leaf rendering", () => {
    it("renders a terminal for a leaf pane", () => {
      const layout: PaneNode = {
        type: "leaf",
        terminalSessionId: "session-abc",
      };

      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);

      const terminal = screen.getByTestId("terminal-wrapper");
      expect(terminal).toBeInTheDocument();
    });
  });

  describe("split rendering", () => {
    it("renders a vertical split with two terminals", () => {
      const layout: PaneNode = {
        type: "split",
        direction: "vertical",
        children: [
          { type: "leaf", terminalSessionId: "session-1" },
          { type: "leaf", terminalSessionId: "session-2" },
        ],
        ratio: 0.5,
      };

      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);

      const allotment = screen.getByTestId("allotment-container");
      expect(allotment).toBeInTheDocument();
      // Vertical split: Allotment vertical={false} for left/right split
      expect(allotment).toHaveAttribute("data-vertical", "false");

      const terminals = screen.getAllByTestId("terminal-wrapper");
      expect(terminals).toHaveLength(2);
    });

    it("renders a horizontal split with two terminals", () => {
      const layout: PaneNode = {
        type: "split",
        direction: "horizontal",
        children: [
          { type: "leaf", terminalSessionId: "session-1" },
          { type: "leaf", terminalSessionId: "session-2" },
        ],
        ratio: 0.5,
      };

      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);

      const allotment = screen.getByTestId("allotment-container");
      // Horizontal split: Allotment vertical={true} for top/bottom split
      expect(allotment).toHaveAttribute("data-vertical", "true");
    });

    it("renders nested splits (2 levels)", () => {
      const layout: PaneNode = {
        type: "split",
        direction: "vertical",
        children: [
          { type: "leaf", terminalSessionId: "session-1" },
          {
            type: "split",
            direction: "horizontal",
            children: [
              { type: "leaf", terminalSessionId: "session-2" },
              { type: "leaf", terminalSessionId: "session-3" },
            ],
            ratio: 0.5,
          },
        ],
        ratio: 0.5,
      };

      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);

      const terminals = screen.getAllByTestId("terminal-wrapper");
      expect(terminals).toHaveLength(3);

      const allotments = screen.getAllByTestId("allotment-container");
      expect(allotments).toHaveLength(2);
    });
  });

  describe("inactive tab", () => {
    it("renders with visibility hidden when inactive", () => {
      const layout: PaneNode = {
        type: "leaf",
        terminalSessionId: "session-1",
      };

      const { container } = render(
        <SplitContainer layout={layout} tabId="tab-1" isActive={false} />,
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.style.visibility).toBe("hidden");
    });
  });
});
