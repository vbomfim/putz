/**
 * Unit tests for the ScriptRunner component.
 *
 * Tests rendering, status display, log entries,
 * stop/clear controls, and accessibility.
 *
 * Tags: [TDD], [AC-8], [AC-9]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScriptRunner } from "../components/Scripting/ScriptRunner";
import type { ScriptLogEntry } from "../components/Scripting/types";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockOnStop = vi.fn();
const mockOnClear = vi.fn();

function createLogEntries(): ScriptLogEntry[] {
  return [
    {
      timestamp: "2024-01-01T00:00:00Z",
      level: "info",
      message: "Starting script",
    },
    {
      timestamp: "2024-01-01T00:00:01Z",
      level: "output",
      message: "Router> show version",
    },
    {
      timestamp: "2024-01-01T00:00:02Z",
      level: "warn",
      message: "Slow response",
    },
    {
      timestamp: "2024-01-01T00:00:03Z",
      level: "error",
      message: "Timeout reached",
    },
  ];
}

describe("ScriptRunner", () => {
  // ─── Rendering ──────────────────────────────────────────────

  it("renders the runner panel", () => {
    render(<ScriptRunner status="running" logEntries={[]} />);
    expect(screen.getByTestId("script-runner")).toBeInTheDocument();
  });

  it("has log role and aria-label", () => {
    render(<ScriptRunner status="running" logEntries={[]} />);
    const runner = screen.getByTestId("script-runner");
    expect(runner.getAttribute("role")).toBe("log");
    expect(runner.getAttribute("aria-label")).toBe("Script execution output");
  });

  // ─── Status display ─────────────────────────────────────────

  it("shows running status", () => {
    render(<ScriptRunner status="running" logEntries={[]} />);
    expect(screen.getByTestId("script-runner-status")).toHaveTextContent(
      "Running…",
    );
  });

  it("shows completed status", () => {
    render(<ScriptRunner status="completed" logEntries={[]} />);
    expect(screen.getByTestId("script-runner-status")).toHaveTextContent(
      "Completed",
    );
  });

  it("shows failed status", () => {
    render(<ScriptRunner status="failed" logEntries={[]} />);
    expect(screen.getByTestId("script-runner-status")).toHaveTextContent(
      "Failed",
    );
  });

  it("shows stopped status", () => {
    render(<ScriptRunner status="stopped" logEntries={[]} />);
    expect(screen.getByTestId("script-runner-status")).toHaveTextContent(
      "Stopped",
    );
  });

  it("shows pending status", () => {
    render(<ScriptRunner status="pending" logEntries={[]} />);
    expect(screen.getByTestId("script-runner-status")).toHaveTextContent(
      "Pending…",
    );
  });

  // ─── Log entries ────────────────────────────────────────────

  it("renders log entries", () => {
    const entries = createLogEntries();
    render(<ScriptRunner status="completed" logEntries={entries} />);
    expect(screen.getByText("Starting script")).toBeInTheDocument();
    expect(screen.getByText("Router> show version")).toBeInTheDocument();
    expect(screen.getByText("Slow response")).toBeInTheDocument();
    expect(screen.getByText("Timeout reached")).toBeInTheDocument();
  });

  it("shows waiting message when running with no entries", () => {
    render(<ScriptRunner status="running" logEntries={[]} />);
    expect(screen.getByText("Waiting for output…")).toBeInTheDocument();
  });

  it("shows error message when provided", () => {
    render(
      <ScriptRunner
        status="failed"
        logEntries={[]}
        error="Script execution timed out"
      />,
    );
    expect(screen.getByTestId("script-runner-error")).toBeInTheDocument();
    expect(
      screen.getByText("Error: Script execution timed out"),
    ).toBeInTheDocument();
  });

  it("shows start time when provided", () => {
    render(
      <ScriptRunner
        status="running"
        logEntries={[]}
        startedAt="2024-01-01T10:00:00Z"
      />,
    );
    // The formatted time is locale-dependent, just check the prefix
    const startedText = screen.getByText(/^Started:/);
    expect(startedText).toBeInTheDocument();
  });

  // ─── Stop/Clear controls ────────────────────────────────────

  it("shows stop button when running", () => {
    render(
      <ScriptRunner status="running" logEntries={[]} onStop={mockOnStop} />,
    );
    expect(screen.getByTestId("script-runner-stop")).toBeInTheDocument();
  });

  it("calls onStop when stop is clicked", () => {
    mockOnStop.mockReset();
    render(
      <ScriptRunner status="running" logEntries={[]} onStop={mockOnStop} />,
    );
    fireEvent.click(screen.getByTestId("script-runner-stop"));
    expect(mockOnStop).toHaveBeenCalledTimes(1);
  });

  it("shows clear button when not running", () => {
    render(
      <ScriptRunner status="completed" logEntries={[]} onClear={mockOnClear} />,
    );
    expect(screen.getByTestId("script-runner-clear")).toBeInTheDocument();
  });

  it("calls onClear when clear is clicked", () => {
    mockOnClear.mockReset();
    render(
      <ScriptRunner status="completed" logEntries={[]} onClear={mockOnClear} />,
    );
    fireEvent.click(screen.getByTestId("script-runner-clear"));
    expect(mockOnClear).toHaveBeenCalledTimes(1);
  });

  it("hides stop button when not running", () => {
    render(
      <ScriptRunner status="completed" logEntries={[]} onStop={mockOnStop} />,
    );
    expect(screen.queryByTestId("script-runner-stop")).not.toBeInTheDocument();
  });

  it("hides clear button when running", () => {
    render(
      <ScriptRunner status="running" logEntries={[]} onClear={mockOnClear} />,
    );
    expect(screen.queryByTestId("script-runner-clear")).not.toBeInTheDocument();
  });

  it("shows stop button when pending", () => {
    render(
      <ScriptRunner status="pending" logEntries={[]} onStop={mockOnStop} />,
    );
    expect(screen.getByTestId("script-runner-stop")).toBeInTheDocument();
  });
});
