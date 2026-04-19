/**
 * Graph builder — transforms git commits into a visual graph structure.
 * [CLEAN-CODE][SRP] Pure function: commits in → graph out. No side effects.
 */

import type { GitCommit } from './types';
import type { GraphData, GraphNode, GraphEdge, BranchRef } from './types';

/**
 * Color palette for branch lanes.
 * High-contrast, colorblind-friendly set.
 */
const LANE_COLORS = [
  '#4fc3f7', // light blue
  '#81c784', // green
  '#ffb74d', // orange
  '#e57373', // red
  '#ba68c8', // purple
  '#4dd0e1', // cyan
  '#fff176', // yellow
  '#f06292', // pink
  '#a1887f', // brown
  '#90a4ae', // blue grey
] as const;

/**
 * Build a Set of known remote prefixes for O(1) lookups.
 * Used to classify refs like "origin/main" as remote.
 */
function buildRemoteSet(remoteNames: readonly string[]): Set<string> {
  return new Set(remoteNames);
}

/**
 * Determine if a branch ref name is a remote tracking branch.
 * A ref is remote if its first path segment matches a known remote name.
 * E.g., "origin/main" → remote (if "origin" is in remoteNames),
 *        "feature/test" → local (no matching remote).
 */
function isRemoteRef(name: string, remoteSet: Set<string>): boolean {
  const slashIndex = name.indexOf('/');
  if (slashIndex <= 0) return false;
  const firstSegment = name.slice(0, slashIndex);
  return remoteSet.has(firstSegment);
}

/**
 * Build a visual graph from a list of commits.
 *
 * Algorithm (two-pass):
 * Pass 1 — Column assignment:
 *   Process commits in topological order, maintaining active lane reservations.
 *   Each commit gets a column; its primary parent inherits the same column.
 *   Merge parents are assigned to free lanes.
 *
 * Pass 2 — Edge construction:
 *   Build edges using the actual column assignments from Pass 1.
 *   This ensures fork/merge edges connect to where the parent really is,
 *   not where the lane reservation assumed it would be.
 *
 * @param commits - Commits in reverse chronological / topological order.
 * @param headHash - The current HEAD commit hash (optional).
 * @param remoteNames - Known remote names (e.g. ['origin', 'upstream']). Used
 *                      to classify branch refs as remote vs local.
 * @returns A complete GraphData structure.
 */
export function buildGraph(
  commits: readonly GitCommit[],
  headHash?: string,
  remoteNames: readonly string[] = [],
): GraphData {
  if (commits.length === 0) {
    return { nodes: [], edges: [], columns: 0 };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Build remote name set for O(1) lookups
  const remoteSet = buildRemoteSet(remoteNames);

  // Active lanes: each entry is the expected next hash for that column, or null if free
  const lanes: (string | null)[] = [];

  // Map from hash → column assignment (for parent lookups)
  const hashToColumn = new Map<string, number>();

  let maxColumn = 0;

  // ---- Pass 1: Assign columns to all commits ----
  for (const commit of commits) {
    // Find which lane expects this commit
    let column = lanes.indexOf(commit.hash);

    if (column === -1) {
      // New lane: find the first free slot or append
      column = lanes.indexOf(null);
      if (column === -1) {
        column = lanes.length;
        lanes.push(null);
      }
    }

    // Clear the lane — this commit has arrived
    lanes[column] = null;

    // Also clear any DUPLICATE reservations for this hash in other lanes.
    // Multiple children can reserve the same parent; only the first wins.
    for (let k = 0; k < lanes.length; k++) {
      if (k !== column && lanes[k] === commit.hash) {
        lanes[k] = null;
      }
    }

    hashToColumn.set(commit.hash, column);
    maxColumn = Math.max(maxColumn, column);

    const color = LANE_COLORS[column % LANE_COLORS.length];
    const isMerge = commit.parentHashes.length > 1;

    // Parse branch/tag refs
    const branches: BranchRef[] = [];
    const tags: string[] = [];
    for (const ref of commit.refs) {
      if (ref.startsWith('tag: ')) {
        tags.push(ref.replace('tag: ', ''));
      } else if (ref !== 'HEAD') {
        const name = ref.replace('HEAD -> ', '');
        const isRemote = isRemoteRef(name, remoteSet);
        branches.push({ name, isRemote });
      }
    }

    nodes.push({
      commit,
      column,
      color,
      isHead: commit.hash === headHash,
      isMerge,
      branches,
      tags,
    });

    // Route parents into lanes
    for (let i = 0; i < commit.parentHashes.length; i++) {
      const parentHash = commit.parentHashes[i];
      if (!parentHash) {
        continue;
      }

      if (i === 0) {
        // First parent continues in the same lane
        if (lanes[column] === null) {
          lanes[column] = parentHash;
        }
      } else {
        // Additional parents (merge): find or create a lane
        // Check if parent is already reserved somewhere
        let parentColumn = lanes.indexOf(parentHash);
        if (parentColumn === -1) {
          parentColumn = lanes.indexOf(null);
          if (parentColumn === -1) {
            parentColumn = lanes.length;
            lanes.push(null);
          }
          lanes[parentColumn] = parentHash;
        }
        maxColumn = Math.max(maxColumn, parentColumn);
      }
    }

    // Compact: clear trailing null lanes
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
  }

  // ---- Pass 2: Build edges using actual column assignments ----
  for (const node of nodes) {
    const commit = node.commit;
    for (let i = 0; i < commit.parentHashes.length; i++) {
      const parentHash = commit.parentHashes[i];
      if (!parentHash) continue;

      // Use the parent's actual assigned column if available (it was in the
      // visible commit list). Otherwise fall back to the child's column.
      const parentCol = hashToColumn.get(parentHash) ?? node.column;
      const isMergeEdge = i > 0;

      // Edge column = parent's column. The renderer draws from
      // (fromNode.column → edge.column), producing a straight line if they
      // match or a bezier fork/merge curve if they differ.
      const edgeColor = isMergeEdge
        ? LANE_COLORS[parentCol % LANE_COLORS.length]
        : node.color;

      edges.push({
        fromHash: commit.hash,
        toHash: parentHash,
        column: parentCol,
        color: edgeColor,
        isMergeEdge,
      });
    }
  }

  return {
    nodes,
    edges,
    columns: maxColumn + 1,
  };
}
