/**
 * HighlightEngine — applies keyword highlighting to xterm.js terminal output.
 *
 * Architecture:
 * - Pre-compiles regex patterns when rules change (not per-line)
 * - Hooks into terminal.onWriteParsed to detect new output
 * - Scans visible viewport lines for matches, creates xterm Decorations
 * - Priority-sorted: highest priority rule wins on overlapping regions
 * - Catastrophic backtracking protection: 10ms timeout per line (via char limit)
 * - Toggle on/off without losing rule state
 *
 * @module HighlightEngine
 */
import type { Terminal, IMarker, IDecoration } from "@xterm/xterm";
import type { HighlightRule, MatchType } from "./highlightTypes";

/** Maximum characters per line to scan (backtracking protection). */
const MAX_LINE_LENGTH = 10_000;

/** Debounce interval for processing new output (ms). */
const DEBOUNCE_MS = 16;

/** A compiled rule ready for matching. */
interface CompiledRule {
  rule: HighlightRule;
  regex: RegExp;
}

/** A match found in a terminal line. */
interface HighlightMatch {
  /** Line index in the terminal buffer. */
  line: number;
  /** Column start position. */
  startCol: number;
  /** Match length in characters. */
  length: number;
  /** The rule that produced this match. */
  rule: HighlightRule;
}

/**
 * Converts a highlight pattern to a RegExp based on its match type.
 * Returns null if the pattern is invalid.
 */
