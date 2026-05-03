/**
 * TerminalView — React component wrapping xterm.js for terminal display.
 *
 * Renders a full-viewport terminal connected to a PTY session via Tauri IPC.
 * Handles loading, error, and process-exited states.
 * Includes an integrated search bar overlay (Ctrl+F).
 * Supports keyword highlighting with optional highlight set.
 *
 * Props:
 * - sessionId: UUID v4 identifying the PTY session
 * - onTitleChange: callback for shell title escape sequences
 * - onRestart: callback to restart a closed session
 * - isSearchOpen: whether the search bar should be visible
 * - onSearchClose: callback when search bar is closed
 * - highlightSetId: optional highlight set ID to apply
 * - onBell: callback when a visual bell (\a) is received
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { useTerminal } from "./useTerminal";
import { useSearch } from "./useSearch";
import { SearchBar } from "./SearchBar";
import {
  TerminalBackground,
  type BackgroundEffect,
} from "./TerminalBackground";
import { BELL_FLASH_CLASS, BELL_FLASH_DURATION_MS } from "./terminalPolish";
import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore } from "../../stores/themeStore";
import { CommandGutter } from "./CommandGutter";
import { CommandBlockContextMenu } from "./CommandBlockContextMenu";
import type { CommandBlock } from "../../stores/commandBlockStore";
import type { GetBufferLine } from "./bufferUtils";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalViewProps {
  /** UUID v4 session identifier from pty_spawn. */
  sessionId: string;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback to restart the terminal after the process exits. */
  onRestart?: () => void;
  /** Whether the search bar is open (controlled by parent). */
  isSearchOpen?: boolean;
  /** Callback to close the search bar. */
  onSearchClose?: () => void;
  /** Optional highlight set ID to apply for keyword highlighting. */
  highlightSetId?: string;
  /** Whether this terminal is a broadcast target (red border indicator). */
  isBroadcastTarget?: boolean;
  /** Optional ref to the tab element for visual bell flash. */
  tabElementId?: string;
  /** Callback when the PTY process exits. */
  onExit?: (code: number) => void;
}

