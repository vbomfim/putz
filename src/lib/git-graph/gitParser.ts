/**
 * Git output parser.
 * [CLEAN-CODE][SRP] Responsible only for parsing raw git CLI output into typed structures.
 * [SECURITY] Never interprets parsed values as commands.
 */

import type {
  GitCommit,
  GitBranch,
  GitFileChange,
  GitFileStatus,
  WorkingTreeStatus,
  CommitDetail,
  StashEntry,
} from "./types";

/** Delimiter used in git log --format to separate fields. */
export const FIELD_SEPARATOR = "\x1f"; // ASCII Unit Separator
/** Delimiter used to separate records. */
export const RECORD_SEPARATOR = "\x1e"; // ASCII Record Separator

/**
 * Build a git log format string using safe delimiters.
 * Fields: hash, abbrev hash, subject, body, author name, author email, author date ISO, parent hashes, refs.
 */
export function getLogFormatString(): string {
  const fields = [
    "%H", // hash
    "%h", // abbreviated hash
    "%s", // subject
    "%b", // body
    "%aN", // author name
    "%aE", // author email
    "%aI", // author date ISO 8601
    "%P", // parent hashes (space-separated)
    "%D", // ref names
  ];
  return RECORD_SEPARATOR + fields.join(FIELD_SEPARATOR);
}

/**
 * Parse raw git log output into GitCommit objects.
 */
export function parseLogOutput(raw: string): GitCommit[] {
  if (!raw.trim()) {
    return [];
  }

  const records = raw.split(RECORD_SEPARATOR).filter((r) => r.trim());
  return records.map(parseOneCommit);
}

function parseOneCommit(record: string): GitCommit {
  const fields = record.trim().split(FIELD_SEPARATOR);

  const hash = fields[0] ?? "";
  const abbreviatedHash = fields[1] ?? "";
  const subject = fields[2] ?? "";
  const body = fields[3] ?? "";
  const authorName = fields[4] ?? "";
  const authorEmail = fields[5] ?? "";
  const authorDate = fields[6] ?? "";
  const parentHashesRaw = fields[7] ?? "";
  const refsRaw = fields[8] ?? "";

  const parentHashes = parentHashesRaw
    ? parentHashesRaw.split(" ").filter(Boolean)
    : [];

  const refs = refsRaw
    ? refsRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  return {
    hash,
    abbreviatedHash,
    subject,
    body,
    authorName,
    authorEmail,
    authorDate,
    parentHashes,
    refs,
  };
}

/**
 * Parse `git branch` output into GitBranch objects.
 */
export function parseBranchOutput(raw: string): GitBranch[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map(parseBranchLine);
}

function parseBranchLine(line: string): GitBranch {
  const isCurrent = line.startsWith("* ");
  const cleaned = line.replace(/^\*?\s+/, "").trim();

  // Handle detached HEAD
  if (cleaned.startsWith("(HEAD detached")) {
    return { name: "HEAD (detached)", isRemote: false, isCurrent };
  }

  // Handle remote tracking branches from `git branch -a`
  // Format: "remotes/origin/main" or "remotes/origin/HEAD -> origin/main"
  if (cleaned.startsWith("remotes/")) {
    const remotePath = cleaned.replace(/^remotes\//, "");
    // Skip symbolic HEAD refs (e.g. "origin/HEAD -> origin/main")
    if (remotePath.includes(" -> ")) {
      return {
        name: remotePath.split(" -> ")[0],
        isRemote: true,
        isCurrent: false,
      };
    }
    return { name: remotePath, isRemote: true, isCurrent: false };
  }

  return {
    name: cleaned,
    isRemote: false,
    isCurrent,
  };
}

/**
 * Parse `git status --porcelain=v1` output into WorkingTreeStatus.
 */
export function parseStatusOutput(raw: string): WorkingTreeStatus {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: string[] = [];

  if (!raw.trim()) {
    return { staged, unstaged, untracked };
  }

  for (const line of raw.split("\n")) {
    if (!line || line.length < 2) {
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.slice(3);

    if (indexStatus === "?" && workTreeStatus === "?") {
      untracked.push(filePath);
      continue;
    }

    // Staged changes (index column)
    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push({
        path: filePath,
        status: porcelainCharToStatus(indexStatus),
      });
    }

    // Unstaged changes (work tree column)
    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      unstaged.push({
        path: filePath,
        status: porcelainCharToStatus(workTreeStatus),
      });
    }
  }

  return { staged, unstaged, untracked };
}

