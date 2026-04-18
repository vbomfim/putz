/**
 * Monaco Editor wrapper for the Putz scripting system.
 *
 * Integrates Monaco Editor with:
 * - Cisco IOS language (syntax highlighting + completions)
 * - Putz API completions for JavaScript mode
 * - Theme sync with Putz themeStore
 * - Proper sizing in flex layouts
 *
 * @module MonacoEditor
 */
import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount, loader } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import * as monacoEditor from "monaco-editor";
import { registerCiscoIosLanguage, CISCO_IOS_LANGUAGE_ID } from "./languages/ciscoIos";
import { registerCiscoCompletions } from "./languages/ciscoCompletions";
import { registerPutzCompletions } from "./languages/putzCompletions";
import { registerTerraformLanguage, TERRAFORM_LANGUAGE_ID } from "./languages/terraformHcl";
import { registerJinja2Language, registerJinja2Completions, JINJA2_LANGUAGE_ID } from "./languages/jinja2";
import { useThemeStore } from "../../stores/themeStore";

// Use locally bundled Monaco instead of CDN (required for Tauri/offline)
loader.config({ monaco: monacoEditor });

export type EditorLanguage = "text" | "markdown" | "javascript" | "cisco-ios" | "python" | "terraform" | "json" | "yaml" | "jinja2";

interface MonacoEditorProps {
  /** Current editor content. */
  value: string;
  /** Called when content changes. */
  onChange: (value: string) => void;
  /** Language mode. */
  language: EditorLanguage;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Keyboard shortcut handlers passed through. */
  onSave?: () => void;
  onRun?: () => void;
  /** Ref to expose the editor instance for triggering actions. */
  editorInstanceRef?: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  /** Show hidden characters (whitespace, control chars, EOL markers). */
  showWhitespace?: boolean;
}

// Track whether languages have been registered (once per Monaco instance)
let languagesRegistered = false;

/**
 * Build a Monaco theme definition from Putz terminal colors.
 */
function buildPutzTheme(
  colors: Record<string, string> | null | object,
): monaco.editor.IStandaloneThemeData {
  const c = (colors ?? {}) as Record<string, string>;
  const bg = c.background || "#1e1e2e";
  const fg = c.foreground || "#cdd6f4";
  const cursor = c.cursor || "#f5e0dc";
  const selection = c.selectionBackground || "#45475a";

  const red = c["red"] || "#f38ba8";
  const green = c["green"] || "#a6e3a1";
  const yellow = c["yellow"] || "#f9e2af";
  const blue = c["blue"] || "#89b4fa";
  const magenta = c["magenta"] || "#cba6f7";
  const cyan = c["cyan"] || "#94e2d5";
  const brightBlack = c["brightBlack"] || "#585b70";
  const brightRed = c["brightRed"] || "#f38ba8";
  const brightYellow = c["brightYellow"] || "#f9e2af";
  const brightBlue = c["brightBlue"] || "#89dceb";

  // Detect if light theme via luminance
  const isLight = hexLuminance(bg) > 0.5;
  const lineHighlight = isLight
    ? blendAlpha(fg, 0.06)
    : blendAlpha(fg, 0.06);
  const lineNumber = isLight
    ? blendAlpha(fg, 0.4)
    : blendAlpha(fg, 0.35);

  return {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      // Comments
      { token: "comment", foreground: stripHash(brightBlack), fontStyle: "italic" },

      // Cisco IOS tokens
      { token: "keyword.command", foreground: stripHash(blue) },
      { token: "keyword.section", foreground: stripHash(magenta), fontStyle: "bold" },
      { token: "keyword.subcommand", foreground: stripHash(cyan) },
      { token: "keyword.routing", foreground: stripHash(blue) },
      { token: "keyword.action", foreground: stripHash(brightRed), fontStyle: "bold" },
      { token: "keyword.negation", foreground: stripHash(red), fontStyle: "bold" },
      { token: "keyword.protocol", foreground: stripHash(yellow) },
      { token: "keyword.port", foreground: stripHash(yellow) },
      { token: "type.interface", foreground: stripHash(green), fontStyle: "bold" },
      { token: "number.ip", foreground: stripHash(brightYellow) },
      { token: "number", foreground: stripHash(brightYellow) },
      { token: "string", foreground: stripHash(green) },
      { token: "identifier", foreground: stripHash(fg) },

      // JavaScript tokens (inherit most from base theme)
      { token: "keyword", foreground: stripHash(magenta) },
      { token: "string.js", foreground: stripHash(green) },
      { token: "number.js", foreground: stripHash(brightYellow) },
      { token: "delimiter", foreground: stripHash(brightBlue) },
      { token: "type", foreground: stripHash(yellow) },
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorCursor.foreground": cursor,
      "editor.selectionBackground": selection,
      "editor.lineHighlightBackground": lineHighlight,
      "editorLineNumber.foreground": lineNumber,
      "editorLineNumber.activeForeground": fg,
      "editorWidget.background": bg,
      "editorWidget.border": blendAlpha(fg, 0.15),
      "editorSuggestWidget.background": bg,
      "editorSuggestWidget.border": blendAlpha(fg, 0.15),
      "editorSuggestWidget.foreground": fg,
      "editorSuggestWidget.selectedBackground": selection,
      "input.background": blendAlpha(fg, 0.05),
      "input.foreground": fg,
      "input.border": blendAlpha(fg, 0.15),
      "focusBorder": stripHash(cyan),
      "scrollbarSlider.background": blendAlpha(fg, 0.1),
      "scrollbarSlider.hoverBackground": blendAlpha(fg, 0.2),
      "scrollbarSlider.activeBackground": blendAlpha(fg, 0.3),
    },
  };
}

