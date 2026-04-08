/**
 * Unit tests for the BrowserView component.
 *
 * Tests cover: rendering, URL bar interaction, IPC lifecycle
 * (open/close/navigate/resize/visibility), and error states.
 *
 * Tags: [TDD], [BROWSER-TABS]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock Tauri event listener
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock CSS import
vi.mock("../components/Browser/BrowserView.css", () => ({}));

import { BrowserView } from "../components/Browser/BrowserView";

describe("BrowserView", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders the browser view container", () => {
      render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );
      expect(screen.getByTestId("browser-view")).toBeInTheDocument();
    });

    it("renders the URL toolbar", () => {
      render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );
      expect(screen.getByTestId("browser-toolbar")).toBeInTheDocument();
    });

    it("renders the URL input with initial URL", () => {
      render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );
      const input = screen.getByTestId("browser-url-input") as HTMLInputElement;
      expect(input.value).toBe("https://example.com");
    });

    it("renders refresh and go buttons", () => {
      render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );
      expect(screen.getByTestId("browser-refresh-btn")).toBeInTheDocument();
      expect(screen.getByTestId("browser-go-btn")).toBeInTheDocument();
    });

    it("renders the webview content area", () => {
      render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );
      expect(screen.getByTestId("browser-content")).toBeInTheDocument();
    });

    it("sets data-tab-id attribute", () => {
      render(
        <BrowserView browserId="tab-42" initialUrl="https://example.com" isActive={true} />,
      );
      expect(screen.getByTestId("browser-view")).toHaveAttribute(
        "data-tab-id",
        "tab-42",
      );
    });
  });

  describe("IPC lifecycle", () => {
    it("calls browser_open on mount with position and size", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("browser_open", {
        tabId: "tab-1",
        url: "https://example.com",
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      });
    });

    it("calls browser_close on unmount", async () => {
      let unmount: () => void;
      await act(async () => {
        const result = render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
        unmount = result.unmount;
      });

      mockInvoke.mockClear();

      act(() => {
        unmount!();
      });

      expect(mockInvoke).toHaveBeenCalledWith("browser_close", {
        tabId: "tab-1",
      });
    });

    it("calls browser_set_visible when isActive changes", async () => {
      const { rerender } = render(
        <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
      );

      mockInvoke.mockClear();

      await act(async () => {
        rerender(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={false} />,
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("browser_set_visible", {
        tabId: "tab-1",
        visible: false,
      });
    });
  });

  describe("URL navigation", () => {
    it("navigates when form is submitted", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      mockInvoke.mockClear();

      const input = screen.getByTestId("browser-url-input");
      fireEvent.change(input, { target: { value: "https://new-site.com" } });
      fireEvent.submit(screen.getByTestId("browser-go-btn").closest("form")!);

      expect(mockInvoke).toHaveBeenCalledWith("browser_navigate", {
        tabId: "tab-1",
        url: "https://new-site.com",
      });
    });

    it("auto-prepends https:// if no protocol specified", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      mockInvoke.mockClear();

      const input = screen.getByTestId("browser-url-input");
      fireEvent.change(input, { target: { value: "grafana.local:3000" } });
      fireEvent.submit(screen.getByTestId("browser-go-btn").closest("form")!);

      expect(mockInvoke).toHaveBeenCalledWith("browser_navigate", {
        tabId: "tab-1",
        url: "https://grafana.local:3000",
      });
    });

    it("does not navigate with empty URL", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      mockInvoke.mockClear();

      const input = screen.getByTestId("browser-url-input");
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.submit(screen.getByTestId("browser-go-btn").closest("form")!);

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "browser_navigate",
        expect.anything(),
      );
    });

    it("refresh button re-navigates to current URL", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      mockInvoke.mockClear();

      fireEvent.click(screen.getByTestId("browser-refresh-btn"));

      expect(mockInvoke).toHaveBeenCalledWith("browser_navigate", {
        tabId: "tab-1",
        url: "https://example.com",
      });
    });

    it("Escape key in URL input reverts to current URL", async () => {
      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      const input = screen.getByTestId("browser-url-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "https://other.com" } });
      expect(input.value).toBe("https://other.com");

      fireEvent.keyDown(input, { key: "Escape" });
      expect(input.value).toBe("https://example.com");
    });
  });

  describe("error handling", () => {
    it("shows error state when browser_open fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Webview creation failed"));

      await act(async () => {
        render(
          <BrowserView browserId="tab-1" initialUrl="https://example.com" isActive={true} />,
        );
      });

      expect(screen.getByTestId("browser-error")).toBeInTheDocument();
      expect(screen.getByText("Webview creation failed")).toBeInTheDocument();
    });
  });
});
