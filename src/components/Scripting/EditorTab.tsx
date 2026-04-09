/**
 * EditorTab — Monaco editor rendered as a region tab.
 *
 * Handles loading file content, saving, language detection,
 * and integrating with the script system.
 *
 * @module EditorTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { MonacoEditor, type EditorLanguage } from "./MonacoEditor";
import type * as monaco from "monaco-editor";
import { fileRead, fileWrite, fileMtime, detectLanguage } from "./editorApi";
import { scriptGet, scriptSave } from "./scriptApi";
import type { SaveScriptInput } from "./types";
import { DEFAULT_SCRIPT_CONTENT } from "./types";
import { useLayoutStore } from "../../stores/layoutStore";
import "./Scripting.css";

interface EditorTabProps {
  /** File path to open (optional). */
  filePath?: string;
  /** Script ID to load (optional). */
  scriptId?: string;
  /** Region and tab IDs for renaming the tab on file load. */
  regionId: string;
  tabId: string;
}

/**
 * A full editor tab with Monaco, file I/O, and status bar.
 * Opens as a tab in a region — not a modal.
 */
export function EditorTab({ filePath, scriptId, regionId, tabId }: EditorTabProps) {
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState<EditorLanguage>("javascript");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const savedContentRef = useRef("");
  const lastMtimeRef = useRef<number>(0);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const renameTab = useLayoutStore((s) => s.renameTab);

  const handleFind = useCallback(() => {
    editorInstanceRef.current?.getAction("actions.find")?.run();
  }, []);

  const handleFindReplace = useCallback(() => {
    editorInstanceRef.current?.getAction("editor.action.startFindReplaceAction")?.run();
  }, []);

  const [showCompareInput, setShowCompareInput] = useState(false);
  const [comparePath, setComparePath] = useState("");
  const addDiffTab = useLayoutStore((s) => s.addDiffTab);

  const handleCompare = useCallback(() => {
    if (!comparePath.trim()) return;
    let resolvedPath = comparePath.trim();

    // If relative, resolve against current file's directory
    if (!resolvedPath.startsWith("/") && filePath) {
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      resolvedPath = `${dir}/${resolvedPath}`;
    }

    addDiffTab(undefined, filePath, resolvedPath);
    setShowCompareInput(false);
    setComparePath("");
  }, [comparePath, filePath, addDiffTab]);

  // Load file or script content on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (filePath) {
          const text = await fileRead(filePath);
          if (cancelled) return;
          setContent(text);
          savedContentRef.current = text;
          setLanguage(detectLanguage(filePath, text));
          // Store initial mtime for change detection
          try {
            lastMtimeRef.current = await fileMtime(filePath);
          } catch { /* ignore — polling will handle it */ }
          setStatusMessage(`Opened ${filePath}`);
        } else if (scriptId) {
          const script = await scriptGet(scriptId);
          if (cancelled) return;
          setContent(script.content);
          savedContentRef.current = script.content;
          setLanguage("javascript");
          renameTab(regionId, tabId, script.meta.name);
          setStatusMessage(`Loaded script: ${script.meta.name}`);
        } else {
          // New empty file
          setContent(DEFAULT_SCRIPT_CONTENT);
          savedContentRef.current = DEFAULT_SCRIPT_CONTENT;
          setLanguage("javascript");
          setStatusMessage("New file");
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatusMessage(`Error: ${msg}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [filePath, scriptId, regionId, tabId, renameTab]);

  // Poll file mtime every 2s — reload if changed externally
  useEffect(() => {
    if (!filePath) return;

    const interval = setInterval(async () => {
      try {
        const mtime = await fileMtime(filePath);
        if (mtime > lastMtimeRef.current && lastMtimeRef.current > 0) {
          // File changed on disk
          if (isDirty) {
            // User has unsaved changes — just notify
            setStatusMessage("⚠ File changed on disk (unsaved changes)");
            lastMtimeRef.current = mtime;
            return;
          }
          const text = await fileRead(filePath);
          setContent(text);
          savedContentRef.current = text;
          lastMtimeRef.current = mtime;
          setStatusMessage("File reloaded (changed on disk)");
        }
      } catch {
        // File may have been deleted — ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [filePath, isDirty]);

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setIsDirty(value !== savedContentRef.current);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (filePath) {
        await fileWrite(filePath, content);
        savedContentRef.current = content;
        setIsDirty(false);
        // Update mtime so the watcher doesn't trigger a reload
        try { lastMtimeRef.current = await fileMtime(filePath); } catch { /* ignore */ }
        setStatusMessage(`Saved ${filePath}`);
      } else if (scriptId) {
        const script = await scriptGet(scriptId);
        const input: SaveScriptInput = {
          id: scriptId,
          name: script.meta.name,
          content,
        };
        await scriptSave(input);
        savedContentRef.current = content;
        setIsDirty(false);
        setStatusMessage(`Saved script: ${script.meta.name}`);
      } else {
        setStatusMessage("No file path — use Save As");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatusMessage(`Save failed: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [filePath, scriptId, content]);

  // Auto-save: 2 seconds after the user stops typing (only for files with a path)
  useEffect(() => {
    if (!isDirty || (!filePath && !scriptId)) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 2000);
    return () => clearTimeout(timer);
  }, [isDirty, content, filePath, scriptId, handleSave]);

  if (isLoading) {
    return (
      <div className="editor-tab" data-testid="editor-tab">
        <div className="editor-tab__loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="editor-tab" data-testid="editor-tab">
      {/* Toolbar */}
      <div className="editor-tab__toolbar">
        <div className="editor-tab__toolbar-left">
          <span className="editor-tab__filepath" title={filePath || "Untitled"}>
            {filePath ? filePath.split("/").pop() : scriptId ? "Script" : "Untitled"}
            {isDirty && " •"}
          </span>
        </div>
        <div className="editor-tab__toolbar-right">
          <button
            type="button"
            className="editor-tab__tool-btn"
            onClick={handleFind}
            title="Find (⌘F)"
          >
            🔍
          </button>
          <button
            type="button"
            className="editor-tab__tool-btn"
            onClick={handleFindReplace}
            title="Find & Replace (⌘H)"
          >
            ⌥
          </button>
          {filePath && (
            <button
              type="button"
              className="editor-tab__tool-btn"
              onClick={() => setShowCompareInput((prev) => !prev)}
              title="Compare with another file"
            >
              📄
            </button>
          )}
          <div className="script-editor__language-toggle">
            {([
              ["javascript", "JS", "JavaScript"],
              ["python", "PY", "Python"],
              ["terraform", "TF", "Terraform / HCL"],
              ["jinja2", "J2", "Jinja2 Templates"],
              ["json", "JSON", "JSON (ARM, CloudFormation)"],
              ["yaml", "YAML", "YAML (Ansible, GCP DM)"],
              ["cisco-ios", "IOS", "Cisco IOS Config"],
            ] as const).map(([lang, label, title]) => (
              <button
                key={lang}
                type="button"
                className={`script-editor__lang-btn ${language === lang ? "script-editor__lang-btn--active" : ""}`}
                onClick={() => setLanguage(lang)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`editor-tab__save-btn ${isDirty ? "editor-tab__save-btn--dirty" : ""}`}
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            title="Save (⌘S) — auto-saves after 2s"
          >
            {isSaving ? "Saving…" : isDirty ? "● Save" : "✓ Saved"}
          </button>
        </div>
      </div>

      {/* Compare input bar */}
      {showCompareInput && (
        <div className="editor-tab__compare-bar">
          <span className="editor-tab__compare-label">Compare with:</span>
          <input
            className="editor-tab__compare-input"
            type="text"
            value={comparePath}
            onChange={(e) => setComparePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCompare();
              if (e.key === "Escape") { setShowCompareInput(false); setComparePath(""); }
            }}
            placeholder="path/to/other-file.cfg"
            autoFocus
          />
          <button
            type="button"
            className="editor-tab__save-btn"
            onClick={handleCompare}
            disabled={!comparePath.trim()}
          >
            Compare
          </button>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div className="editor-tab__error">{error}</div>
      )}

      {/* Monaco Editor */}
      <div className="editor-tab__editor">
        <MonacoEditor
          value={content}
          onChange={handleChange}
          language={language}
          readOnly={isSaving}
          onSave={handleSave}
          editorInstanceRef={editorInstanceRef}
        />
      </div>

      {/* Status bar */}
      <div className="editor-tab__status">
        <span>{statusMessage}</span>
        <span>{{ "cisco-ios": "Cisco IOS", python: "Python", terraform: "Terraform", jinja2: "Jinja2", json: "JSON", yaml: "YAML", javascript: "JavaScript" }[language]}</span>
      </div>
    </div>
  );
}
