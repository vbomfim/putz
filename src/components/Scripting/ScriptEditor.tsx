/**
 * ScriptEditor — Monaco-powered editor for automation scripts and Cisco configs.
 *
 * Supports create and edit modes:
 * - Create: empty editor with default template
 * - Edit: pre-filled with existing script content
 *
 * Features:
 * - Monaco Editor with syntax highlighting and autocompletion
 * - JavaScript mode: Putz API completions (send, waitFor, etc.)
 * - Cisco IOS mode: IOS config syntax highlighting and command completions
 * - Theme sync with Putz themeStore
 *
 * Provides run, stop, save, and record controls.
 *
 * @module ScriptEditor
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ScriptWithContent,
  SaveScriptInput,
  ScriptLogEntry,
  ScriptStatus,
} from "./types";
import { DEFAULT_SCRIPT_CONTENT } from "./types";
import { MonacoEditor, type EditorLanguage } from "./MonacoEditor";

interface ScriptEditorProps {
  /** Script to edit (undefined = create mode). */
  script?: ScriptWithContent;
  /** Session ID to run/record against. */
  sessionId?: string;
  /** Whether a script is currently running. */
  isRunning?: boolean;
  /** Current run status. */
  runStatus?: ScriptStatus;
  /** Log entries from the current/last run. */
  logEntries?: ScriptLogEntry[];
  /** Called with validated input on save. */
  onSave: (input: SaveScriptInput) => void;
  /** Called when user clicks Run. */
  onRun?: (scriptId: string) => void;
  /** Called when user clicks Stop. */
  onStop?: () => void;
  /** Called when user starts recording. */
  onRecordStart?: () => void;
  /** Called when user stops recording. Returns generated script content. */
  onRecordStop?: () => void;
  /** Called when the editor is closed. */
  onClose?: () => void;
  /** Whether the form is currently saving. */
  isSaving?: boolean;
  /** Whether recording is active. */
  isRecording?: boolean;
}

/**
 * Script editor with code textarea, metadata fields, and execution controls.
 */
