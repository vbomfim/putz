/**
 * Custom React hook for terminal lifecycle management.
 *
 * Manages the xterm.js Terminal instance, Tauri event listeners,
 * addon loading, keyword highlighting, and cleanup. Isolates terminal
 * plumbing from the React component tree.
 *
 * @module useTerminal
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_CONFIG,
  type PtyExitPayload,
} from "./types";
import { useThemeStore } from "../../stores/themeStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { HighlightEngine } from "./HighlightEngine";
import type { HighlightSet } from "./highlightTypes";
import { broadcastWrite } from "../../utils/broadcastHelper";
import {
  WORD_SEPARATOR,
  FONT_SIZE_DEFAULT,
  clampFontSize,
} from "./terminalPolish";
import { changeWindowCheck } from "../Compliance/complianceApi";

interface UseTerminalOptions {
  /** UUID v4 session identifier from pty_spawn. */
  sessionId: string;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback when the PTY process exits. */
  onExit?: (code: number) => void;
  /** Optional highlight set ID to load and apply. */
  highlightSetId?: string;
  /** Callback when a visual bell is triggered. */
  onBell?: () => void;
  /** Whether change window enforcement is enabled. */
  changeWindowEnabled?: boolean;
}

interface UseTerminalReturn {
  /** Ref to attach to the terminal container DOM element. */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the terminal is mounted and ready. */
  isReady: boolean;
  /** Error message if terminal setup failed. */
  error: string | null;
  /** Whether the PTY process has exited. */
  hasExited: boolean;
  /** Exit code of the PTY process (null if still running). */
  exitCode: number | null;
  /** Reference to the xterm Terminal instance (for addons like search). */
  terminalInstance: Terminal | null;
  /** Whether keyword highlighting is currently enabled. */
  highlightEnabled: boolean;
  /** Change window guard state — pending warning for dangerous commands. */
  changeWindowWarning: {
    show: boolean;
    command: string;
    reason: string;
  };
  /** Called when user clicks "Proceed Anyway" on change window warning. */
  onChangeWindowProceed: () => void;
  /** Called when user clicks "Cancel" on change window warning. */
  onChangeWindowCancel: () => void;
}

/**
 * Writes clipboard text to the terminal and PTY.
 * Shared by right-click paste and Ctrl+Shift+V.
 */
async function pasteToTerminal(
  terminal: Terminal,
  _sessionId: string,
): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    // terminal.paste() triggers onData which calls pty_write — no need to write again
    terminal.paste(text);
  } catch {
    // Clipboard read failed — permission denied or empty
  }
}

/**
 * React hook that manages the full xterm.js terminal lifecycle.
 *
 * Handles: Terminal creation → addon loading → event binding →
 * PTY I/O bridging → resize sync → highlight engine → cleanup on unmount.
 */
