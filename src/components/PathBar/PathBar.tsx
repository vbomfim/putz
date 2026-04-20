/**
 * PathBar — Finder-style breadcrumb path bar + git status at the bottom.
 * @module
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import { useBookmarksStore } from "../../stores/bookmarksStore";
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
  const isWindows = fullPath.includes("\\") || /^[A-Za-z]:/.test(fullPath);
  const sep = isWindows ? "\\" : "/";
  const parts = fullPath.split(/[/\\]/).filter(Boolean);
  const segments: { name: string; path: string }[] = [];

  if (fullPath.startsWith("/")) {
    // Unix root
    segments.push({ name: "/", path: "/" });
    let cumulative = "";
    for (const part of parts) {
      cumulative += "/" + part;
      segments.push({ name: part, path: cumulative });
    }
  } else if (/^[A-Za-z]:/.test(fullPath)) {
    // Windows drive root (C:\...)
    const drive = parts[0]!; // "C:"
    segments.push({ name: drive + sep, path: drive + sep });
    let cumulative = drive;
    for (let i = 1; i < parts.length; i++) {
      cumulative += sep + parts[i];
      segments.push({ name: parts[i]!, path: cumulative });
    }
  } else {
    // Relative or unknown
    let cumulative = "";
    for (const part of parts) {
      cumulative += (cumulative ? sep : "") + part;
      segments.push({ name: part, path: cumulative });
    }
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
    invoke("pty_write", { sessionId, data }).then(() => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("putz-cwd-change", { detail: { sessionId, cwd: path } }));
      }, 300);
    }).catch(() => {});
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

  const [openCrumb, setOpenCrumb] = useState<string | null>(null);
  const crumbMenuRef = useRef<HTMLDivElement>(null);
  const [crumbMenuStyle, setCrumbMenuStyle] = useState<React.CSSProperties>({});
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const bookmarksBtnRef = useRef<HTMLButtonElement>(null);
  const bookmarksMenuRef = useRef<HTMLDivElement>(null);
  const [bookmarksMenuStyle, setBookmarksMenuStyle] = useState<React.CSSProperties>({});
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const bookmarkFolders = useBookmarksStore((s) => s.folders);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);
  const crumbBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Now playing radio
  const [radioName, setRadioName] = useState<string>("");
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setRadioName(detail?.playing ? detail.name : "");
    };
    window.addEventListener("putz-radio-change", handler);
    return () => window.removeEventListener("putz-radio-change", handler);
  }, []);

  const toggleCrumbMenu = useCallback((segPath: string) => {
    setOpenCrumb((prev) => prev === segPath ? null : segPath);
  }, []);

  // Close crumb menu on outside click
  useEffect(() => {
    if (!openCrumb) return;
    const handler = (e: MouseEvent) => {
      if (crumbMenuRef.current && !crumbMenuRef.current.contains(e.target as Node)) {
        setOpenCrumb(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openCrumb]);

  // Close bookmarks menu on outside click
  useEffect(() => {
    if (!bookmarksOpen) return;
    const handler = (e: MouseEvent) => {
      if (bookmarksMenuRef.current && !bookmarksMenuRef.current.contains(e.target as Node) &&
          bookmarksBtnRef.current && !bookmarksBtnRef.current.contains(e.target as Node)) {
        setBookmarksOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bookmarksOpen]);

  // Position bookmarks menu aligned to ★ button
  useLayoutEffect(() => {
    if (!bookmarksOpen || !bookmarksBtnRef.current) return;
    const rect = bookmarksBtnRef.current.getBoundingClientRect();
    let left = rect.left;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 268;
    setBookmarksMenuStyle({ position: "fixed", left, bottom: window.innerHeight - rect.top + 2, zIndex: 300, minWidth: 240, maxWidth: 320, maxHeight: 300 });
  }, [bookmarksOpen]);

  // Position crumb menu aligned to the clicked segment
  useLayoutEffect(() => {
    if (!openCrumb) return;
    const btn = crumbBtnRefs.current.get(openCrumb);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 268;
    setCrumbMenuStyle({ position: "fixed", left, bottom: window.innerHeight - rect.top + 2, zIndex: 300, minWidth: 220, maxWidth: 320, maxHeight: 280 });
  }, [openCrumb]);

  const handleBookmarkClick = useCallback((bm: { path: string; type: string }) => {
    if (bm.type === "folder") {
      handleSegmentClick(bm.path);
    } else {
      const regionId = useLayoutStore.getState().focusedRegionId;
      useLayoutStore.getState().addEditorTab(regionId, bm.path);
    }
    setBookmarksOpen(false);
  }, [handleSegmentClick]);

  // Get root bookmarks sorted
  const rootBookmarks = bookmarks
    .filter((b) => b.folderId === null)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  const sortedFolders = bookmarkFolders
    .sort((a, b) => a.sortIndex - b.sortIndex);

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
      {/* ★ Bookmarks button */}
      <button
        ref={bookmarksBtnRef}
        className={`path-bar__bookmarks-btn ${bookmarksOpen ? "path-bar__bookmarks-btn--active" : ""}`}
        onClick={() => setBookmarksOpen((p) => !p)}
        title="Bookmarks"
      >
        ★
      </button>
      {bookmarksOpen && createPortal(
        <div ref={bookmarksMenuRef} className="path-bar__bookmarks-menu" style={bookmarksMenuStyle}>
          {rootBookmarks.length === 0 && sortedFolders.length === 0 && (
            <span className="path-bar__crumb-loading">No bookmarks</span>
          )}
          {sortedFolders.map((folder) => {
            const children = bookmarks
              .filter((b) => b.folderId === folder.id)
              .sort((a, b) => a.sortIndex - b.sortIndex);
            return (
              <BookmarkFolderItem key={folder.id} folder={folder} children={children}
                onSelect={handleBookmarkClick} onClose={() => setBookmarksOpen(false)} />
            );
          })}
          {rootBookmarks.map((bm) => (
            <div key={bm.id} className="path-bar__crumb-item path-bar__bookmark-item">
              <button
                className="path-bar__crumb-name"
                onClick={() => handleBookmarkClick(bm)}
                title={bm.path}
                style={{ flex: 1 }}
              >
                {bm.type === "folder" ? "📁" : "📄"} {bm.name}
              </button>
              <button
                className="path-bar__crumb-star path-bar__crumb-star--active"
                onClick={() => removeBookmark(bm.id)}
                title="Remove from bookmarks"
              >★</button>
            </div>
          ))}
        </div>,
        document.body,
      )}

      {segments.map((seg, i) => (
        <span key={seg.path} className="path-bar__segment-wrapper">
          {i > 0 && <span className="path-bar__sep">›</span>}
          <button
            ref={(el) => { if (el) crumbBtnRefs.current.set(seg.path, el); }}
            className={`path-bar__segment ${openCrumb === seg.path ? "path-bar__segment--active" : ""}`}
            onClick={() => toggleCrumbMenu(seg.path)}
            title={seg.path}
          >
            <span className="path-bar__icon">📁</span>
            {seg.name}
          </button>
          {openCrumb === seg.path && createPortal(
            <div ref={crumbMenuRef} className="path-bar__crumb-menu" style={crumbMenuStyle}>
              <CrumbTree
                path={seg.path}
                onSelect={(dirPath) => {
                  setOpenCrumb(null);
                  handleSegmentClick(dirPath);
                }}
              />
            </div>,
            document.body,
          )}
        </span>
      ))}

      {radioName && (
        <span className="path-bar__radio">📻 {radioName}</span>
      )}

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

