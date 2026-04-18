/**
 * EditorTab — Monaco editor rendered as a region tab.
 *
 * Handles loading file content, saving, language detection,
 * and integrating with the script system.
 *
 * @module EditorTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MonacoEditor, type EditorLanguage } from "./MonacoEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { formatMarkdownTables } from "./markdownFormat";
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
export function EditorTab({ filePath: initialFilePath, scriptId, regionId, tabId }: EditorTabProps) {
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState<EditorLanguage>("text");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [currentPath, setCurrentPath] = useState(initialFilePath || "");
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState("");
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
  const [showPreview, setShowPreview] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const isSyncingRef = useRef(false);
  const addDiffTab = useLayoutStore((s) => s.addDiffTab);

  const handleCompare = useCallback(() => {
    if (!comparePath.trim()) return;
    let resolvedPath = comparePath.trim();

    // If relative, resolve against current file's directory
    if (!resolvedPath.startsWith("/") && currentPath) {
      const sepIdx = Math.max(currentPath.lastIndexOf("/"), currentPath.lastIndexOf("\\"));
      const dir = currentPath.substring(0, sepIdx);
      const sep = currentPath.includes("\\") ? "\\" : "/";
      resolvedPath = `${dir}${sep}${resolvedPath}`;
    }

    addDiffTab(undefined, currentPath, resolvedPath);
    setShowCompareInput(false);
    setComparePath("");
  }, [comparePath, currentPath, addDiffTab]);

  // Load file or script content on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (initialFilePath) {
          const text = await fileRead(initialFilePath);
          if (cancelled) return;
          setContent(text);
          savedContentRef.current = text;
          setLanguage(detectLanguage(initialFilePath, text));
          try {
            lastMtimeRef.current = await fileMtime(initialFilePath);
          } catch { /* ignore */ }
          setStatusMessage(`Opened ${initialFilePath}`);
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
  }, [initialFilePath, scriptId, regionId, tabId, renameTab]);

  // Poll file mtime every 2s — reload if changed externally
  useEffect(() => {
    if (!currentPath) return;

    const interval = setInterval(async () => {
      try {
        const mtime = await fileMtime(currentPath);
        if (mtime > lastMtimeRef.current && lastMtimeRef.current > 0) {
          if (isDirty) {
            setStatusMessage("⚠ File changed on disk (unsaved changes)");
            lastMtimeRef.current = mtime;
            return;
          }
          const text = await fileRead(currentPath);
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
  }, [currentPath, isDirty]);

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setIsDirty(value !== savedContentRef.current);
  }, []);

  const handleSave = useCallback(async () => {
    if (!currentPath && !scriptId) {
      // No path — show Save As
      setShowSaveAs(true);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      // For markdown buffers, pretty-align pipe tables before writing.
      // Apply the formatted text back into the editor so the visible buffer
      // matches what hits disk and we don't immediately re-mark the file dirty.
      let toWrite = content;
      if (language === "markdown") {
        const formatted = formatMarkdownTables(content);
        if (formatted !== content) {
          toWrite = formatted;
          setContent(formatted);
        }
      }
      if (currentPath) {
        await fileWrite(currentPath, toWrite);
        savedContentRef.current = toWrite;
        setIsDirty(false);
        try { lastMtimeRef.current = await fileMtime(currentPath); } catch { /* ignore */ }
        setStatusMessage(`Saved ${currentPath}`);
      } else if (scriptId) {
        const script = await scriptGet(scriptId);
        const input: SaveScriptInput = {
          id: scriptId,
          name: script.meta.name,
          content: toWrite,
        };
        await scriptSave(input);
        savedContentRef.current = toWrite;
        setIsDirty(false);
        setStatusMessage(`Saved script: ${script.meta.name}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatusMessage(`Save failed: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [currentPath, scriptId, content, language]);

  // Sync scroll: editor → preview when both are visible.
  useEffect(() => {
    if (!showPreview || language !== "markdown") return;
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const dispose = editor.onDidScrollChange(() => {
      if (isSyncingRef.current) return;
      const preview = previewRef.current;
      if (!preview) return;
      const scrollTop = editor.getScrollTop();
      const scrollHeight = editor.getScrollHeight();
      const visible = editor.getLayoutInfo().height;
      const max = Math.max(1, scrollHeight - visible);
      const ratio = Math.min(1, Math.max(0, scrollTop / max));
      const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
      isSyncingRef.current = true;
      preview.scrollTop = ratio * previewMax;
      requestAnimationFrame(() => { isSyncingRef.current = false; });
    });
    return () => dispose.dispose();
  }, [showPreview, language, content]);

  const handleSaveAs = useCallback(async () => {
    const path = saveAsPath.trim();
    if (!path) return;

    setIsSaving(true);
    setError(null);
    try {
      await fileWrite(path, content);
      savedContentRef.current = content;
      setCurrentPath(path);
      setIsDirty(false);
      setShowSaveAs(false);
      setSaveAsPath("");
      setLanguage(detectLanguage(path, content));
      renameTab(regionId, tabId, path.split("/").pop() || path);
      try { lastMtimeRef.current = await fileMtime(path); } catch { /* ignore */ }
      setStatusMessage(`Saved as ${path}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [saveAsPath, content, regionId, tabId, renameTab]);

  // Auto-save: 2 seconds after the user stops typing (only for files with a path)
  useEffect(() => {
    if (!isDirty || (!currentPath && !scriptId)) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 2000);
    return () => clearTimeout(timer);
  }, [isDirty, content, currentPath, scriptId, handleSave]);

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
          <span className="editor-tab__filepath" title={currentPath || "Untitled"}>
            {currentPath ? currentPath.split("/").pop() : scriptId ? "Script" : "Untitled"}
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
          {currentPath && (
            <button
              type="button"
              className="editor-tab__tool-btn"
              onClick={() => setShowCompareInput((prev) => !prev)}
              title="Compare with another file"
            >
              📄
            </button>
          )}
          {language === "markdown" && currentPath && (
            <button
              type="button"
              className="editor-tab__tool-btn"
              onClick={() => useLayoutStore.getState().addMarkdownTab(undefined, currentPath)}
              title="Open Markdown preview in a new tab"
            >
              👁
            </button>
          )}
          {language === "markdown" && (
            <button
              type="button"
              className={`editor-tab__tool-btn ${showPreview ? "editor-tab__tool-btn--active" : ""}`}
              onClick={() => setShowPreview((v) => !v)}
              title={showPreview ? "Hide live preview" : "Show live preview side-by-side"}
            >
              ⇆
            </button>
          )}
          <button
            type="button"
            className={`editor-tab__tool-btn ${showWhitespace ? "editor-tab__tool-btn--active" : ""}`}
            onClick={() => setShowWhitespace((v) => !v)}
            title={showWhitespace ? "Hide whitespace / line endings" : "Show whitespace, control chars, line endings (LF / CRLF)"}
          >
            ¶
          </button>
          <div className="script-editor__language-toggle">
            {([
              ["text", "TXT", "Plain Text"],
              ["markdown", "MD", "Markdown"],
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
            className={`editor-tab__save-btn ${(isDirty || !currentPath) ? "editor-tab__save-btn--dirty" : ""}`}
            onClick={handleSave}
            disabled={isSaving || (!isDirty && !!currentPath)}
            title={currentPath ? "Save (⌘S) — auto-saves after 2s" : "Save As (⌘S)"}
          >
            {isSaving ? "Saving…" : !currentPath ? "Save As…" : isDirty ? "● Save" : "✓ Saved"}
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

      {/* Save As bar */}
      {showSaveAs && (
        <div className="editor-tab__compare-bar">
          <span className="editor-tab__compare-label">Save as:</span>
          <input
            className="editor-tab__compare-input"
            type="text"
            value={saveAsPath}
            onChange={(e) => setSaveAsPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveAs();
              if (e.key === "Escape") { setShowSaveAs(false); setSaveAsPath(""); }
            }}
            placeholder="/full/path/to/filename.cfg"
            autoFocus
          />
          <button
            type="button"
            className="editor-tab__save-btn"
            onClick={handleSaveAs}
            disabled={!saveAsPath.trim()}
          >
            Save
          </button>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div className="editor-tab__error">{error}</div>
      )}

      {/* Markdown formatting toolbar */}
      {language === "markdown" && (
        <MarkdownToolbar editorRef={editorInstanceRef} />
      )}

      {/* Monaco Editor (with optional live preview pane) */}
      <div className={`editor-tab__editor ${language === "markdown" && showPreview ? "editor-tab__editor--split" : ""}`}>
        <div className="editor-tab__editor-pane">
          <MonacoEditor
            value={content}
            onChange={handleChange}
            language={language}
            readOnly={isSaving}
            onSave={handleSave}
            editorInstanceRef={editorInstanceRef}
            showWhitespace={showWhitespace}
          />
        </div>
        {language === "markdown" && showPreview && (
          <div className="editor-tab__preview-pane" ref={previewRef}>
            <div className="editor-tab__preview-content">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="editor-tab__status">
        <span>{statusMessage}</span>
        <span>{{ text: "Plain Text", markdown: "Markdown", "cisco-ios": "Cisco IOS", python: "Python", terraform: "Terraform", jinja2: "Jinja2", json: "JSON", yaml: "YAML", javascript: "JavaScript" }[language]}</span>
      </div>
    </div>
  );
}
