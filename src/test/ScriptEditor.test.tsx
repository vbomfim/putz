/**
 * Unit tests for the ScriptEditor component.
 *
 * Tests rendering, form validation, create/edit modes,
 * save/run/stop/record controls, and keyboard shortcuts.
 *
 * Tags: [TDD], [AC-7], [AC-8], [AC-9]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScriptEditor } from "../components/Scripting/ScriptEditor";
import type { ScriptWithContent } from "../components/Scripting/types";
import { DEFAULT_SCRIPT_CONTENT } from "../components/Scripting/types";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock MonacoEditor — renders a textarea for testability
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _mockMonacoValue = "";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _mockMonacoOnChange: ((val: string) => void) | null = null;
vi.mock("../components/Scripting/MonacoEditor", () => ({
  MonacoEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (v: string) => void;
    readOnly?: boolean;
  }) => {
    _mockMonacoValue = value;
    _mockMonacoOnChange = onChange;
    return (
      <textarea
        data-testid="script-content-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
      />
    );
  },
}));

const mockOnSave = vi.fn();
const mockOnRun = vi.fn();
const mockOnStop = vi.fn();
const mockOnRecordStart = vi.fn();
const mockOnRecordStop = vi.fn();
const mockOnClose = vi.fn();

function createMockScript(
  overrides: Partial<ScriptWithContent> = {},
): ScriptWithContent {
  return {
    meta: {
      id: "test-script-id",
      name: "Test Script",
      description: "A test automation script",
      filename: "test-script.js",
      isLoginScript: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      ...(overrides as Record<string, unknown>),
    },
    content: 'send("show version");\nlog("done");',
    ...overrides,
  };
}

describe("ScriptEditor", () => {
  beforeEach(() => {
    mockOnSave.mockReset();
    mockOnRun.mockReset();
    mockOnStop.mockReset();
    mockOnRecordStart.mockReset();
    mockOnRecordStop.mockReset();
    mockOnClose.mockReset();
  });

  // ─── Rendering ──────────────────────────────────────────────

  it("renders in create mode", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    expect(screen.getByTestId("script-editor")).toBeInTheDocument();
    expect(screen.getByText("New Script")).toBeInTheDocument();
  });

  it("renders in edit mode", () => {
    const script = createMockScript();
    render(<ScriptEditor script={script} onSave={mockOnSave} />);
    expect(screen.getByText("Edit Script")).toBeInTheDocument();
  });

  it("has dialog role", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const editor = screen.getByTestId("script-editor");
    expect(editor.getAttribute("role")).toBe("dialog");
  });

  it("has aria-label in create mode", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const editor = screen.getByTestId("script-editor");
    expect(editor.getAttribute("aria-label")).toBe("Create Script");
  });

  it("has aria-label in edit mode", () => {
    const script = createMockScript();
    render(<ScriptEditor script={script} onSave={mockOnSave} />);
    const editor = screen.getByTestId("script-editor");
    expect(editor.getAttribute("aria-label")).toBe("Edit Script");
  });

  // ─── Form fields ────────────────────────────────────────────

  it("shows name input", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    expect(screen.getByTestId("script-name-input")).toBeInTheDocument();
  });

  it("shows description input", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    expect(screen.getByTestId("script-description-input")).toBeInTheDocument();
  });

  it("shows script content textarea", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    expect(screen.getByTestId("script-content-textarea")).toBeInTheDocument();
  });

  it("shows login script checkbox", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    expect(screen.getByTestId("script-login-checkbox")).toBeInTheDocument();
  });

  it("pre-fills form in edit mode", () => {
    const script = createMockScript();
    render(<ScriptEditor script={script} onSave={mockOnSave} />);

    const nameInput = screen.getByTestId(
      "script-name-input",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Test Script");

    const descInput = screen.getByTestId(
      "script-description-input",
    ) as HTMLInputElement;
    expect(descInput.value).toBe("A test automation script");

    const textarea = screen.getByTestId(
      "script-content-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('send("show version");\nlog("done");');
  });

  it("shows default template in create mode", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const textarea = screen.getByTestId(
      "script-content-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_SCRIPT_CONTENT);
  });

  // ─── Validation ─────────────────────────────────────────────

  it("shows error for empty name on save", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const nameInput = screen.getByTestId("script-name-input");
    fireEvent.change(nameInput, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("script-save-btn"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("shows error for empty content on save", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const nameInput = screen.getByTestId("script-name-input");
    fireEvent.change(nameInput, { target: { value: "My Script" } });

    const textarea = screen.getByTestId("script-content-textarea");
    fireEvent.change(textarea, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("script-save-btn"));
    expect(screen.getByText("Script content is required")).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("shows error for name exceeding max length", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const nameInput = screen.getByTestId("script-name-input");
    fireEvent.change(nameInput, { target: { value: "a".repeat(101) } });

    fireEvent.click(screen.getByTestId("script-save-btn"));
    expect(
      screen.getByText("Name must be 100 characters or fewer"),
    ).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  // ─── Save callback ──────────────────────────────────────────

  it("calls onSave with valid input in create mode", () => {
    render(<ScriptEditor onSave={mockOnSave} />);
    const nameInput = screen.getByTestId("script-name-input");
    fireEvent.change(nameInput, { target: { value: "My Script" } });

    const descInput = screen.getByTestId("script-description-input");
    fireEvent.change(descInput, { target: { value: "A script" } });

    fireEvent.click(screen.getByTestId("script-save-btn"));

    expect(mockOnSave).toHaveBeenCalledTimes(1);
    const saved = mockOnSave.mock.calls[0][0];
    expect(saved.name).toBe("My Script");
    expect(saved.description).toBe("A script");
    expect(saved.content).toBe(DEFAULT_SCRIPT_CONTENT);
    expect(saved.id).toBeUndefined();
  });

  it("calls onSave with script ID in edit mode", () => {
    const script = createMockScript();
    render(<ScriptEditor script={script} onSave={mockOnSave} />);
    fireEvent.click(screen.getByTestId("script-save-btn"));

    expect(mockOnSave).toHaveBeenCalledTimes(1);
    const saved = mockOnSave.mock.calls[0][0];
    expect(saved.id).toBe("test-script-id");
  });

  // ─── Close/Cancel ───────────────────────────────────────────

  it("calls onClose when close button is clicked", () => {
    render(<ScriptEditor onSave={mockOnSave} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId("script-editor-close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<ScriptEditor onSave={mockOnSave} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId("script-cancel-btn"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // ─── Run/Stop controls ─────────────────────────────────────

  it("shows run button in edit mode with session", () => {
    const script = createMockScript();
    render(
      <ScriptEditor
        script={script}
        sessionId="session-1"
        onSave={mockOnSave}
        onRun={mockOnRun}
      />,
    );
    expect(screen.getByTestId("script-run-btn")).toBeInTheDocument();
  });

  it("does not show run button in create mode", () => {
    render(
      <ScriptEditor
        sessionId="session-1"
        onSave={mockOnSave}
        onRun={mockOnRun}
      />,
    );
    expect(screen.queryByTestId("script-run-btn")).not.toBeInTheDocument();
  });

  it("does not show run button without session", () => {
    const script = createMockScript();
    render(
      <ScriptEditor script={script} onSave={mockOnSave} onRun={mockOnRun} />,
    );
    expect(screen.queryByTestId("script-run-btn")).not.toBeInTheDocument();
  });

  it("calls onRun when run button is clicked", () => {
    const script = createMockScript();
    render(
      <ScriptEditor
        script={script}
        sessionId="session-1"
        onSave={mockOnSave}
        onRun={mockOnRun}
      />,
    );
    fireEvent.click(screen.getByTestId("script-run-btn"));
    expect(mockOnRun).toHaveBeenCalledWith("test-script-id");
  });

  it("shows stop button when running", () => {
    const script = createMockScript();
    render(
      <ScriptEditor
        script={script}
        sessionId="session-1"
        isRunning={true}
        onSave={mockOnSave}
        onStop={mockOnStop}
      />,
    );
    expect(screen.getByTestId("script-stop-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("script-run-btn")).not.toBeInTheDocument();
  });

  it("calls onStop when stop button is clicked", () => {
    const script = createMockScript();
    render(
      <ScriptEditor
        script={script}
        sessionId="session-1"
        isRunning={true}
        onSave={mockOnSave}
        onStop={mockOnStop}
      />,
    );
    fireEvent.click(screen.getByTestId("script-stop-btn"));
    expect(mockOnStop).toHaveBeenCalledTimes(1);
  });

  // ─── Recording controls ────────────────────────────────────

  it("shows record button when session is available", () => {
    render(
      <ScriptEditor
        sessionId="session-1"
        onSave={mockOnSave}
        onRecordStart={mockOnRecordStart}
      />,
    );
    expect(screen.getByTestId("script-record-btn")).toBeInTheDocument();
    expect(screen.getByText("⏺ Record")).toBeInTheDocument();
  });

  it("shows stop recording button when recording", () => {
    render(
      <ScriptEditor
        sessionId="session-1"
        isRecording={true}
        onSave={mockOnSave}
        onRecordStop={mockOnRecordStop}
      />,
    );
    expect(screen.getByText("⏹ Stop Recording")).toBeInTheDocument();
  });

  it("hides record button when running", () => {
    const script = createMockScript();
    render(
      <ScriptEditor
        script={script}
        sessionId="session-1"
        isRunning={true}
        onSave={mockOnSave}
        onRecordStart={mockOnRecordStart}
        onStop={mockOnStop}
      />,
    );
    expect(screen.queryByTestId("script-record-btn")).not.toBeInTheDocument();
  });

  // ─── Log output ─────────────────────────────────────────────

  it("shows log entries when present", () => {
    render(
      <ScriptEditor
        onSave={mockOnSave}
        logEntries={[
          {
            timestamp: "2024-01-01T00:00:00Z",
            level: "info",
            message: "Hello",
          },
          {
            timestamp: "2024-01-01T00:00:01Z",
            level: "error",
            message: "Oops",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("script-log")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Oops")).toBeInTheDocument();
  });

  it("does not show log section when no entries", () => {
    render(<ScriptEditor onSave={mockOnSave} logEntries={[]} />);
    expect(screen.queryByTestId("script-log")).not.toBeInTheDocument();
  });

  it("shows run status when provided", () => {
    render(
      <ScriptEditor
        onSave={mockOnSave}
        runStatus="completed"
        logEntries={[
          { timestamp: "2024-01-01T00:00:00Z", level: "info", message: "Done" },
        ]}
      />,
    );
    expect(screen.getByTestId("script-run-status")).toBeInTheDocument();
    expect(screen.getByText("✅ Completed")).toBeInTheDocument();
  });

  // ─── Disabled during save ───────────────────────────────────

  it("disables save button when saving", () => {
    render(<ScriptEditor onSave={mockOnSave} isSaving={true} />);
    const saveBtn = screen.getByTestId("script-save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("disables inputs when saving", () => {
    render(<ScriptEditor onSave={mockOnSave} isSaving={true} />);
    const nameInput = screen.getByTestId(
      "script-name-input",
    ) as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);
    const textarea = screen.getByTestId(
      "script-content-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
