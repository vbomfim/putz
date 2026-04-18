/**
 * Markdown formatting toolbar shown above the Monaco editor when the active
 * language is `markdown`. Each button drives the editor through small,
 * focused operations (wrap inline, toggle line prefix, insert block).
 *
 * The toolbar receives the live editor instance via a ref so it can read the
 * current selection and apply edits without forcing the parent to plumb new
 * callbacks for every action.
 */
import { useCallback } from "react";
import type * as monaco from "monaco-editor";

interface MarkdownToolbarProps {
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
}

export function MarkdownToolbar({ editorRef }: MarkdownToolbarProps) {
  const wrapInline = useCallback((left: string, right: string = left, placeholder = "text") => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;
    const selected = model.getValueInRange(sel);
    const body = selected.length > 0 ? selected : placeholder;
    const replacement = `${left}${body}${right}`;
    editor.executeEdits("md-wrap", [{ range: sel, text: replacement, forceMoveMarkers: true }]);
    editor.focus();
  }, [editorRef]);

  const applyLinePrefix = useCallback((prefix: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;

    const startLine = sel.startLineNumber;
    const endLine = sel.endLineNumber;
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    for (let ln = startLine; ln <= endLine; ln++) {
      edits.push({
        range: {
          startLineNumber: ln,
          startColumn: 1,
          endLineNumber: ln,
          endColumn: 1,
        },
        text: prefix,
        forceMoveMarkers: true,
      });
    }
    editor.executeEdits("md-line-prefix", edits);
    editor.focus();
  }, [editorRef]);

  const insertBlock = useCallback((block: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelection();
    if (!sel) return;
    editor.executeEdits("md-block", [{ range: sel, text: block, forceMoveMarkers: true }]);
    editor.focus();
  }, [editorRef]);

  const insertCodeFence = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;
    const selected = model.getValueInRange(sel);
    if (selected.includes("\n") || selected.length === 0) {
      const body = selected || "code";
      insertBlock(`\n\`\`\`\n${body}\n\`\`\`\n`);
    } else {
      wrapInline("`", "`", "code");
    }
  }, [editorRef, insertBlock, wrapInline]);

  const insertTable = useCallback(() => {
    insertBlock(
      "\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| value | value | value |\n",
    );
  }, [insertBlock]);

  return (
    <div className="md-toolbar" data-testid="md-toolbar">
      <button type="button" className="md-toolbar__btn" title="Heading 1" onClick={() => applyLinePrefix("# ")}>H1</button>
      <button type="button" className="md-toolbar__btn" title="Heading 2" onClick={() => applyLinePrefix("## ")}>H2</button>
      <button type="button" className="md-toolbar__btn" title="Heading 3" onClick={() => applyLinePrefix("### ")}>H3</button>
      <span className="md-toolbar__sep" />
      <button type="button" className="md-toolbar__btn" title="Bold (⌘B)" onClick={() => wrapInline("**", "**", "bold")}><b>B</b></button>
      <button type="button" className="md-toolbar__btn" title="Italic (⌘I)" onClick={() => wrapInline("*", "*", "italic")}><i>I</i></button>
      <button type="button" className="md-toolbar__btn" title="Strikethrough" onClick={() => wrapInline("~~", "~~", "text")}><s>S</s></button>
      <button type="button" className="md-toolbar__btn" title="Inline code" onClick={() => wrapInline("`", "`", "code")}>{"</>"}</button>
      <span className="md-toolbar__sep" />
      <button type="button" className="md-toolbar__btn" title="Link (⌘K)" onClick={() => wrapInline("[", "](url)", "text")}>🔗</button>
      <button type="button" className="md-toolbar__btn" title="Image" onClick={() => insertBlock("![alt](url)")}>🖼</button>
      <span className="md-toolbar__sep" />
      <button type="button" className="md-toolbar__btn" title="Bulleted list" onClick={() => applyLinePrefix("- ")}>• List</button>
      <button type="button" className="md-toolbar__btn" title="Numbered list" onClick={() => applyLinePrefix("1. ")}>1. List</button>
      <button type="button" className="md-toolbar__btn" title="Task list" onClick={() => applyLinePrefix("- [ ] ")}>☐ Task</button>
      <button type="button" className="md-toolbar__btn" title="Block quote" onClick={() => applyLinePrefix("> ")}>❝ Quote</button>
      <span className="md-toolbar__sep" />
      <button type="button" className="md-toolbar__btn" title="Code block" onClick={insertCodeFence}>``` Block</button>
      <button type="button" className="md-toolbar__btn" title="Insert table" onClick={insertTable}>⌗ Table</button>
      <button type="button" className="md-toolbar__btn" title="Horizontal rule" onClick={() => insertBlock("\n---\n")}>― Rule</button>
    </div>
  );
}