/** Bookmark folder with expandable children in the ★ dropdown. */
function BookmarkFolderItem({ folder, children, onSelect, onClose }: {
  folder: { id: string; name: string };
  children: { id: string; name: string; path: string; type: string }[];
  onSelect: (bm: { path: string; type: string }) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="path-bar__crumb-item path-bar__bookmark-item">
        <button className="path-bar__crumb-chevron" onClick={() => setExpanded((p) => !p)}>
          {expanded ? "▾" : "▸"}
        </button>
        <span className="path-bar__crumb-name" style={{ fontWeight: 600 }}>📁 {folder.name}</span>
      </div>
      {expanded && children.map((bm) => (
        <button key={bm.id} className="path-bar__crumb-item path-bar__bookmark-item"
          style={{ paddingLeft: 22 }}
          onClick={() => { onSelect(bm); onClose(); }}
          title={bm.path}>
          <span>{bm.type === "folder" ? "📁" : "📄"}</span>
          <span className="path-bar__crumb-name">{bm.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Recursive lazy-loading directory tree for the breadcrumb picker. */
function CrumbTree({ path, onSelect, depth = 0 }: { path: string; onSelect: (dirPath: string) => void; depth?: number }) {
  const [entries, setEntries] = useState<{ name: string; path: string; isDir: boolean }[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const addBookmark = useBookmarksStore((s) => s.addBookmark);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);

  useEffect(() => {
    invoke<{ name: string; path: string; isDir: boolean }[]>("dir_list", { path })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [path]);

  const handleFileClick = useCallback((filePath: string) => {
    const regionId = useLayoutStore.getState().focusedRegionId;
    useLayoutStore.getState().addEditorTab(regionId, filePath);
  }, []);

  if (!entries) return <span className="path-bar__crumb-loading" style={{ paddingLeft: depth * 14 + 10 }}>…</span>;
  if (entries.length === 0) return <span className="path-bar__crumb-loading" style={{ paddingLeft: depth * 14 + 10 }}>Empty</span>;

  return (
    <>
      {entries.map((e) => {
        const bm = bookmarks.find((b) => b.path === e.path);
        return (
          <div key={e.path}>
            <div className="path-bar__crumb-item" style={{ paddingLeft: depth * 14 + 8 }}>
              {e.isDir ? (
                <>
                  <button
                    className="path-bar__crumb-chevron"
                    onClick={() => setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(e.path)) next.delete(e.path); else next.add(e.path);
                      return next;
                    })}
                  >
                    {expanded.has(e.path) ? "▾" : "▸"}
                  </button>
                  <button className="path-bar__crumb-name" onClick={() => onSelect(e.path)}>
                    📁 {e.name}
                  </button>
                </>
              ) : (
                <>
                  <span className="path-bar__crumb-chevron" style={{ visibility: "hidden" }}>▸</span>
                  <button className="path-bar__crumb-name" onClick={() => handleFileClick(e.path)}>
                    {getFileIcon(e.name)} {e.name}
                  </button>
                </>
              )}
              {e.isDir && (
                <button
                  className={`path-bar__crumb-star ${bm ? "path-bar__crumb-star--active" : ""}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (bm) removeBookmark(bm.id);
                    else addBookmark(e.path, "folder");
                  }}
                  title={bm ? "Remove from bookmarks" : "Add to bookmarks"}
                >
                  {bm ? "★" : "☆"}
                </button>
              )}
            </div>
            {e.isDir && expanded.has(e.path) && (
              <CrumbTree path={e.path} onSelect={onSelect} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}

/** File extension to icon. */
const FILE_ICONS: Record<string, string> = {
  drawio: "📐", csv: "📊", tsv: "📊", md: "📖", py: "🐍",
  js: "📜", ts: "📜", jsx: "📜", tsx: "📜", json: "⚙️",
  yaml: "⚙️", yml: "⚙️", rs: "🦀", toml: "⚙️", sh: "📄",
};
function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] ?? "📄";
}
