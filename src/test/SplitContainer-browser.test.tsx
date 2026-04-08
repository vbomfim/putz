/**
 * Unit tests for SplitContainer browser tab integration.
 *
 * Verifies that SplitContainer renders BrowserView for browser-prefixed
 * session IDs and TerminalView for regular session IDs.
 *
 * Tags: [TDD], [BROWSER-TABS]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SplitContainer } from "../components/SplitPane";
import type { PaneNode } from "../types";
import { BROWSER_SESSION_PREFIX } from "../types";

// Mock Tauri APIs
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock allotment (same as existing SplitContainer test)
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

  return { Allotment: AllotmentComponent };
});

vi.mock("allotment/dist/style.css", () => ({}));

// Mock BrowserView CSS
vi.mock("../components/Browser/BrowserView.css", () => ({}));

// Mock the tab store with browser URL support
const mockTabState = {
  unsplitPane: vi.fn(),
  isSearchOpen: false,
  closeSearch: vi.fn(),
  renameTab: vi.fn(),
  tabs: [] as Array<{
    id: string;
    browserUrl?: string;
    contentType?: string;
  }>,
};

vi.mock("../stores/tabStore", () => ({
  useTabStore: vi.fn((selector: (state: unknown) => unknown) => {
    return selector(mockTabState);
  }),
}));

describe("SplitContainer — browser tab integration", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    mockTabState.tabs = [];
  });

  it("renders BrowserView for browser-prefixed session IDs", async () => {
    const browserSessionId = `${BROWSER_SESSION_PREFIX}abc-123`;
    const layout: PaneNode = {
      type: "leaf",
      terminalSessionId: browserSessionId,
    };

    // Set up tab store with browser tab data
    mockTabState.tabs = [
      {
        id: "tab-1",
        browserUrl: "https://grafana.local:3000",
        contentType: "browser",
      },
    ];

    await act(async () => {
      render(
        <SplitContainer layout={layout} tabId="tab-1" isActive={true} />,
      );
    });

    // BrowserView should be rendered, not TerminalView
    expect(screen.getByTestId("browser-view")).toBeInTheDocument();
  });

  it("renders TerminalView for regular session IDs", async () => {
    const layout: PaneNode = {
      type: "leaf",
      terminalSessionId: "regular-session-123",
    };

    await act(async () => {
      render(
        <SplitContainer layout={layout} tabId="tab-1" isActive={true} />,
      );
    });

    // Should render terminal, not browser
    expect(screen.queryByTestId("browser-view")).not.toBeInTheDocument();
  });

  it("passes isActive to BrowserView", async () => {
    const browserSessionId = `${BROWSER_SESSION_PREFIX}abc-123`;
    const layout: PaneNode = {
      type: "leaf",
      terminalSessionId: browserSessionId,
    };

    mockTabState.tabs = [
      {
        id: "tab-1",
        browserUrl: "https://example.com",
        contentType: "browser",
      },
    ];

    await act(async () => {
      render(
        <SplitContainer layout={layout} tabId="tab-1" isActive={false} />,
      );
    });

    // BrowserView should still render (just not visible)
    expect(screen.getByTestId("browser-view")).toBeInTheDocument();
  });

  it("renders BrowserView with correct initial URL", async () => {
    const browserSessionId = `${BROWSER_SESSION_PREFIX}abc-123`;
    const layout: PaneNode = {
      type: "leaf",
      terminalSessionId: browserSessionId,
    };

    mockTabState.tabs = [
      {
        id: "tab-1",
        browserUrl: "https://grafana.local:3000/dashboard",
        contentType: "browser",
      },
    ];

    await act(async () => {
      render(
        <SplitContainer layout={layout} tabId="tab-1" isActive={true} />,
      );
    });

    const urlInput = screen.getByTestId("browser-url-input") as HTMLInputElement;
    expect(urlInput.value).toBe("https://grafana.local:3000/dashboard");
  });
});