function porcelainCharToStatus(char: string): GitFileStatus {
  switch (char) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

/**
 * Parse `git diff --name-status` output into GitFileChange[].
 */
export function parseDiffNameStatus(raw: string): GitFileChange[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("\t");
      const statusChar = (parts[0] ?? "")[0] ?? "M";
      const path = parts[1] ?? "";
      const oldPath = parts[2]; // present for renames

      return {
        path: oldPath ?? path,
        status: porcelainCharToStatus(statusChar),
        ...(oldPath ? { oldPath: path } : {}),
      };
    });
}

/**
 * Parse `git rev-list --count` output.
 */
export function parseRevListCount(raw: string): number {
  const trimmed = raw.trim();
  const count = parseInt(trimmed, 10);
  return Number.isNaN(count) ? 0 : count;
}

/**
 * Parse `git remote` output into a list of remote names.
 */
export function parseRemoteOutput(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Parse `git show` output into a CommitDetail.
 * Expects output from:
 *   git show --format=<logformat> --name-status <hash> --
 *
 * The output has the commit header (using our standard log format with
 * field separators) followed by a blank line and then the diff name-status lines.
 *
 * [ROBUSTNESS] We split on field separators first (not `\n\n`) so that
 * multi-paragraph commit bodies containing blank lines don't break parsing.
 * The diff section is extracted from the tail of the last field.
 */
export function parseCommitShowOutput(raw: string): CommitDetail | null {
  if (!raw.trim()) {
    return null;
  }

  // The output starts with our record separator, then the commit record.
  const parts = raw.split(RECORD_SEPARATOR).filter((r) => r.trim());
  if (parts.length === 0) {
    return null;
  }

  // Split on field separators to extract the 9 commit fields.
  // Fields: 0=hash, 1=abbrev, 2=subject, 3=body, 4=author, 5=email,
  //         6=date, 7=parents, 8=refs (+ possible diff tail)
  const fields = parts[0].trim().split(FIELD_SEPARATOR);

  const hash = fields[0] ?? "";
  const abbreviatedHash = fields[1] ?? "";
  const subject = fields[2] ?? "";
  const body = fields[3] ?? "";
  const authorName = fields[4] ?? "";
  const authorEmail = fields[5] ?? "";
  const authorDate = fields[6] ?? "";
  const parentHashesRaw = fields[7] ?? "";
  const refsAndDiff = fields[8] ?? "";

  const parentHashes = parentHashesRaw
    ? parentHashesRaw.split(" ").filter(Boolean)
    : [];

  // The last field (refs) may have the diff section appended after a blank line.
  // Split on the first `\n\n` within the refs field to separate refs from diff.
  const doubleNewlineIdx = refsAndDiff.indexOf("\n\n");
  let refsRaw: string;
  let diffSection: string;

  if (doubleNewlineIdx >= 0) {
    refsRaw = refsAndDiff.slice(0, doubleNewlineIdx);
    diffSection = refsAndDiff.slice(doubleNewlineIdx + 2);
  } else {
    refsRaw = refsAndDiff;
    diffSection = "";
  }

  const refs = refsRaw
    ? refsRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  const files = parseDiffNameStatus(diffSection);

  return {
    hash,
    abbreviatedHash,
    subject,
    body,
    authorName,
    authorEmail,
    authorDate,
    parentHashes,
    refs,
    files,
  };
}

/**
 * Parse `git stash list` output into StashEntry objects.
 * Format: "stash@{0}: WIP on main: abc1234 Some message"
 * [CLEAN-CODE] Pure function, no side effects.
 */
export function parseStashListOutput(raw: string): StashEntry[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      // Match "stash@{N}: message" and extract the hash if present
      const match = line.match(/^stash@\{(\d+)\}:\s*(.+)$/);
      if (!match) {
        return null;
      }

      const index = parseInt(match[1], 10);
      const message = match[2] ?? "";

      return {
        index,
        message,
        hash: `stash@{${index}}`,
      };
    })
    .filter((entry): entry is StashEntry => entry !== null);
}

/**
 * Parse `git tag -l` output into a list of tag names.
 * [CLEAN-CODE] Pure function.
 */
export function parseTagListOutput(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