/** Terminal emulator view connected to a PTY backend session. */
export function TerminalView({
  sessionId,
  onTitleChange,
  onRestart,
  isSearchOpen: externalSearchOpen,
  onSearchClose,
  highlightSetId,
  isBroadcastTarget,
  tabElementId,
  onExit,
}: TerminalViewProps) {
  const backgroundEffect = useSettingsStore(
    (s) => s.backgroundEffect,
  ) as BackgroundEffect;
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const backgroundColorMode = useSettingsStore((s) => s.backgroundColorMode);
  const backgroundCustomColor = useSettingsStore(
    (s) => s.backgroundCustomColor,
  );
  const backgroundSpeed = useSettingsStore((s) => s.backgroundSpeed);
  const backgroundSize = useSettingsStore((s) => s.backgroundSize) as
    | "small"
    | "medium"
    | "large";
  const termColors = useThemeStore((s) => s.activeColors);
  const fgColor =
    (termColors as Record<string, string> | null)?.foreground || "#cdd6f4";

  // Resolve the animation color based on mode
  const effectColor =
    backgroundColorMode === "custom"
      ? backgroundCustomColor
      : backgroundColorMode === "rainbow"
        ? "rainbow"
        : backgroundColorMode === "multicolor"
          ? "multicolor"
          : fgColor;

  // Title change handler — forwards to parent callback
  const handleTitleChange = useCallback(
    (title: string) => {
      onTitleChange?.(title);
    },
    [onTitleChange],
  );

  // Fix 3: Visual bell — briefly flash the terminal wrapper
  const handleBell = useCallback(() => {
    // Flash the tab element if available, otherwise flash the terminal wrapper
    const targetId = tabElementId;
    if (targetId) {
      const tabEl = document.querySelector(`[data-tab-id="${targetId}"]`);
      if (tabEl) {
        tabEl.classList.add(BELL_FLASH_CLASS);
        setTimeout(
          () => tabEl.classList.remove(BELL_FLASH_CLASS),
          BELL_FLASH_DURATION_MS,
        );
        return;
      }
    }
    // Fallback: flash the terminal wrapper
    const wrapper = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (wrapper) {
      wrapper.classList.add(BELL_FLASH_CLASS);
      setTimeout(
        () => wrapper.classList.remove(BELL_FLASH_CLASS),
        BELL_FLASH_DURATION_MS,
      );
    }
  }, [tabElementId, sessionId]);

  const {
    terminalRef,
    isReady,
    error,
    hasExited,
    highlightEnabled,
    terminalInstance,
  } = useTerminal({
    sessionId,
    onTitleChange: handleTitleChange,
    onExit,
    highlightSetId,
    onBell: handleBell,
  });

  const search = useSearch({ terminal: terminalInstance });

  // Sync xterm theme.background transparency to the animated-effect setting.
  // When an effect is active, override the theme's background to a semi-transparent
  // value so the canvas behind shows through. When 'none', restore the theme bg.
  useEffect(() => {
    const term = terminalInstance;
    if (!term) return;
    const themeBase = termColors || term.options.theme || {};
    if (backgroundEffect === "none") {
      term.options.theme = themeBase;
    } else {
      term.options.theme = {
        ...themeBase,
        background: "rgba(0, 0, 0, 0)", // fully transparent — backgroundOpacity controls canvas alpha
      };
    }
  }, [terminalInstance, backgroundEffect, termColors]);

  // ── Gutter state: viewport scroll + cell height ──────────────────────
  const [viewportTop, setViewportTop] = useState(0);
  const [cellHeight, setCellHeight] = useState(17); // sensible default
  const [rows, setRows] = useState(terminalInstance?.rows ?? 24);
  const [contextMenu, setContextMenu] = useState<{
    block: CommandBlock;
    position: { x: number; y: number };
  } | null>(null);
  const terminalInstanceRef = useRef(terminalInstance);
  terminalInstanceRef.current = terminalInstance;

  // Subscribe to xterm scroll events and measure cell height
  useEffect(() => {
    const term = terminalInstance;
    if (!term) return;

    // Measure cell height from the terminal element
    const measureCellHeight = () => {
      const el = term.element;
      if (el && term.rows > 0) {
        const height = el.clientHeight / term.rows;
        if (height > 0) setCellHeight(height);
      }
    };

    measureCellHeight();

    // Update viewportTop on scroll
    const scrollDisposable = term.onScroll(() => {
      setViewportTop(term.buffer.active.viewportY);
    });

    // Re-measure on resize and update row count
    const resizeDisposable = term.onResize(({ rows: newRows }) => {
      measureCellHeight();
      setRows(newRows);
    });

    return () => {
      scrollDisposable.dispose();
      resizeDisposable.dispose();
    };
  }, [terminalInstance]);

  // ── Context menu handlers ────────────────────────────────────────────
  const handleDotContextMenu = useCallback(
    (block: CommandBlock, event: React.MouseEvent) => {
      setContextMenu({
        block,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getBufferLine: GetBufferLine = useCallback((row: number) => {
    const term = terminalInstanceRef.current;
    if (!term) return null;
    const line = term.buffer.active.getLine(row);
    return line ?? null;
  }, []);

  // Use external search state if provided, otherwise internal
  const searchOpen =
    externalSearchOpen !== undefined ? externalSearchOpen : search.isSearchOpen;

  const handleSearchClose = () => {
    search.closeSearch();
    onSearchClose?.();
  };

  if (error) {
    return (
      <div className="terminal-error" data-testid="terminal-error">
        <h2>Terminal Error</h2>
        <p>{error}</p>
        <p className="terminal-error-hint">
          Check that a shell is available on your system.
        </p>
        {onRestart && (
          <button
            className="terminal-restart-btn"
            onClick={onRestart}
            type="button"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`terminal-wrapper${isBroadcastTarget ? " terminal-wrapper--broadcast-target" : ""}`}
      data-testid="terminal-wrapper"
      data-session-id={sessionId}
    >
      <TerminalBackground
        effect={backgroundEffect}
        opacity={backgroundOpacity}
        color={effectColor}
        speed={backgroundSpeed}
        size={backgroundSize}
      />
      {searchOpen && (
        <SearchBar
          onSearch={search.findNext}
          onSearchPrevious={search.findPrevious}
          onClose={handleSearchClose}
          onCaseSensitiveToggle={search.toggleCaseSensitive}
          onRegexToggle={search.toggleRegex}
          hasResults={search.hasResults}
          caseSensitive={search.caseSensitive}
          useRegex={search.useRegex}
        />
      )}
      {!isReady && (
        <div className="terminal-loading" data-testid="terminal-loading">
          <span>Starting terminal…</span>
        </div>
      )}
      <div
        ref={terminalRef}
        className="terminal-container"
        data-testid="terminal-container"
      />
      <CommandGutter
        sessionId={sessionId}
        cellHeight={cellHeight}
        viewportTop={viewportTop}
        rows={rows}
        onDotContextMenu={handleDotContextMenu}
      />
      {contextMenu && (
        <CommandBlockContextMenu
          block={contextMenu.block}
          position={contextMenu.position}
          onClose={handleContextMenuClose}
          getBufferLine={getBufferLine}
          totalBufferLength={terminalInstance?.buffer.active.length ?? 0}
        />
      )}
      {highlightEnabled && (
        <div
          className="terminal-highlight-indicator"
          data-testid="highlight-indicator"
          title="Keyword highlighting active (Ctrl+Shift+H to toggle)"
        >
          HL
        </div>
      )}
      {hasExited && onRestart && (
        <div
          className="terminal-exit-overlay"
          data-testid="terminal-exit-overlay"
        >
          <button
            className="terminal-restart-btn"
            onClick={onRestart}
            type="button"
          >
            Restart Terminal
          </button>
        </div>
      )}
    </div>
  );
}
