/**
 * PathBar — macOS Finder-style breadcrumb path bar at the bottom.
 *
 * Shows the active terminal's CWD as clickable path segments.
 * Clicking a segment sends `cd <path>` to the terminal.
 * Listens for `putz-cwd-change` events for instant updates.
 *
 * @module
 */
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "./PathBar.css";

/** Split a path into segments with cumulative paths. */
function pathSegments(fullPath: string): { name: string; path: string }[] {
  const sep = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(sep).filter(Boolean);
  const segments: { name: string; path: string }[] = [];
  let cumulative = fullPath.startsWith("/") ? "" : "";
  for (const part of parts) {
    cumulative += sep + part;
    segments.push({ name: part, path: cumulative });
  }
  return segments;
}

export function PathBar() {
  const [cwd, setCwd] = useState<string | null>(null);
  const focusedRegionId = useLayoutStore((s) => s.focusedRegionId);
  const regions = useLayoutStore((s) => s.regions);

  // Get the active terminal session ID
  const region = regions[focusedRegionId];
  const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
  const sessionId = activeTab?.type === "terminal" ? activeTab.sessionId : null;

  // Fetch CWD on session change
  useEffect(() => {
    if (!sessionId) { setCwd(null); return; }
    invoke<string>("pty_cwd", { sessionId })
      .then(setCwd)
      .catch(() => setCwd(null));
  }, [sessionId]);

  // Listen for CWD change events (instant updates)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId && detail?.cwd) {
        setCwd(detail.cwd);
      }
    };
    window.addEventListener("putz-cwd-change", handler);
    return () => window.removeEventListener("putz-cwd-change", handler);
  }, [sessionId]);

  const handleSegmentClick = useCallback((path: string) => {
    if (!sessionId) return;
    const escaped = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
    const data = Array.from(new TextEncoder().encode(`cd "${escaped}"\n`));
    invoke("pty_write", { sessionId, data }).catch(() => {});
  }, [sessionId]);

  if (!cwd) return null;

  const segments = pathSegments(cwd);

  return (
    <div className="path-bar">
      {segments.map((seg, i) => (
        <span key={seg.path} className="path-bar__segment-wrapper">
          {i > 0 && <span className="path-bar__sep">›</span>}
          <button
            className="path-bar__segment"
            onClick={() => handleSegmentClick(seg.path)}
            title={seg.path}
          >
            <span className="path-bar__icon">📁</span>
            {seg.name}
          </button>
        </span>
      ))}
    </div>
  );
}