function stripHash(hex: string): string {
  return hex.startsWith("#") ? hex.slice(1) : hex;
}

function hexLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function blendAlpha(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a}`;
}

const PUTZ_THEME_ID = "putz-theme";

/**
 * Monaco Editor wrapper that integrates with Putz theming
 * and provides Cisco IOS + Putz API language support.
 */
export function MonacoEditor({
  value,
  onChange,
  language,
  readOnly = false,
  onSave,
  onRun,
  editorInstanceRef,
  showWhitespace = false,
}: MonacoEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const eolDecorationsRef = useRef<string[]>([]);

  // Apply theme on mount and when themeStore changes
  const applyTheme = useCallback(() => {
    const m = monacoRef.current;
    if (!m) return;
    const colors = useThemeStore.getState().activeColors;
    const themeData = buildPutzTheme(colors);
    m.editor.defineTheme(PUTZ_THEME_ID, themeData);
    m.editor.setTheme(PUTZ_THEME_ID);
  }, []);

  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe(() => applyTheme());
    return unsubscribe;
  }, [applyTheme]);

  // Listen for putz-find event (from Cmd+F menu) — open Monaco find if focused
  useEffect(() => {
    const handlePutzFind = () => {
      const editor = editorRef.current;
      if (!editor) return;
      // Only trigger if this editor has DOM focus
      if (editor.hasTextFocus() || editor.getDomNode()?.contains(document.activeElement)) {
        editor.getAction("actions.find")?.run();
      }
    };
    window.addEventListener("putz-find", handlePutzFind);
    return () => window.removeEventListener("putz-find", handlePutzFind);
  }, []);

  const handleMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;

      // Expose to parent for triggering find/replace
      if (editorInstanceRef) {
        editorInstanceRef.current = editor;
      }

      // Register custom languages (once per Monaco instance)
      if (!languagesRegistered) {
        registerCiscoIosLanguage(monacoInstance);
        registerCiscoCompletions(monacoInstance);
        registerPutzCompletions(monacoInstance);
        registerTerraformLanguage(monacoInstance);
        registerJinja2Language(monacoInstance);
        registerJinja2Completions(monacoInstance);
        languagesRegistered = true;
      }

      // Define and apply Putz theme
      const colors = useThemeStore.getState().activeColors;
      const themeData = buildPutzTheme(colors);
      monacoInstance.editor.defineTheme(PUTZ_THEME_ID, themeData);
      monacoInstance.editor.setTheme(PUTZ_THEME_ID);

      // Register keyboard shortcuts
      if (onSave) {
        editor.addCommand(
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
          () => onSave(),
        );
      }
      if (onRun) {
        editor.addCommand(
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
          () => onRun(),
        );
      }

      // Ensure Find & Replace keybindings work (Cmd+F / Cmd+H)
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyF,
        () => editor.getAction("actions.find")?.run(),
      );
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyH,
        () => editor.getAction("editor.action.startFindReplaceAction")?.run(),
      );

      // Markdown formatting shortcuts — only act when current language is markdown
      const wrapSelection = (left: string, right: string = left) => {
        const model = editor.getModel();
        const sel = editor.getSelection();
        if (!model || !sel) return;
        if (model.getLanguageId() !== "markdown") return;
        const text = model.getValueInRange(sel);
        const replacement = `${left}${text}${right}`;
        editor.executeEdits("md-wrap", [{ range: sel, text: replacement, forceMoveMarkers: true }]);
        // Place cursor inside if no selection
        if (text.length === 0) {
          const pos = editor.getPosition();
          if (pos) {
            editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column - right.length });
          }
        }
        editor.focus();
      };

      // Cmd/Ctrl+B → bold
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyB,
        () => wrapSelection("**"),
      );
      // Cmd/Ctrl+I → italic
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyI,
        () => wrapSelection("*"),
      );
      // Cmd/Ctrl+K → link [sel](url)
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK,
        () => {
          const model = editor.getModel();
          const sel = editor.getSelection();
          if (!model || !sel) return;
          if (model.getLanguageId() !== "markdown") return;
          const text = model.getValueInRange(sel);
          const replacement = `[${text || "text"}](url)`;
          editor.executeEdits("md-link", [{ range: sel, text: replacement, forceMoveMarkers: true }]);
          editor.focus();
        },
      );

      // Focus the editor
      editor.focus();
    },
    [applyTheme, onSave, onRun],
  );

  const handleChange = useCallback(
    (val: string | undefined) => {
      onChange(val ?? "");
    },
    [onChange],
  );

  // EOL marker decorations: show ↵ (LF) or ␍↵ (CRLF) at end of every line.
  // Monaco's renderWhitespace handles spaces/tabs and renderControlCharacters
  // handles stray CR — but neither draws anything for the line break itself.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) {
      eolDecorationsRef.current = editor.deltaDecorations(eolDecorationsRef.current, []);
      return;
    }
    if (!showWhitespace) {
      eolDecorationsRef.current = editor.deltaDecorations(eolDecorationsRef.current, []);
      return;
    }
    const monacoNs = monacoRef.current;
    if (!monacoNs) return;
    const eol = model.getEOL();
    const marker = eol === "\r\n" ? "␍↵" : "↵";
    const lineCount = model.getLineCount();
    const newDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (let line = 1; line < lineCount; line++) {
      const col = model.getLineMaxColumn(line);
      newDecorations.push({
        range: new monacoNs.Range(line, col, line, col),
        options: {
          after: {
            content: marker,
            inlineClassName: "putz-eol-marker",
          },
        },
      });
    }
    eolDecorationsRef.current = editor.deltaDecorations(eolDecorationsRef.current, newDecorations);

    const disposable = model.onDidChangeContent(() => {
      const ed = editorRef.current;
      const m = ed?.getModel();
      const ns = monacoRef.current;
      if (!ed || !m || !ns) return;
      const eolNow = m.getEOL();
      const markerNow = eolNow === "\r\n" ? "␍↵" : "↵";
      const lc = m.getLineCount();
      const next: monaco.editor.IModelDeltaDecoration[] = [];
      for (let line = 1; line < lc; line++) {
        const col = m.getLineMaxColumn(line);
        next.push({
          range: new ns.Range(line, col, line, col),
          options: { after: { content: markerNow, inlineClassName: "putz-eol-marker" } },
        });
      }
      eolDecorationsRef.current = ed.deltaDecorations(eolDecorationsRef.current, next);
    });
    return () => disposable.dispose();
  }, [showWhitespace, value]);

  const monacoLanguage =
    language === "text" ? "plaintext" :
    language === "cisco-ios" ? CISCO_IOS_LANGUAGE_ID :
    language === "terraform" ? TERRAFORM_LANGUAGE_ID :
    language === "jinja2" ? JINJA2_LANGUAGE_ID :
    language; // js, python, json, yaml are built-in Monaco IDs

  return (
    <Editor
      height="100%"
      language={monacoLanguage}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme={PUTZ_THEME_ID}
      options={{
        readOnly,
        renderWhitespace: showWhitespace ? "all" : "selection",
        renderControlCharacters: showWhitespace,
        minimap: { enabled: true, maxColumn: 80 },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
        lineNumbers: "on",
        renderLineHighlight: "line",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        parameterHints: { enabled: true },
        bracketPairColorization: { enabled: true },
        guides: {
          bracketPairs: true,
          indentation: true,
        },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        padding: { top: 8 },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
      loading={
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-secondary)",
          fontSize: "0.875rem",
        }}>
          Loading editor…
        </div>
      }
    />
  );
}