export function ScriptEditor({
  script,
  sessionId,
  isRunning = false,
  runStatus,
  logEntries = [],
  onSave,
  onRun,
  onStop,
  onRecordStart,
  onRecordStop,
  onClose,
  isSaving = false,
  isRecording = false,
}: ScriptEditorProps) {
  const isEdit = !!script;

  const [name, setName] = useState(script?.meta.name ?? "");
  const [description, setDescription] = useState(
    script?.meta.description ?? "",
  );
  const [content, setContent] = useState(
    script?.content ?? DEFAULT_SCRIPT_CONTENT,
  );
  const [isLoginScript, setIsLoginScript] = useState(
    script?.meta.isLoginScript ?? false,
  );
  const [editorLanguage, setEditorLanguage] =
    useState<EditorLanguage>("javascript");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom (scrollIntoView may not exist in jsdom)
  useEffect(() => {
    if (
      logEndRef.current &&
      typeof logEndRef.current.scrollIntoView === "function"
    ) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logEntries]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    } else if (name.length > 100) {
      newErrors.name = "Name must be 100 characters or fewer";
    }

    if (!content.trim()) {
      newErrors.content = "Script content is required";
    } else if (new Blob([content]).size > 512_000) {
      newErrors.content = "Script exceeds maximum size (512 KB)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, content]);

  const handleSave = useCallback(() => {
    if (!validate()) return;

    onSave({
      id: script?.meta.id,
      name: name.trim(),
      description: description.trim() || undefined,
      content,
      isLoginScript,
    });
  }, [name, description, content, isLoginScript, validate, onSave, script]);

  const handleRun = useCallback(() => {
    if (!script?.meta.id || !onRun) return;
    onRun(script.meta.id);
  }, [script, onRun]);

  /** Returns a CSS class for a log level. */
  const logLevelClass = (level: string): string => {
    switch (level) {
      case "error":
        return "script-log--error";
      case "warn":
        return "script-log--warn";
      case "output":
        return "script-log--output";
      default:
        return "script-log--info";
    }
  };

  /** Returns a status badge label. */
  const statusLabel = (status?: ScriptStatus): string => {
    switch (status) {
      case "running":
        return "⏳ Running";
      case "completed":
        return "✅ Completed";
      case "failed":
        return "❌ Failed";
      case "stopped":
        return "⏹ Stopped";
      default:
        return "";
    }
  };

  return (
    <div
      className="script-editor"
      data-testid="script-editor"
      role="dialog"
      aria-label={isEdit ? "Edit Script" : "Create Script"}
    >
      {/* Header */}
      <div className="script-editor__header">
        <h2>{isEdit ? "Edit Script" : "New Script"}</h2>
        {onClose && (
          <button
            className="script-editor__close"
            onClick={onClose}
            type="button"
            aria-label="Close editor"
            data-testid="script-editor-close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Metadata fields */}
      <div className="script-editor__fields">
        <div className="script-editor__field">
          <label htmlFor="script-name">Name</label>
          <input
            id="script-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            placeholder="e.g., Backup Config"
            data-testid="script-name-input"
          />
          {errors.name && (
            <span className="script-editor__error">{errors.name}</span>
          )}
        </div>
        <div className="script-editor__field">
          <label htmlFor="script-description">Description</label>
          <input
            id="script-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSaving}
            placeholder="Optional description"
            data-testid="script-description-input"
          />
        </div>
        <div className="script-editor__field script-editor__field--checkbox">
          <label>
            <input
              type="checkbox"
              checked={isLoginScript}
              onChange={(e) => setIsLoginScript(e.target.checked)}
              disabled={isSaving}
              data-testid="script-login-checkbox"
            />
            Run on session connect (login script)
          </label>
        </div>
      </div>

      {/* Code editor */}
      <div className="script-editor__code">
        <div className="script-editor__code-header">
          <label>Script</label>
          <div className="script-editor__language-toggle">
            <button
              type="button"
              className={`script-editor__lang-btn ${editorLanguage === "javascript" ? "script-editor__lang-btn--active" : ""}`}
              onClick={() => setEditorLanguage("javascript")}
              title="JavaScript — Putz automation scripts"
            >
              JS
            </button>
            <button
              type="button"
              className={`script-editor__lang-btn ${editorLanguage === "cisco-ios" ? "script-editor__lang-btn--active" : ""}`}
              onClick={() => setEditorLanguage("cisco-ios")}
              title="Cisco IOS — config syntax highlighting"
            >
              IOS
            </button>
          </div>
        </div>
        <div className="script-editor__monaco-wrapper">
          <MonacoEditor
            value={content}
            onChange={setContent}
            language={editorLanguage}
            readOnly={isSaving}
            onSave={handleSave}
            onRun={isEdit && sessionId ? handleRun : undefined}
          />
        </div>
        {errors.content && (
          <span className="script-editor__error">{errors.content}</span>
        )}
      </div>

      {/* Log output */}
      {logEntries.length > 0 && (
        <div
          className="script-editor__log"
          data-testid="script-log"
          role="log"
          aria-label="Script output"
        >
          <div className="script-editor__log-header">
            <span>Output</span>
            {runStatus && (
              <span
                className="script-editor__status"
                data-testid="script-run-status"
              >
                {statusLabel(runStatus)}
              </span>
            )}
          </div>
          <div className="script-editor__log-entries">
            {logEntries.map((entry, idx) => (
              <div
                key={idx}
                className={`script-log__entry ${logLevelClass(entry.level)}`}
              >
                <span className="script-log__time">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="script-log__level">[{entry.level}]</span>
                <span className="script-log__message">{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="script-editor__actions">
        {/* Recording controls */}
        {sessionId && !isRunning && (
          <button
            type="button"
            className={`script-editor__btn ${isRecording ? "script-editor__btn--danger" : "script-editor__btn--secondary"}`}
            onClick={isRecording ? onRecordStop : onRecordStart}
            disabled={isSaving}
            data-testid="script-record-btn"
          >
            {isRecording ? "⏹ Stop Recording" : "⏺ Record"}
          </button>
        )}

        {/* Run/Stop */}
        {isEdit && sessionId && (
          <>
            {isRunning ? (
              <button
                type="button"
                className="script-editor__btn script-editor__btn--danger"
                onClick={onStop}
                data-testid="script-stop-btn"
              >
                ⏹ Stop
              </button>
            ) : (
              <button
                type="button"
                className="script-editor__btn script-editor__btn--primary"
                onClick={handleRun}
                disabled={isSaving}
                data-testid="script-run-btn"
                title="Run script (Ctrl+Enter)"
              >
                ▶ Run
              </button>
            )}
          </>
        )}

        {/* Save */}
        <button
          type="button"
          className="script-editor__btn script-editor__btn--primary"
          onClick={handleSave}
          disabled={isSaving}
          data-testid="script-save-btn"
          title="Save script (Ctrl+S)"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>

        {/* Cancel/Close */}
        {onClose && (
          <button
            type="button"
            className="script-editor__btn script-editor__btn--secondary"
            onClick={onClose}
            disabled={isSaving}
            data-testid="script-cancel-btn"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
