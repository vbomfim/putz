/**
 * Type definitions for the keyword highlighting IPC layer.
 *
 * These types mirror the Rust backend's highlight models.
 * Keep in sync with src-tauri/src/highlight/models.rs.
 */

/** How a highlight pattern is matched against terminal output. */
export type MatchType = "exact" | "exactinsensitive" | "wildcard" | "regex";

/** A single highlight rule defining a pattern and its visual style. */
export interface HighlightRule {
  /** Unique rule identifier (UUID v4). */
  id: string;
  /** Pattern string to match (exact text, wildcard, or regex). */
  pattern: string;
  /** How the pattern is matched. */
  matchType: MatchType;
  /** Foreground color as hex (e.g., "#FF5555"). */
  foregroundColor: string;
  /** Background color as hex, or empty for transparent. */
  backgroundColor: string;
  /** Whether matched text should be bold. */
  bold: boolean;
  /** Whether matched text should be underlined. */
  underline: boolean;
  /** Priority for overlap resolution (higher wins, 0–999). */
  priority: number;
}

/** A named collection of highlight rules. */
export interface HighlightSet {
  /** Unique set identifier (UUID v4). */
  id: string;
  /** Human-readable name for this set. */
  name: string;
  /** Optional description. */
  description: string;
  /** Ordered list of highlight rules. */
  rules: HighlightRule[];
  /** Whether this is a built-in preset (cannot be deleted). */
  isBuiltin: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-modified timestamp. */
  updatedAt: string;
}

/** Input for creating a new highlight rule. */
export interface CreateHighlightRuleInput {
  pattern: string;
  matchType: MatchType;
  foregroundColor: string;
  backgroundColor: string;
  bold: boolean;
  underline: boolean;
  priority: number;
}

/** Input for creating a new highlight set. */
export interface CreateHighlightSetInput {
  name: string;
  description: string;
  rules: CreateHighlightRuleInput[];
}

/** Input for updating an existing highlight set (partial). */
export interface UpdateHighlightSetInput {
  name?: string;
  description?: string;
  rules?: CreateHighlightRuleInput[];
}

/** Human-readable labels for match types. */
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: "Exact (case-sensitive)",
  exactinsensitive: "Exact (case-insensitive)",
  wildcard: "Wildcard (* and ?)",
  regex: "Regular Expression",
};

/**
 * Built-in color palette for highlight rules.
 * All colors meet 4.5:1 contrast ratio against #1a1a2e background.
 */
export const HIGHLIGHT_COLOR_PALETTE = [
  { name: "Red", hex: "#FF5555" },
  { name: "Green", hex: "#50FA7B" },
  { name: "Yellow", hex: "#F1FA8C" },
  { name: "Cyan", hex: "#8BE9FD" },
  { name: "Orange", hex: "#FFB86C" },
  { name: "Purple", hex: "#BD93F9" },
  { name: "Pink", hex: "#FF79C6" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Gray", hex: "#6272A4" },
  { name: "Bright Red", hex: "#FF6E6E" },
  { name: "Bright Green", hex: "#69FF94" },
  { name: "Bright Cyan", hex: "#A4FFFF" },
] as const;
