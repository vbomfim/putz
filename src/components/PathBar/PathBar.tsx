/**
 * PathBar — Finder-style breadcrumb path bar + git status at the bottom.
 * @module
 */
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "./PathBar.css";

interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  repoRoot: string;
}

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
  const [git, setGit] = useState<GitInfo | null>(null);
  const focusedRegionId = useLayoutStore((s) => s.focusedRegionId);
  const regions = useLayoutStore((s) => s.regions);
  const addGitGraphTab = useLayoutStore((s) => s.addGitGraphTab);

  const region = regions[focusedRegionId];
  const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
  const sessionId = activeTab?.type === "terminal" ? activeTab.sessionId : null;

  const checkGit = useCallback(async (path: string) => {
    try {
      const root = await invoke<string>("git_repo_root", { path });
      const raw = await invoke<string>("git_status_summary", { path: root });
      const [branch, ahead, behind, dirty] = raw.split("\n");
      setGit({
        branch: branch || "",
        ahead: parseInt(ahead || "0", 10),
        behind: parseInt(behind || "0", 10),
        dirty: parseInt(dirty || "0", 10),
        repoRoot: root,
      });
    } catch {
      setGit(null);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) { setCwd(null); setGit(null); return; }
    invoke<string>("pty_cwd", { sessionId })
      .then((v) => { setCwd(v); checkGit(v); })
      .catch(() => { setCwd(null); setGit(null); });
  }, [sessionId, checkGit]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId && detail?.cwd) {
        setCwd(detail.cwd);
        checkGit(detail.cwd);
      }
    };
    window.addEventListener("putz-cwd-change", handler);
    return () => window.removeEventListener("putz-cwd-change", handler);
  }, [sessionId, checkGit]);

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

      {git && (
        <div className="path-bar__git">
          <span className="path-bar__git-branch">⎇ {git.branch}</span>
          {git.ahead > 0 && <span className="path-bar__git-ahead">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="path-bar__git-behind">↓{git.behind}</span>}
          {git.ahead === 0 && git.behind === 0 && <span className="path-bar__git-sync">✓</span>}
          {git.dirty > 0 && <span className="path-bar__git-dirty">●{git.dirty}</span>}
          <button
            className="path-bar__git-tree"
            onClick={() => addGitGraphTab(undefined, git.repoRoot)}
            title="Open Git Graph"
          >
            🌳
          </button>
        </div>
      )}
    </div>
  );
}
