/**
 * DiffEditorTab — Side-by-side file comparison using Monaco diff editor.
 *
 * Opens two files and shows their differences with inline highlighting.
 * Perfect for comparing router configs (before/after, running/startup).
 *
 * @module DiffEditorTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import type * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { fileRead, detectLanguage } from "./editorApi";
import {
  registerCiscoIosLanguage,
  CISCO_IOS_LANGUAGE_ID,
} from "./languages/ciscoIos";
import { useThemeStore } from "../../stores/themeStore";
import { useLayoutStore } from "../../stores/layoutStore";
import "./Scripting.css";

loader.config({ monaco: monacoEditor });

// Track registration
let diffLanguagesRegistered = false;

interface DiffEditorTabProps {
  /** Left file path (original). */
  leftPath?: string;
  /** Right file path (modified). */
  rightPath?: string;
  /** Left content (if no path). */
  leftContent?: string;
  /** Right content (if no path). */
  rightContent?: string;
  /** Region and tab IDs for renaming. */
  regionId: string;
  tabId: string;
}

/** Build theme (reuse logic from MonacoEditor) */
function buildDiffTheme(
  colors: Record<string, string> | null | object,
): monaco.editor.IStandaloneThemeData {
  const c = (colors ?? {}) as Record<string, string>;
  const bg = c.background || "#1e1e2e";
  const fg = c.foreground || "#cdd6f4";
  const selection = c.selectionBackground || "#45475a";
  const isLight = hexLuminance(bg) > 0.5;

  return {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editor.selectionBackground": selection,
      "diffEditor.insertedTextBackground": isLight ? "#a6e3a133" : "#a6e3a120",
      "diffEditor.removedTextBackground": isLight ? "#f38ba833" : "#f38ba820",
      "diffEditor.insertedLineBackground": isLight ? "#a6e3a118" : "#a6e3a110",
      "diffEditor.removedLineBackground": isLight ? "#f38ba818" : "#f38ba810",
    },
  };
}

function hexLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const DIFF_THEME_ID = "putz-diff-theme";

export function DiffEditorTab({
  leftPath,
  rightPath,
  leftContent: leftContentProp,
  rightContent: rightContentProp,
  regionId,
  tabId,
}: DiffEditorTabProps) {
  const [leftContent, setLeftContent] = useState(leftContentProp || "");
  const [rightContent, setRightContent] = useState(rightContentProp || "");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inline, setInline] = useState(false);
  const [language, setLanguage] = useState<string>("plaintext");
  const monacoRef = useRef<typeof monaco | null>(null);
  const renameTab = useLayoutStore((s) => s.renameTab);

  // Load files
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [left, right] = await Promise.all([
          leftPath
            ? fileRead(leftPath)
            : Promise.resolve(leftContentProp || ""),
          rightPath
            ? fileRead(rightPath)
            : Promise.resolve(rightContentProp || ""),
        ]);
        if (cancelled) return;
        setLeftContent(left);
        setRightContent(right);

        // Detect language from either file
        const path = leftPath || rightPath || "";
        const lang = detectLanguage(path, left);
        setLanguage(lang === "cisco-ios" ? CISCO_IOS_LANGUAGE_ID : lang);

        // Set tab title
        const leftName = leftPath?.split("/").pop() || "Original";
        const rightName = rightPath?.split("/").pop() || "Modified";
        renameTab(regionId, tabId, `${leftName} ↔ ${rightName}`);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [
    leftPath,
    rightPath,
    leftContentProp,
    rightContentProp,
    regionId,
    tabId,
    renameTab,
  ]);

  const handleMount: DiffOnMount = useCallback((_editor, monacoInstance) => {
    monacoRef.current = monacoInstance;

    if (!diffLanguagesRegistered) {
      registerCiscoIosLanguage(monacoInstance);
      diffLanguagesRegistered = true;
    }

    const colors = useThemeStore.getState().activeColors;
    const themeData = buildDiffTheme(colors);
    monacoInstance.editor.defineTheme(DIFF_THEME_ID, themeData);
    monacoInstance.editor.setTheme(DIFF_THEME_ID);
  }, []);

  // Theme sync
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe(() => {
      const m = monacoRef.current;
      if (!m) return;
      const colors = useThemeStore.getState().activeColors;
      const themeData = buildDiffTheme(colors);
      m.editor.defineTheme(DIFF_THEME_ID, themeData);
      m.editor.setTheme(DIFF_THEME_ID);
    });
    return unsubscribe;
  }, []);

  if (isLoading) {
    return (
      <div className="editor-tab" data-testid="diff-editor-tab">
        <div className="editor-tab__loading">Loading diff…</div>
      </div>
    );
  }

  return (
    <div className="editor-tab" data-testid="diff-editor-tab">
      {/* Toolbar */}
      <div className="editor-tab__toolbar">
        <div className="editor-tab__toolbar-left">
          <span className="editor-tab__filepath">
            {leftPath?.split("/").pop() || "Original"}
            {" ↔ "}
            {rightPath?.split("/").pop() || "Modified"}
          </span>
        </div>
        <div className="editor-tab__toolbar-right">
          <label className="editor-tab__toggle-label">
            <input
              type="checkbox"
              checked={inline}
              onChange={(e) => setInline(e.target.checked)}
            />
            Inline
          </label>
        </div>
      </div>

      {error && <div className="editor-tab__error">{error}</div>}

      {/* Diff Editor */}
      <div className="editor-tab__editor">
        <DiffEditor
          height="100%"
          original={leftContent}
          modified={rightContent}
          language={language}
          theme={DIFF_THEME_ID}
          onMount={handleMount}
          options={{
            readOnly: true,
            renderSideBySide: !inline,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderIndicators: true,
            originalEditable: false,
            padding: { top: 8 },
          }}
          loading={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-secondary)",
              }}
            >
              Loading diff…
            </div>
          }
        />
      </div>

      {/* Status bar */}
      <div className="editor-tab__status">
        <span>{language === CISCO_IOS_LANGUAGE_ID ? "Cisco IOS" : "Text"}</span>
        <span>Diff View</span>
      </div>
    </div>
  );
}