export function useTerminal({
  sessionId,
  onTitleChange,
  onExit,
  highlightSetId,
  onBell,
  changeWindowEnabled = false,
}: UseTerminalOptions): UseTerminalReturn {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const highlightEngineRef = useRef<HighlightEngine | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExited, setHasExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [highlightEnabled, setHighlightEnabled] = useState(false);

  // Change window guard state
  const lineBufferRef = useRef<string>("");
  const pendingDataRef = useRef<string>("");
  const [cwWarning, setCwWarning] = useState({
    show: false,
    command: "",
    reason: "",
  });
  const changeWindowEnabledRef = useRef(changeWindowEnabled);
  changeWindowEnabledRef.current = changeWindowEnabled;

  // Store callbacks in refs to avoid effect re-runs
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onBellRef = useRef(onBell);
  onBellRef.current = onBell;

  // Main effect: create terminal, bind events, set up I/O bridge
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    const container = terminalRef.current;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    // Read initial font/theme from themeStore
    const themeState = useThemeStore.getState();
    const initialFontSettings = themeState.fontSettings;
    const initialColors = themeState.activeColors;

    const terminal = new Terminal({
      fontSize: initialFontSettings.fontSize,
      fontFamily: initialFontSettings.fontFamily,
      scrollback: TERMINAL_CONFIG.scrollback,
      theme: initialColors || DEFAULT_TERMINAL_THEME,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      screenReaderMode: true,
      // Fix 5: Better word separators for double-click selection
      wordSeparator: WORD_SEPARATOR,
    });

    terminalInstanceRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // Load Unicode 11 addon for CJK/emoji support
    const unicodeAddon = new Unicode11Addon();
    terminal.loadAddon(unicodeAddon);
    terminal.unicode.activeVersion = "11";

    // Fix 6: Load clickable URL addon — opens links in default browser
    try {
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank");
      });
      terminal.loadAddon(webLinksAddon);
    } catch {
      // WebLinksAddon not critical — URLs just won't be clickable
    }

    // File path link provider — Ctrl+click opens in editor tab
    // Detects absolute paths and filenames with extensions (e.g. from ls output)
    terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString();
        const links: { startIndex: number; length: number; text: string; isRelative: boolean }[] = [];

        // Match absolute paths: /path/to/file.ext
        const absRegex = /(?:^|\s)(\/[\w./-]+\.\w{1,10})\b/g;
        let match: RegExpExecArray | null;
        while ((match = absRegex.exec(text)) !== null) {
          const path = match[1];
          const startIndex = match.index + match[0].indexOf(path);
          links.push({ startIndex, length: path.length, text: path, isRelative: false });
        }

        // Match filenames with common config/script extensions anywhere in line
        // (covers ls output "CR4.txt", ls -lah trailing filenames, etc.)
        const fileExts = "txt|cfg|conf|config|ios|acl|js|ts|py|sh|yaml|yml|json|xml|csv|log|bak|md";
        const fnRegex = new RegExp(`(?:^|\\s)([\\w][\\w.+-]*\\.(?:${fileExts}))(?=\\s|$)`, "gi");
        while ((match = fnRegex.exec(text)) !== null) {
          const fname = match[1];
          const startIndex = match.index + match[0].indexOf(fname);
          // Skip if already matched as absolute path
          if (links.some((l) => l.startIndex === startIndex)) continue;
          links.push({ startIndex, length: fname.length, text: fname, isRelative: true });
        }

        if (links.length === 0) { callback(undefined); return; }
        callback(links.map((l) => ({
          range: {
            start: { x: l.startIndex + 1, y: bufferLineNumber },
            end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
          },
          text: l.text,
          activate() {
            const { addEditorTab } = useLayoutStore.getState();
            if (l.isRelative) {
              // Resolve relative path via PTY's working directory
              invoke<string>("pty_cwd", { sessionId })
                .then((cwd) => {
                  const fullPath = cwd.endsWith("/")
                    ? `${cwd}${l.text}`
                    : `${cwd}/${l.text}`;
                  addEditorTab(undefined, fullPath);
                })
                .catch(() => {
                  // Fallback: open just the filename
                  addEditorTab(undefined, l.text);
                });
            } else {
              addEditorTab(undefined, l.text);
            }
          },
        })));
      },
    });

    // Open terminal in the DOM container
    terminal.open(container);

    // Try WebGL addon for GPU-accelerated rendering, fall back to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available — canvas renderer is the automatic fallback
      console.warn("WebGL addon failed to load, using canvas renderer");
    }

    /**
     * Safely fits the terminal to its container.
     * Guards against zero-dimension containers (e.g., during Allotment animation)
     * and syncs the PTY size after a successful fit.
     * Only sends pty_resize if dimensions actually changed.
     */
    let lastCols = 0;
    let lastRows = 0;
    const safeFit = () => {
      if (disposed) return;
      const el = terminalRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fitAddon.fit();
        const { cols, rows } = terminal;
        if (cols > 0 && rows > 0 && (cols !== lastCols || rows !== lastRows)) {
          lastCols = cols;
          lastRows = rows;
          invoke("pty_resize", { sessionId, cols, rows }).catch(() => {});
        }
      } catch {
        // Container may not be visible yet
      }
    };

    // Initial fit to container
    safeFit();

    // Staggered retry fits — Allotment split animation may not have
    // settled dimensions yet. Multiple retries at increasing intervals
    // ensure the terminal renders correctly in new split panes.
    const fitTimers = [
      setTimeout(safeFit, 150),
      setTimeout(safeFit, 500),
      setTimeout(safeFit, 1000),
    ];

    // Initialize highlight engine
    const highlightEngine = new HighlightEngine(terminal);
    highlightEngineRef.current = highlightEngine;

    // Fix 3: Visual bell — notify parent via callback
    terminal.onBell(() => {
      onBellRef.current?.();
    });

    // Fix 1: Right-click paste — read clipboard and write to terminal + PTY
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (disposed) return;
      pasteToTerminal(terminal, sessionId);
    };
    container.addEventListener("contextmenu", handleContextMenu);

    // Track focused pane — when user clicks this terminal, update store
    // so splitActivePane targets the correct pane
    const handlePaneFocus = () => {
      if (disposed) return;
      useTabStore.getState().setFocusedPane(sessionId);
    };
    container.addEventListener("mousedown", handlePaneFocus);

    // Bridge: terminal keystrokes → PTY write (with change window guard)
    terminal.onData((data: string) => {
      if (disposed) return;

      // Change window guard: buffer and check on Enter
      if (changeWindowEnabledRef.current && (data.includes("\r") || data.includes("\n"))) {
        const command = lineBufferRef.current.trim();
        lineBufferRef.current = "";

        if (command) {
          // Check command asynchronously — hold back Enter key
          pendingDataRef.current = data;
          changeWindowCheck(command)
            .then((result) => {
              if (disposed) return;
              if (result.allowed) {
                // Command allowed — forward the data
                const bytes = Array.from(new TextEncoder().encode(data));
                broadcastWrite(sessionId, bytes);
                invoke("pty_write", { sessionId, data: bytes }).catch(() => {});
              } else {
                // Command blocked — show warning
                setCwWarning({
                  show: true,
                  command,
                  reason: result.reason,
                });
              }
            })
            .catch(() => {
              // Backend error — fail open, forward data
              if (disposed) return;
              const bytes = Array.from(new TextEncoder().encode(data));
              broadcastWrite(sessionId, bytes);
              invoke("pty_write", { sessionId, data: bytes }).catch(() => {});
            });
          return; // Don't forward yet — wait for check result
        }
      }

      // Buffer characters for change window guard
      if (changeWindowEnabledRef.current) {
        for (const ch of data) {
          if (ch === "\x7f" || ch === "\b") {
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          } else if (ch.charCodeAt(0) >= 32) {
            lineBufferRef.current += ch;
          }
        }
      }

      const bytes = Array.from(new TextEncoder().encode(data));
      broadcastWrite(sessionId, bytes);
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {
        // pty_write failure — input dropped silently
      });
    });

    // Bridge: terminal binary data → PTY write
    terminal.onBinary((binaryData: string) => {
      if (disposed) return;
      const bytes = Array.from(binaryData, (char) => char.charCodeAt(0));
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {
        // pty_write binary failure — input dropped silently
      });
    });

    // Bridge: terminal resize → PTY resize
    terminal.onResize(
      ({ cols, rows }: { cols: number; rows: number }) => {
        if (disposed) return;
        invoke("pty_resize", { sessionId, cols, rows }).catch(() => {
          // pty_resize failure — terminal may be out of sync
        });
      },
    );

    // Title change detection (via escape sequences like \e]0;title\a)
    terminal.onTitleChange((title: string) => {
      onTitleChangeRef.current?.(title);
    });

    // Keyboard shortcuts: Cmd/Ctrl+C/V/A (copy/paste/select-all),
    // Ctrl+Shift+H (highlight), Ctrl+Plus/Minus/0 (font zoom)
    terminal.attachCustomKeyEventHandler(
      (event: KeyboardEvent) => {
        if (event.type !== "keydown") return true;

        const isMod = event.metaKey || event.ctrlKey;

        // Cmd+C / Ctrl+C — copy selection (if any), otherwise send SIGINT
        if (isMod && !event.shiftKey && event.key === "c") {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch(() => {});
            return false; // Consumed — don't send to PTY
          }
          // No selection → let xterm send Ctrl+C (SIGINT) to PTY
          return true;
        }

        // Cmd+V / Ctrl+V — paste from clipboard
        if (isMod && !event.shiftKey && event.key === "v") {
          pasteToTerminal(terminal, sessionId);
          return false;
        }

        // Cmd+A / Ctrl+A — select all terminal content
        if (isMod && !event.shiftKey && event.key === "a") {
          terminal.selectAll();
          return false;
        }

        // Ctrl+Shift+C — copy (Linux-style, always copies)
        if (event.ctrlKey && event.shiftKey && event.key === "C") {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch(() => {});
          }
          return false;
        }

        // Ctrl+Shift+V — paste (Linux-style)
        if (event.ctrlKey && event.shiftKey && event.key === "V") {
          pasteToTerminal(terminal, sessionId);
          return false;
        }

        // Ctrl+Shift+H — toggle highlighting
        if (event.ctrlKey && event.shiftKey && event.key === "H") {
          const newState = highlightEngine.toggle();
          setHighlightEnabled(newState);
          return false;
        }

        // Ctrl+= or Ctrl+Plus — increase font size
        if (event.ctrlKey && !event.shiftKey && (event.key === "=" || event.key === "+")) {
          const current = terminal.options.fontSize ?? FONT_SIZE_DEFAULT;
          terminal.options.fontSize = clampFontSize(current + 1);
          try { fitAddon.fit(); } catch { /* ignore */ }
          return false;
        }

        // Ctrl+- — decrease font size
        if (event.ctrlKey && !event.shiftKey && event.key === "-") {
          const current = terminal.options.fontSize ?? FONT_SIZE_DEFAULT;
          terminal.options.fontSize = clampFontSize(current - 1);
          try { fitAddon.fit(); } catch { /* ignore */ }
          return false;
        }

        // Ctrl+0 — reset font size to default
        if (event.ctrlKey && !event.shiftKey && event.key === "0") {
          terminal.options.fontSize = FONT_SIZE_DEFAULT;
          try { fitAddon.fit(); } catch { /* ignore */ }
          return false;
        }

        return true; // Allow normal key processing
      },
    );

    // Set up Tauri event listeners (async)
    const setupEvents = async () => {
      // PTY output → terminal write (base64-encoded from Rust backend)
      const unlistenOutput = await listen<string>(
        `pty-output-${sessionId}`,
        (event) => {
          if (disposed) return;
          const binary = atob(event.payload);
          const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
          terminal.write(bytes);
        },
      );
      unlisteners.push(unlistenOutput);

      // PTY exit → show exit message
      const unlistenExit = await listen<PtyExitPayload>(
        `pty-exit-${sessionId}`,
        (event) => {
          if (disposed) return;
          const code = event.payload.code;
          setHasExited(true);
          setExitCode(code);
          terminal.write(
            `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`,
          );
          onExitRef.current?.(code);
        },
      );
      unlisteners.push(unlistenExit);

      if (!disposed) {
        setIsReady(true);
      }
    };

    setupEvents().catch((err: unknown) => {
      if (!disposed) {
        setError(`Failed to set up terminal events: ${String(err)}`);
      }
    });

    // Window resize → re-fit terminal (debounced at 100ms)
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWindowResize = () => {
      if (disposed) return;
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      resizeDebounceTimer = setTimeout(safeFit, 100);
    };
    window.addEventListener("resize", handleWindowResize);

    // ResizeObserver — re-fit when container size changes (e.g., Allotment split resize)
    // Debounced at 50ms to avoid fitting during rapid Allotment animation
    let resizeObserverTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      if (resizeObserverTimer !== null) {
        clearTimeout(resizeObserverTimer);
      }
      resizeObserverTimer = setTimeout(safeFit, 50);
    });
    resizeObserver.observe(container);

    // Sync initial PTY size after a short delay (DOM needs to settle)
    const initialSizeTimeout = setTimeout(safeFit, 100);

    // Cleanup on unmount
    return () => {
      disposed = true;
      clearTimeout(initialSizeTimeout);
      for (const t of fitTimers) clearTimeout(t);
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      if (resizeObserverTimer !== null) {
        clearTimeout(resizeObserverTimer);
      }
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("mousedown", handlePaneFocus);

      highlightEngine.dispose();
      highlightEngineRef.current = null;

      for (const unlisten of unlisteners) {
        unlisten();
      }

      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;

      // NOTE: We do NOT call pty_close here. The PTY session lifecycle is
      // managed by layoutStore.closeTab(). Closing the PTY on unmount would
      // kill the session when closing tabs.
    };
  }, [sessionId]);

  // Effect: subscribe to themeStore for live theme/font changes
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe((state) => {
      const term = terminalInstanceRef.current;
      if (!term) return;
      
      // Apply font changes
      if (state.fontSettings) {
        term.options.fontSize = state.fontSettings.fontSize;
        term.options.fontFamily = state.fontSettings.fontFamily;
        term.options.lineHeight = state.fontSettings.lineHeight;
      }
      
      // Apply theme colors
      if (state.activeColors) {
        term.options.theme = state.activeColors;
      }
      
      // Re-fit after font change
      try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
    });
    return unsubscribe;
  }, []);

  // Effect: load and apply highlight set when highlightSetId changes
  useEffect(() => {
    if (!highlightSetId || !highlightEngineRef.current) return;

    let cancelled = false;

    const loadHighlightSet = async () => {
      try {
        const set = await invoke<HighlightSet>("highlight_get_set", {
          id: highlightSetId,
        });
        if (!cancelled && highlightEngineRef.current) {
          highlightEngineRef.current.setRules(set.rules);
          highlightEngineRef.current.enable();
          setHighlightEnabled(true);
        }
      } catch {
        // Failed to load highlight set — highlighting not available
        // Fail silently: highlighting is a non-critical feature
      }
    };

    loadHighlightSet();

    return () => {
      cancelled = true;
    };
  }, [highlightSetId]);

  // Change window guard — Proceed and Cancel handlers
  const handleChangeWindowProceed = useCallback(() => {
    // User chose "Proceed Anyway" — forward the held-back data
    const data = pendingDataRef.current;
    pendingDataRef.current = "";
    setCwWarning({ show: false, command: "", reason: "" });

    if (data) {
      const bytes = Array.from(new TextEncoder().encode(data));
      broadcastWrite(sessionId, bytes);
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {});
    }
  }, [sessionId]);

  const handleChangeWindowCancel = useCallback(() => {
    // User cancelled — discard the held-back data
    pendingDataRef.current = "";
    setCwWarning({ show: false, command: "", reason: "" });
  }, []);

  return {
    terminalRef,
    isReady,
    error,
    hasExited,
    exitCode,
    terminalInstance: terminalInstanceRef.current,
    highlightEnabled,
    changeWindowWarning: cwWarning,
    onChangeWindowProceed: handleChangeWindowProceed,
    onChangeWindowCancel: handleChangeWindowCancel,
  };
}

/**
 * Triggers a re-fit of the terminal to its container.
 * Exported for use by parent components that change layout.
 */
export function useFitTerminal(
  fitAddonRef: React.RefObject<FitAddon | null>,
): () => void {
  return useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // Ignore fit errors
    }
  }, [fitAddonRef]);
}
