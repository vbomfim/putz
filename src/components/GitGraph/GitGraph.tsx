import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseLogOutput, parseStatusOutput, parseRemoteOutput, parseCommitShowOutput } from "../../lib/git-graph/gitParser";
import { buildGraph } from "../../lib/git-graph/graphBuilder";
import { renderGraph, highlightCommit } from "../../lib/git-graph/graphRenderer";
import { renderCommitDetail } from "../../lib/git-graph/commitDetailPanel";
import { renderWorkingTree } from "../../lib/git-graph/workingTree";
import type { GraphData } from "../../lib/git-graph/types";
import "./GitGraph.css";

interface GitGraphProps {
  repoPath: string;
  regionId: string;
  tabId: string;
}

export function GitGraph({ repoPath }: GitGraphProps) {
  const graphRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const wtOverlayRef = useRef<HTMLDivElement>(null);
  const wtFilesRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logRaw, statusRaw, remotesRaw, headHash] = await Promise.all([
        invoke<string>("git_log", { repoPath, maxCount: 500 }),
        invoke<string>("git_status", { repoPath }),
        invoke<string>("git_remotes", { repoPath }),
        invoke<string>("git_rev_parse_head", { repoPath }),
      ]);

      const commits = parseLogOutput(logRaw);
      const remotes = parseRemoteOutput(remotesRaw);
      const graph = buildGraph(commits, headHash.trim(), remotes);
      setGraphData(graph);

      // Render working tree overlay
      if (wtOverlayRef.current && wtFilesRef.current) {
        const status = parseStatusOutput(statusRaw);
        renderWorkingTree(status, wtOverlayRef.current, wtFilesRef.current);
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

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
            onOpenFileDiff: (_h, _fp) => {
              // TODO: open diff in editor tab
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
        <button onClick={loadGraph} title="Refresh">↻ Refresh</button>
      </div>
      <div className="git-graph__wt-overlay" ref={wtOverlayRef} />
      <div className="git-graph__wt-files" ref={wtFilesRef} />
      <div className="git-graph__content">
        <div className="git-graph__graph" ref={graphRef} />
        <div className="git-graph__detail" ref={detailRef} />
      </div>
    </div>
  );
}
