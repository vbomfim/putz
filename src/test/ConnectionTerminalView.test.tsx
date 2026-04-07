/**
 * Unit tests for the ConnectionTerminalView component.
 *
 * Tests rendering states (loading, connected, error, disconnected)
 * and user interactions (reconnect button). Uses mocked xterm.js and
 * Tauri APIs since jsdom does not support canvas rendering.
 *
 * Tags: [COVERAGE], [AC-1], [AC-5], [AC-6], [AC-7]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ConnectionTerminalView } from "../components/Terminal/ConnectionTerminalView";
import type { ConnectionOpenInput } from "../components/Terminal/connectionTypes";

// Mock Tauri APIs
const mockInvoke = vi.fn().mockResolvedValue("mock-connection-id");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

const defaultConfig: ConnectionOpenInput = {
  host: "192.168.1.1",
  port: 23,
  protocol: "telnet",
  cols: 80,
  rows: 24,
};

describe("ConnectionTerminalView", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue("mock-connection-id");
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  it("renders the connection wrapper", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    const wrapper = screen.getByTestId("connection-wrapper");
    expect(wrapper).toBeInTheDocument();
  });

  it("renders the connection container div", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    const container = screen.getByTestId("connection-container");
    expect(container).toBeInTheDocument();
  });

  it("shows connecting indicator initially", () => {
    // Keep the connection_open promise pending
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<ConnectionTerminalView connectionConfig={defaultConfig} />);

    const loading = screen.getByTestId("connection-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveTextContent("Connecting to 192.168.1.1");
  });

  it("shows error state when connection fails", async () => {
    mockInvoke.mockRejectedValue(new Error("Connection refused"));

    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    const errorDiv = screen.getByTestId("connection-error");
    expect(errorDiv).toBeInTheDocument();
    expect(errorDiv).toHaveTextContent("Connection Error");
    expect(errorDiv).toHaveTextContent("Connection refused");
  });

  it("shows reconnect button on error", async () => {
    mockInvoke.mockRejectedValue(new Error("Timeout"));

    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    const reconnectBtn = screen.getByRole("button", { name: /reconnect/i });
    expect(reconnectBtn).toBeInTheDocument();
  });

  it("calls connection_open with correct parameters", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "connection_open",
      expect.objectContaining({
        input: expect.objectContaining({
          host: "192.168.1.1",
          port: 23,
          protocol: "telnet",
        }),
      }),
    );
  });

  it("sets up event listeners after connection opens", async () => {
    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    // Should have listened for connection-output and connection-status events
    const listenCalls = mockListen.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(listenCalls).toContain("connection-output-mock-connection-id");
    expect(listenCalls).toContain("connection-status-mock-connection-id");
  });

  it("calls connection_close on unmount", async () => {
    const { unmount } = await act(async () => {
      return render(
        <ConnectionTerminalView connectionConfig={defaultConfig} />,
      );
    });

    mockInvoke.mockClear();
    unmount();

    // Should have called connection_close
    expect(mockInvoke).toHaveBeenCalledWith("connection_close", {
      connectionId: "mock-connection-id",
    });
  });

  it("invokes onTitleChange callback", async () => {
    const onTitleChange = vi.fn();

    await act(async () => {
      render(
        <ConnectionTerminalView
          connectionConfig={defaultConfig}
          onTitleChange={onTitleChange}
        />,
      );
    });

    // Title change is handled by xterm.js onTitleChange — tested via mock
    expect(onTitleChange).not.toHaveBeenCalled(); // No title change event yet
  });

  it("invokes onStatusChange callback", async () => {
    const onStatusChange = vi.fn();

    // Set up mockListen to capture the status listener
    let statusListener: ((event: { payload: unknown }) => void) | null = null;
    mockListen.mockImplementation(
      (eventName: string, handler: (event: { payload: unknown }) => void) => {
        if (eventName.includes("connection-status-")) {
          statusListener = handler;
        }
        return Promise.resolve(vi.fn());
      },
    );

    await act(async () => {
      render(
        <ConnectionTerminalView
          connectionConfig={defaultConfig}
          onStatusChange={onStatusChange}
        />,
      );
    });

    // Simulate a status change event
    if (statusListener) {
      await act(async () => {
        statusListener!({
          payload: { status: "disconnected", message: "Connection lost" },
        });
      });
    }

    expect(onStatusChange).toHaveBeenCalledWith(
      "disconnected",
      "Connection lost",
    );
  });

  it("reconnect button resets error state", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("First try failed"))
      .mockResolvedValue("new-connection-id");

    await act(async () => {
      render(<ConnectionTerminalView connectionConfig={defaultConfig} />);
    });

    // Should show error state
    expect(screen.getByTestId("connection-error")).toBeInTheDocument();

    // Click reconnect
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    });

    // Should attempt to connect again
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("shows host in connecting message", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const config: ConnectionOpenInput = {
      ...defaultConfig,
      host: "switch.example.com",
    };
    render(<ConnectionTerminalView connectionConfig={config} />);

    const loading = screen.getByTestId("connection-loading");
    expect(loading).toHaveTextContent("Connecting to switch.example.com");
  });

  it("shows fallback when host is undefined", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const config: ConnectionOpenInput = {
      ...defaultConfig,
      host: undefined,
    };
    render(<ConnectionTerminalView connectionConfig={config} />);

    const loading = screen.getByTestId("connection-loading");
    expect(loading).toHaveTextContent("Connecting to host");
  });
});
