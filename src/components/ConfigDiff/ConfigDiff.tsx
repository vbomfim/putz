/**
 * Config Diff Viewer — side-by-side configuration comparison.
 *
 * Two paste panes for old/new configurations, with a colored unified diff
 * output showing additions (green), deletions (red), and unchanged lines.
 * Supports synchronized scrolling, line numbers, and text export.
 *
 * @module ConfigDiff
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { computeLineDiff, exportDiffAsText, type DiffLine } from "./diffEngine";
import "./ConfigDiff.css";

/** Props for the ConfigDiff component. */
interface ConfigDiffProps {
  /** Whether the diff viewer is visible. */
  isOpen: boolean;
  /** Callback to close the diff viewer. */
  onClose: () => void;
}

/** Maximum text size for diff inputs (1 MB). */
const MAX_INPUT_SIZE = 1_048_576;

export function ConfigDiff({ isOpen, onClose }: ConfigDiffProps) {
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [diff, setDiff] = useState<DiffLine[]>([]);
  const [hasComputed, setHasComputed] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  /** Computes the diff between the two panes. */
  const handleCompare = useCallback(() => {
    const result = computeLineDiff(oldText, newText);
    setDiff(result);
    setHasComputed(true);
  }, [oldText, newText]);

  /** Clears both panes and the diff output. */
  const handleClear = useCallback(() => {
    setOldText("");
    setNewText("");
    setDiff([]);
    setHasComputed(false);
  }, []);

  /** Exports the diff as text and copies to clipboard. */
  const handleExport = useCallback(() => {
    const text = exportDiffAsText(diff);
    navigator.clipboard.writeText(text).catch(() => {
      // Clipboard API may not be available in all contexts
    });
  }, [diff]);

  /** Validates input size before setting text. */
  const handleOldTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_INPUT_SIZE) {
        setOldText(value);
      }
    },
    [],
  );

  const handleNewTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_INPUT_SIZE) {
        setNewText(value);
      }
    },
    [],
  );

  /** Synchronized scrolling between panes. */
  const oldPaneRef = useRef<HTMLTextAreaElement>(null);
  const newPaneRef = useRef<HTMLTextAreaElement>(null);
  const isSyncingScroll = useRef(false);

  const handleOldScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (oldPaneRef.current && newPaneRef.current) {
      newPaneRef.current.scrollTop = oldPaneRef.current.scrollTop;
    }
    isSyncingScroll.current = false;
  }, []);

  const handleNewScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (oldPaneRef.current && newPaneRef.current) {
      oldPaneRef.current.scrollTop = newPaneRef.current.scrollTop;
    }
    isSyncingScroll.current = false;
  }, []);

  /** Close on Escape key. */
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const additions = diff.filter((l) => l.type === "add").length;
  const deletions = diff.filter((l) => l.type === "delete").length;

  return (
    <div className="config-diff" data-testid="config-diff">
      <div className="config-diff__header">
        <h2>Config Diff Viewer</h2>
        <div className="config-diff__controls">
          <button
            className="config-diff__btn config-diff__btn--primary"
            onClick={handleCompare}
            type="button"
            data-testid="config-diff-compare"
          >
            Compare
          </button>
          <button
            className="config-diff__btn config-diff__btn--secondary"
            onClick={handleExport}
            type="button"
            disabled={diff.length === 0}
            data-testid="config-diff-export"
          >
            Export
          </button>
          <button
            className="config-diff__btn config-diff__btn--secondary"
            onClick={handleClear}
            type="button"
            data-testid="config-diff-clear"
          >
            Clear
          </button>
          <button
            className="config-diff__close"
            onClick={onClose}
            type="button"
            aria-label="Close diff viewer"
            data-testid="config-diff-close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="config-diff__panes">
        <div className="config-diff__pane">
          <label className="config-diff__pane-label">Old Configuration</label>
          <textarea
            ref={oldPaneRef}
            className="config-diff__textarea"
            value={oldText}
            onChange={handleOldTextChange}
            onScroll={handleOldScroll}
            placeholder="Paste old configuration here..."
            spellCheck={false}
            data-testid="config-diff-old"
          />
        </div>
        <div className="config-diff__pane">
          <label className="config-diff__pane-label">New Configuration</label>
          <textarea
            ref={newPaneRef}
            className="config-diff__textarea"
            value={newText}
            onChange={handleNewTextChange}
            onScroll={handleNewScroll}
            placeholder="Paste new configuration here..."
            spellCheck={false}
            data-testid="config-diff-new"
          />
        </div>
      </div>

      {hasComputed && (
        <div
          className="config-diff__output"
          ref={diffRef}
          data-testid="config-diff-output"
        >
          <div className="config-diff__stats">
            <span className="config-diff__stat config-diff__stat--add">
              +{additions} addition{additions !== 1 ? "s" : ""}
            </span>
            <span className="config-diff__stat config-diff__stat--delete">
              -{deletions} deletion{deletions !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="config-diff__lines">
            {diff.length === 0 ? (
              <div className="config-diff__empty">
                Configurations are identical
              </div>
            ) : (
              diff.map((line, index) => (
                <div
                  key={index}
                  className={`config-diff__line config-diff__line--${line.type}`}
                  data-testid={`diff-line-${index}`}
                >
                  <span className="config-diff__line-num config-diff__line-num--old">
                    {line.oldLineNumber ?? ""}
                  </span>
                  <span className="config-diff__line-num config-diff__line-num--new">
                    {line.newLineNumber ?? ""}
                  </span>
                  <span className="config-diff__line-prefix">
                    {line.type === "add"
                      ? "+"
                      : line.type === "delete"
                        ? "-"
                        : " "}
                  </span>
                  <span className="config-diff__line-content">
                    {line.content}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
