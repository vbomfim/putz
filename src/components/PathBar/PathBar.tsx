/**
 * PathBar — Finder-style breadcrumb path bar + git status at the bottom.
 * @module
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import { parseBranchOutput, parseTagListOutput } from "../../lib/git-graph/gitParser";
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
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branches, setBranches] = useState<{ name: string; isRemote: boolean; isCurrent: boolean }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState("");
  const branchBtnRef = useRef<HTMLButtonElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
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

  // Open branch menu
  const toggleBranchMenu = useCallback(async () => {
    if (branchMenuOpen) { setBranchMenuOpen(false); return; }
    if (!git) return;
    try {
      const [branchRaw, tagRaw] = await Promise.all([
        invoke<string>("git_branches", { repoPath: git.repoRoot }),
        invoke<string>("git_tags", { repoPath: git.repoRoot }),
      ]);
      setBranches(parseBranchOutput(branchRaw));
      setTags(parseTagListOutput(tagRaw));
      setBranchFilter("");
      setBranchMenuOpen(true);
    } catch { /* ignore */ }
  }, [git, branchMenuOpen]);

  // Checkout a branch
  const handleCheckout = useCallback(async (branchName: string) => {
    if (!git) return;
    setBranchMenuOpen(false);
    try {
      await invoke<string>("git_checkout", { repoPath: git.repoRoot, branch: branchName });
      checkGit(git.repoRoot);
    } catch (e) {
      console.error("Checkout failed:", e);
    }
  }, [git, checkGit]);

  const handlePush = useCallback(async () => {
    if (!git) return;
    try {
      await invoke<string>("git_push", { repoPath: git.repoRoot });
      checkGit(git.repoRoot);
    } catch (e) {
      console.error("Push failed:", e);
    }
  }, [git, checkGit]);

  const handlePull = useCallback(async () => {
    if (!git) return;
    try {
      await invoke<string>("git_pull", { repoPath: git.repoRoot });
      checkGit(git.repoRoot);
    } catch (e) {
      console.error("Pull failed:", e);
    }
  }, [git, checkGit]);

  // Close branch menu on outside click
  useEffect(() => {
    if (!branchMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node) &&
          branchBtnRef.current && !branchBtnRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchMenuOpen]);

  if (!cwd) return null;

  const segments = pathSegments(cwd);
  const filteredBranches = branchFilter
    ? branches.filter((b) => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : branches;
  const filteredTags = branchFilter
    ? tags.filter((t) => t.toLowerCase().includes(branchFilter.toLowerCase()))
    : tags;

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
          <button
            ref={branchBtnRef}
            className="path-bar__git-branch"
            onClick={toggleBranchMenu}
            title="Switch branch"
          >
            ⎇ {git.branch} ▾
          </button>
          {git.ahead > 0 && (
            <button className="path-bar__git-action" onClick={handlePush} title={`Push ${git.ahead} commit${git.ahead > 1 ? "s" : ""}`}>
              ↑{git.ahead} ⬆
            </button>
          )}
          {git.behind > 0 && (
            <button className="path-bar__git-action path-bar__git-action--pull" onClick={handlePull} title={`Pull ${git.behind} commit${git.behind > 1 ? "s" : ""}`}>
              ↓{git.behind} ⬇
            </button>
          )}
          {git.ahead === 0 && git.behind === 0 && <span className="path-bar__git-sync">✓</span>}
          {git.dirty > 0 && <span className="path-bar__git-dirty">●{git.dirty}</span>}
          <button
            className="path-bar__git-tree"
            onClick={() => addGitGraphTab(undefined, git.repoRoot)}
            title="Open Git Graph"
          >
            🌳
          </button>

          {branchMenuOpen && (
            <div ref={branchMenuRef} className="path-bar__branch-menu">
              <input
                className="path-bar__branch-filter"
                type="text"
                placeholder="Filter branches…"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setBranchMenuOpen(false);
                  if (e.key === "Enter" && filteredBranches.length === 1) {
                    handleCheckout(filteredBranches[0].name);
                  }
                }}
                autoFocus
                spellCheck={false}
              />
              <div className="path-bar__branch-list">
                {filteredBranches.map((b) => (
                  <button
                    key={b.name}
                    className={`path-bar__branch-item ${b.isCurrent ? "path-bar__branch-item--current" : ""}`}
                    onClick={() => !b.isCurrent && handleCheckout(b.name)}
                    disabled={b.isCurrent}
                  >
                    {b.isCurrent && <span className="path-bar__branch-check">★</span>}
                    <span className={b.isRemote ? "path-bar__branch-remote" : ""}>{b.name}</span>
                  </button>
                ))}
                {filteredTags.length > 0 && (
                  <>
                    <div className="path-bar__branch-divider">Tags</div>
                    {filteredTags.map((t) => (
                      <button
                        key={"tag-" + t}
                        className="path-bar__branch-item path-bar__branch-item--tag"
                        onClick={() => handleCheckout(t)}
                      >
                        <span className="path-bar__tag-icon">🏷</span>
                        <span>{t}</span>
                      </button>
                    ))}
                  </>
                )}
                {filteredBranches.length === 0 && filteredTags.length === 0 && (
                  <span className="path-bar__branch-empty">No matches</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
