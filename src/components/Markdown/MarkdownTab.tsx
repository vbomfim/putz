/**
 * MarkdownTab — Rendered markdown viewer as a tab.
 *
 * Renders markdown files with proper formatting. Auto-reloads
 * when the file changes on disk (polls mtime like EditorTab).
 *
 * @module MarkdownTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "./MarkdownTab.css";

interface MarkdownTabProps {
  filePath: string;
  regionId: string;
  tabId: string;
}

export function MarkdownTab({ filePath, regionId, tabId }: MarkdownTabProps) {
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastMtimeRef = useRef<number>(0);
  const renameTab = useLayoutStore((s) => s.renameTab);
  const addEditorTab = useLayoutStore((s) => s.addEditorTab);

  // Load file
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const text = await invoke<string>("file_read", { path: filePath });
        if (cancelled) return;
        setContent(text);
        try { lastMtimeRef.current = await invoke<number>("file_mtime", { path: filePath }); } catch { /* no-op */ }
        const name = filePath.split("/").pop() || filePath;
        renameTab(regionId, tabId, `📖 ${name}`);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [filePath, regionId, tabId, renameTab]);

  // Poll for changes
  useEffect(() => {
    if (!filePath) return;
    const interval = setInterval(async () => {
      try {
        const mtime = await invoke<number>("file_mtime", { path: filePath });
        if (mtime > lastMtimeRef.current && lastMtimeRef.current > 0) {
          const text = await invoke<string>("file_read", { path: filePath });
          setContent(text);
          lastMtimeRef.current = mtime;
        }
      } catch { /* no-op */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [filePath]);

  const handleEdit = useCallback(() => {
    addEditorTab(undefined, filePath);
  }, [addEditorTab, filePath]);

  if (isLoading) {
    return <div className="markdown-tab"><div className="markdown-tab__loading">Loading…</div></div>;
  }

  if (error) {
    return <div className="markdown-tab"><div className="markdown-tab__error">{error}</div></div>;
  }

  return (
    <div className="markdown-tab">
      <div className="markdown-tab__toolbar">
        <span className="markdown-tab__filepath">{filePath.split("/").pop()}</span>
        <button className="markdown-tab__edit-btn" onClick={handleEdit} title="Open in editor">
          ✏️ Edit
        </button>
      </div>
      <div className="markdown-tab__content">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </div>
    </div>
  );
}
