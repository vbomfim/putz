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
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_CONFIG,
  type PtyExitPayload,
} from "./types";
import { HighlightEngine } from "./HighlightEngine";
import type { HighlightSet } from "./highlightTypes";

interface UseTerminalOptions {
  /** UUID v4 session identifier from pty_spawn. */
  sessionId: string;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback when the PTY process exits. */
  onExit?: (code: number) => void;
  /** Optional highlight set ID to load and apply. */
  highlightSetId?: string;
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
  /** Whether keyword highlighting is currently enabled. */
  highlightEnabled: boolean;
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

  // Store callbacks in refs to avoid effect re-runs
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Main effect: create terminal, bind events, set up I/O bridge
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    const container = terminalRef.current;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const terminal = new Terminal({
      fontSize: TERMINAL_CONFIG.fontSize,
      fontFamily: TERMINAL_CONFIG.fontFamily,
      scrollback: TERMINAL_CONFIG.scrollback,
      theme: DEFAULT_TERMINAL_THEME,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      screenReaderMode: true,
    });

    terminalInstanceRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // Load Unicode 11 addon for CJK/emoji support
    const unicodeAddon = new Unicode11Addon();
    terminal.loadAddon(unicodeAddon);
    terminal.unicode.activeVersion = "11";

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

    // Initial fit to container
    try {
      fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }

    // Initialize highlight engine
    const highlightEngine = new HighlightEngine(terminal);
    highlightEngineRef.current = highlightEngine;

    // Bridge: terminal keystrokes → PTY write
    const dataDisposable = terminal.onData((data: string) => {
      if (disposed) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {
        // pty_write failure — input dropped silently
      });
    });

    // Bridge: terminal binary data → PTY write
    const binaryDisposable = terminal.onBinary((data: string) => {
      if (disposed) return;
      const bytes = Array.from(data, (char) => char.charCodeAt(0));
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {
        // pty_write binary failure — input dropped silently
      });
    });

    // Bridge: terminal resize → PTY resize
    const resizeDisposable = terminal.onResize(
      ({ cols, rows }: { cols: number; rows: number }) => {
        if (disposed) return;
        invoke("pty_resize", { sessionId, cols, rows }).catch(() => {
          // pty_resize failure — terminal may be out of sync
        });
      },
    );

    // Title change detection (via escape sequences like \e]0;title\a)
    const titleDisposable = terminal.onTitleChange((title: string) => {
      onTitleChangeRef.current?.(title);
    });

    // Keyboard shortcut: Ctrl+Shift+H to toggle highlighting
    const keyHandler = terminal.attachCustomKeyEventHandler(
      (event: KeyboardEvent) => {
        if (
          event.type === "keydown" &&
          event.ctrlKey &&
          event.shiftKey &&
          event.key === "H"
        ) {
          const newState = highlightEngine.toggle();
          setHighlightEnabled(newState);
          return false; // Prevent default terminal handling
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
      resizeDebounceTimer = setTimeout(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
        } catch {
          // Ignore fit errors during resize
        }
      }, 100);
    };
    window.addEventListener("resize", handleWindowResize);

    // Sync initial PTY size after a short delay (DOM needs to settle)
    const initialSizeTimeout = setTimeout(() => {
      if (disposed) return;
      try {
        fitAddon.fit();
        const { cols, rows } = terminal;
        invoke("pty_resize", { sessionId, cols, rows }).catch(() => {
          // Ignore — PTY may not be ready yet
        });
      } catch {
        // Ignore fit errors
      }
    }, 100);

    // Cleanup on unmount
    return () => {
      disposed = true;
      clearTimeout(initialSizeTimeout);
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      window.removeEventListener("resize", handleWindowResize);

      // Dispose highlight engine
      highlightEngine.dispose();
      highlightEngineRef.current = null;

      dataDisposable.dispose();
      binaryDisposable.dispose();
      resizeDisposable.dispose();
      titleDisposable.dispose();
      keyHandler.dispose();

      for (const unlisten of unlisteners) {
        unlisten();
      }

      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;

      // Close the PTY session (fire-and-forget)
      invoke("pty_close", { sessionId }).catch(() => {
        // Ignore — session may already be closed
      });
    };
  }, [sessionId]);

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

  return {
    terminalRef,
    isReady,
    error,
    hasExited,
    exitCode,
    highlightEnabled,
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