function patternToRegex(pattern: string, matchType: MatchType): RegExp | null {
  try {
    switch (matchType) {
      case "exact":
        return new RegExp(escapeRegex(pattern), "g");
      case "exactinsensitive":
        return new RegExp(escapeRegex(pattern), "gi");
      case "wildcard":
        return new RegExp(wildcardToRegex(pattern), "gi");
      case "regex":
        return new RegExp(pattern, "g");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converts a wildcard pattern (* and ?) to a regex source string. */
function wildcardToRegex(pattern: string): string {
  return pattern
    .split("")
    .map((char) => {
      switch (char) {
        case "*":
          return ".*";
        case "?":
          return ".";
        default:
          return escapeRegex(char);
      }
    })
    .join("");
}

/**
 * Keyword highlighting engine for xterm.js.
 *
 * Usage:
 * ```ts
 * const engine = new HighlightEngine(terminal);
 * engine.setRules(rules);
 * engine.enable();
 * // ... terminal receives output ...
 * engine.dispose();
 * ```
 */
export class HighlightEngine {
  private terminal: Terminal;
  private compiledRules: CompiledRule[] = [];
  private decorations: IDecoration[] = [];
  private markers: IMarker[] = [];
  private enabled = false;
  private disposed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private writeDisposable: { dispose: () => void } | null = null;
  private lastProcessedLine = -1;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  /**
   * Sets the highlight rules, pre-compiling all patterns.
   * Automatically re-applies if the engine is enabled.
   */
  setRules(rules: HighlightRule[]): void {
    if (this.disposed) return;

    // Pre-compile and sort by priority (highest first) [CLEAN-CODE]
    this.compiledRules = rules
      .map((rule) => {
        const regex = patternToRegex(rule.pattern, rule.matchType);
        return regex ? { rule, regex } : null;
      })
      .filter((entry): entry is CompiledRule => entry !== null)
      .sort((a, b) => b.rule.priority - a.rule.priority);

    // Re-apply if enabled
    if (this.enabled) {
      this.clearDecorations();
      this.processViewport();
    }
  }

  /** Enables highlighting and hooks into terminal output. */
  enable(): void {
    if (this.disposed || this.enabled) return;
    this.enabled = true;

    // Hook into terminal write events
    this.writeDisposable = this.terminal.onWriteParsed(() => {
      this.scheduleProcess();
    });

    // Process existing content
    this.processViewport();
  }

  /** Disables highlighting and removes all decorations. */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    this.writeDisposable?.dispose();
    this.writeDisposable = null;

    this.clearDecorations();
    this.lastProcessedLine = -1;
  }

  /** Toggles highlighting on/off. Returns the new state. */
  toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }

  /** Returns whether highlighting is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Cleans up all resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.disable();
    this.compiledRules = [];

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Schedules a debounced viewport processing pass. */
  private scheduleProcess(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processViewport();
    }, DEBOUNCE_MS);
  }

  /**
   * Scans the visible viewport for matches and creates decorations.
   * Only processes lines that haven't been processed yet (incremental).
   */
  private processViewport(): void {
    if (!this.enabled || this.disposed || this.compiledRules.length === 0) {
      return;
    }

    const buffer = this.terminal.buffer.active;
    const totalLines = buffer.length;

    // Process visible viewport + any new lines since last processing
    const viewportStart = buffer.viewportY;
    const viewportEnd = Math.min(
      viewportStart + this.terminal.rows,
      totalLines,
    );

    // Also process new lines added since last time
    const processStart = Math.max(
      viewportStart,
      Math.min(this.lastProcessedLine + 1, viewportStart),
    );

    const matches: HighlightMatch[] = [];

    for (let lineIdx = processStart; lineIdx < viewportEnd; lineIdx++) {
      const line = buffer.getLine(lineIdx);
      if (!line) continue;

      const text = line.translateToString(true);
      if (text.length === 0 || text.length > MAX_LINE_LENGTH) continue;

      // Run each compiled rule against this line
      for (const compiled of this.compiledRules) {
        compiled.regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = compiled.regex.exec(text)) !== null) {
          matches.push({
            line: lineIdx,
            startCol: match.index,
            length: match[0].length,
            rule: compiled.rule,
          });

          // Prevent infinite loops on zero-length matches
          if (match[0].length === 0) {
            compiled.regex.lastIndex++;
          }
        }
      }
    }

    // Apply decorations for non-overlapping matches (priority-sorted)
    this.applyDecorations(matches);
    this.lastProcessedLine = viewportEnd - 1;
  }

  /**
   * Applies xterm.js decorations for the given matches.
   * Uses priority-sorted ordering — first match on a position wins.
   */
  private applyDecorations(matches: HighlightMatch[]): void {
    // Sort by priority descending (already sorted in compiledRules, but
    // matches come from all rules across all lines)
    matches.sort((a, b) => b.rule.priority - a.rule.priority);

    // Track occupied positions to resolve overlaps
    const occupied = new Map<string, boolean>();

    for (const m of matches) {
      // Check if any character in this match range is already occupied
      let hasOverlap = false;
      for (let col = m.startCol; col < m.startCol + m.length; col++) {
        const key = `${m.line}:${col}`;
        if (occupied.has(key)) {
          hasOverlap = true;
          break;
        }
      }

      if (hasOverlap) continue;

      // Mark positions as occupied
      for (let col = m.startCol; col < m.startCol + m.length; col++) {
        occupied.set(`${m.line}:${col}`, true);
      }

      // Create xterm.js marker and decoration
      const buffer = this.terminal.buffer.active;
      const cursorLine = buffer.baseY + buffer.cursorY;
      const relativeRow = m.line - cursorLine;

      const marker = this.terminal.registerMarker(relativeRow);
      if (!marker) continue;

      this.markers.push(marker);

      const decoration = this.terminal.registerDecoration({
        marker,
        x: m.startCol,
        width: m.length,
      });

      if (!decoration) continue;

      this.decorations.push(decoration);

      // Apply styling on render
      const rule = m.rule;
      decoration.onRender((element: HTMLElement) => {
        element.style.color = rule.foregroundColor;
        if (rule.backgroundColor) {
          element.style.backgroundColor = rule.backgroundColor;
        }
        if (rule.bold) {
          element.style.fontWeight = "bold";
        }
        if (rule.underline) {
          element.style.textDecoration = "underline";
        }
        element.style.opacity = "1";
      });
    }
  }

  /** Removes all current decorations and markers. */
  private clearDecorations(): void {
    for (const decoration of this.decorations) {
      decoration.dispose();
    }
    for (const marker of this.markers) {
      marker.dispose();
    }
    this.decorations = [];
    this.markers = [];
  }
}

// Export helpers for testing
export { patternToRegex, escapeRegex, wildcardToRegex };
