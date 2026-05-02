/**
 * Git data types shared across the extension.
 * [CLEAN-ARCH] Core domain types — no dependencies on VS Code or infrastructure.
 */

/** A parsed git commit. */
export interface GitCommit {
  readonly hash: string;
  readonly abbreviatedHash: string;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly parentHashes: readonly string[];
  readonly refs: readonly string[];
}

/** A local or remote branch reference. */
export interface GitBranch {
  readonly name: string;
  readonly isRemote: boolean;
  readonly isCurrent: boolean;
  readonly upstream?: string;
}

/** A file change in the working tree or between commits. */
export interface GitFileChange {
  readonly path: string;
  readonly status: GitFileStatus;
  readonly oldPath?: string; // for renames
}

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

/** Working tree status summary. */
export interface WorkingTreeStatus {
  readonly staged: readonly GitFileChange[];
  readonly unstaged: readonly GitFileChange[];
  readonly untracked: readonly string[];
}

/** Branch comparison result. */
export interface BranchComparison {
  readonly baseBranch: string;
  readonly compareBranch: string;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly files: readonly GitFileChange[];
  readonly commits: readonly GitCommit[];
}

/** Detailed commit information (for commit detail panel). */
export interface CommitDetail {
  readonly hash: string;
  readonly abbreviatedHash: string;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly parentHashes: readonly string[];
  readonly refs: readonly string[];
  readonly files: readonly GitFileChange[];
}

/** A git stash entry. */
export interface StashEntry {
  readonly index: number;
  readonly message: string;
  readonly hash: string;
}

/** Result of a git write action. */
export interface ActionResult {
  readonly success: boolean;
  readonly message: string;
  /** The action that was performed (for logging/display). */
  readonly action: string;
}

/** A git worktree entry. */
export interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
  readonly hash: string;
  readonly isMain: boolean;
}

/** AI-ready context export. */
export interface ContextExport {
  readonly repository: string;
  readonly branch: string;
  readonly generatedAt: string;
  readonly recentCommits: readonly GitCommit[];
  readonly workingTree: WorkingTreeStatus;
  readonly summary: string;
}
/**
 * Graph visualization types.
 * [CLEAN-ARCH] Domain types for the graph UI layer.
 */

/** A node in the visual graph. */
export interface GraphNode {
  readonly commit: GitCommit;
  readonly column: number;
  readonly color: string;
  readonly isHead: boolean;
  readonly isMerge: boolean;
  readonly branches: readonly BranchRef[];
  readonly tags: readonly string[];
}

/** A branch reference attached to a graph node. */
export interface BranchRef {
  readonly name: string;
  readonly isRemote: boolean;
}

/** An edge connecting two graph nodes. */
export interface GraphEdge {
  readonly fromHash: string;
  readonly toHash: string;
  readonly column: number;
  readonly color: string;
  readonly isMergeEdge: boolean;
}

/** A complete graph ready for rendering. */
export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly columns: number;
  /** Sync status for local branches with upstream tracking. */
  readonly branchSync?: Readonly<
    Record<string, { ahead: number; behind: number; remote: string }>
  >;
  /** When true, graph is file-filtered — renderer shows a flat list. */
  readonly filtered?: boolean;
  /** Active worktrees: branch name → worktree folder path. */
  readonly worktrees?: Readonly<Record<string, string>>;
}
