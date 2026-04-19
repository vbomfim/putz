import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseLogOutput, parseStatusOutput, parseRemoteOutput, parseCommitShowOutput } from "../../lib/git-graph/gitParser";
import { buildGraph } from "../../lib/git-graph/graphBuilder";
import { renderGraph, highlightCommit } from "../../lib/git-graph/graphRenderer";
import { renderCommitDetail } from "../../lib/git-graph/commitDetailPanel";
import { useLayoutStore } from "../../stores/layoutStore";
import type { GraphData, WorkingTreeStatus, GitFileChange } from "../../lib/git-graph/types";
import "./GitGraph.css";

interface GitGraphProps {
  repoPath: string;
  regionId: string;
  tabId: string;
}

export function GitGraph({ repoPath }: GitGraphProps) {
  const graphRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [wtStatus, setWtStatus] = useState<WorkingTreeStatus | null>(null);
  const [fileFilter, setFileFilter] = useState("");

  const loadGraph = useCallback(async (filePath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const logArgs: { repoPath: string; maxCount: number; filePath?: string } = { repoPath, maxCount: 500 };
      if (filePath) logArgs.filePath = filePath;

      const [logRaw, statusRaw, remotesRaw, headHash] = await Promise.all([
        invoke<string>("git_log", logArgs),
        invoke<string>("git_status", { repoPath }),
        invoke<string>("git_remotes", { repoPath }),
        invoke<string>("git_rev_parse_head", { repoPath }),
      ]);

      const commits = parseLogOutput(logRaw);
      const remotes = parseRemoteOutput(remotesRaw);
      const graph = buildGraph(commits, headHash.trim(), remotes);
      // Mark as filtered when file path is active — renderer shows flat list without SVG
      if (filePath) {
        (graph as { filtered: boolean }).filtered = true;
      }
      setGraphData(graph);
      setWtStatus(parseStatusOutput(statusRaw));

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const handleFilterChange = useCallback((value: string) => {
    setFileFilter(value);
  }, []);

  const applyFilter = useCallback(() => {
    loadGraph(fileFilter.trim() || undefined);
  }, [loadGraph, fileFilter]);

  const clearFilter = useCallback(() => {
    setFileFilter("");
    loadGraph();
  }, [loadGraph]);

  // Open diff for a working tree file (staged or unstaged)
  const openWorkingTreeDiff = useCallback(async (file: GitFileChange, staged: boolean) => {
    try {
      const fullPath = repoPath + "/" + file.path;
      if (file.status === "added" && !staged) {
        // New untracked file — just open it in editor
        useLayoutStore.getState().addEditorTab(undefined, fullPath);
        return;
      }
      // Get the "before" content from HEAD (for staged) or index (for unstaged)
      const headContent = await invoke<string>("git_file_at_commit", {
        repoPath,
        hash: staged ? "HEAD" : "HEAD",
        filePath: file.path,
      });
      // Get the "after" content from the working file
      const workingContent = await invoke<string>("file_read", { path: fullPath });
      const fileName = file.path.split("/").pop() || file.path;
      useLayoutStore.getState().addDiffTab(undefined, undefined, undefined, headContent, workingContent);
      const ls = useLayoutStore.getState();
      const region = ls.regions[ls.focusedRegionId];
      if (region) {
        const tab = region.tabs.find(t => t.id === region.activeTabId);
        if (tab) {
          useLayoutStore.getState().renameTab(region.id, tab.id, `${fileName} (${staged ? "staged" : "modified"})`);
        }
      }
    } catch (e) {
      console.error("Failed to open working tree diff:", e);
    }
  }, [repoPath]);

  // Render SVG graph when graphData changes
  useEffect(() => {
    if (!graphData || !graphRef.current) return;
    graphRef.current.innerHTML = "";

    const handleCommitClick = async (hash: string) => {
      // Highlight the clicked row
      if (graphRef.current) {
        highlightCommit(hash, graphRef.current);
      }

      try {
        const raw = await invoke<string>("git_show", { repoPath, hash });
        const detail = parseCommitShowOutput(raw);
        if (detail && detailRef.current) {
          renderCommitDetail(detailRef.current, detail, {
            onSelectCommit: (h) => {
              if (graphRef.current) highlightCommit(h, graphRef.current);
            },
            onOpenFileDiff: async (h, fp) => {
              try {
                // Get the commit's parent hash for the "before" version
                const detail2 = parseCommitShowOutput(raw);
                const parentHash = detail2?.parentHashes[0];
                const [oldContent, newContent] = await Promise.all([
                  parentHash
                    ? invoke<string>("git_file_at_commit", { repoPath, hash: parentHash, filePath: fp })
                    : Promise.resolve(""),
                  invoke<string>("git_file_at_commit", { repoPath, hash: h, filePath: fp }),
                ]);
                const fileName = fp.split("/").pop() || fp;
                useLayoutStore.getState().addDiffTab(
                  undefined,
                  undefined, undefined,
                  oldContent,
                  newContent,
                );
                // Update tab title to show the file name
                const ls = useLayoutStore.getState();
                const region = ls.regions[ls.focusedRegionId];
                if (region) {
                  const tab = region.tabs.find(t => t.id === region.activeTabId);
                  if (tab) {
                    useLayoutStore.getState().renameTab(region.id, tab.id, `${fileName} @ ${h.slice(0, 7)}`);
                  }
                }
              } catch (e) {
                console.error("Failed to open file diff:", e);
              }
            },
          });
        }
      } catch (e) {
        console.error("Failed to load commit detail:", e);
      }
    };

    // renderGraph renders into the container element (sets innerHTML)
    renderGraph(graphData, graphRef.current, handleCommitClick, () => {});
  }, [graphData, repoPath]);

  if (error) {
    return (
      <div className="git-graph git-graph--error">
        <p>Failed to load git graph</p>
        <p>{error}</p>
      </div>
    );
  }
  if (loading) {
    return <div className="git-graph git-graph--loading">Loading git history…</div>;
  }

  return (
    <div className="git-graph">
      <div className="git-graph__toolbar">
        <button onClick={() => loadGraph(fileFilter.trim() || undefined)} title="Refresh">↻</button>
        <input
          className="git-graph__filter-input"
          type="text"
          placeholder="Filter by file path… (Enter to apply)"
          value={fileFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
          spellCheck={false}
        />
        {fileFilter && (
          <>
            <button onClick={applyFilter} title="Apply filter">🔍</button>
            <button onClick={clearFilter} title="Clear filter" className="git-graph__filter-clear">✕</button>
          </>
        )}
      </div>
      {wtStatus && (wtStatus.staged.length > 0 || wtStatus.unstaged.length > 0 || wtStatus.untracked.length > 0) && (
        <GitStatus status={wtStatus} onFileClick={openWorkingTreeDiff} />
      )}
      <div className="git-graph__content">
        <div className="git-graph__graph" ref={graphRef} />
        <div className="git-graph__detail" ref={detailRef} />
      </div>
    </div>
  );
}

const STATUS_ICONS: Record<string, string> = {
  added: "+", modified: "~", deleted: "−", renamed: "→", copied: "C", untracked: "?",
};
const STATUS_COLORS: Record<string, string> = {
  added: "#50fa7b", modified: "#f9e2af", deleted: "#f38ba8", renamed: "#89b4fa", copied: "#89b4fa", untracked: "#6c7086",
};

function GitStatus({ status, onFileClick }: {
  status: WorkingTreeStatus;
  onFileClick: (file: GitFileChange, staged: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const total = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className="git-graph__status">
      <button className="git-graph__status-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? "▾" : "▸"}</span>
        <span>Working Tree</span>
        <span className="git-graph__status-counts">
          {status.staged.length > 0 && <span style={{ color: STATUS_COLORS.added }}>+{status.staged.length} staged</span>}
          {status.unstaged.length > 0 && <span style={{ color: STATUS_COLORS.modified }}>~{status.unstaged.length} modified</span>}
          {status.untracked.length > 0 && <span style={{ color: STATUS_COLORS.untracked }}>?{status.untracked.length} untracked</span>}
          {total === 0 && <span style={{ color: STATUS_COLORS.untracked }}>clean</span>}
        </span>
      </button>
      {expanded && (
        <div className="git-graph__status-files">
          {status.staged.map((f) => (
            <button key={"s-" + f.path} className="git-graph__status-file" onClick={() => onFileClick(f, true)}>
              <span className="git-graph__status-icon" style={{ color: STATUS_COLORS[f.status] }}>{STATUS_ICONS[f.status]}</span>
              <span className="git-graph__status-path">{f.path}</span>
              <span className="git-graph__status-label">staged</span>
            </button>
          ))}
          {status.unstaged.map((f) => (
            <button key={"u-" + f.path} className="git-graph__status-file" onClick={() => onFileClick(f, false)}>
              <span className="git-graph__status-icon" style={{ color: STATUS_COLORS[f.status] }}>{STATUS_ICONS[f.status]}</span>
              <span className="git-graph__status-path">{f.path}</span>
            </button>
          ))}
          {status.untracked.map((p) => (
            <button key={"t-" + p} className="git-graph__status-file" onClick={() => onFileClick({ path: p, status: "added" }, false)}>
              <span className="git-graph__status-icon" style={{ color: STATUS_COLORS.untracked }}>?</span>
              <span className="git-graph__status-path">{p}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
