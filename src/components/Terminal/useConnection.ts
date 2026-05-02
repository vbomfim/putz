/**
 * Custom React hook for protocol connection lifecycle management.
 *
 * Manages the xterm.js Terminal instance connected to a remote host
 * via Tauri IPC protocol commands (connection_open, connection_write,
 * connection_resize, connection_close).
 *
 * Similar to useTerminal but for remote connections (Telnet/SSH/Serial)
 * instead of local PTY sessions.
 *
 * @module useConnection
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DEFAULT_TERMINAL_THEME, TERMINAL_CONFIG } from "./types";
import type {
  ConnectionOpenInput,
  ConnectionStatusPayload,
  ConnectionStatusType,
  HostKeyPayload,
  AuthPromptPayload,
} from "./connectionTypes";
import {
  WORD_SEPARATOR,
  FONT_SIZE_DEFAULT,
  WAKE_RECONNECT_GRACE_MS,
  clampFontSize,
} from "./terminalPolish";

interface UseConnectionOptions {
  /** Session profile details for the connection. */
  connectionConfig: ConnectionOpenInput;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback when the connection status changes. */
  onStatusChange?: (status: ConnectionStatusType, message?: string) => void;
  /** Callback when a host key verification event is received. */
  onHostKey?: (payload: HostKeyPayload) => void;
  /** Callback when an auth prompt event is received. */
  onAuthPrompt?: (payload: AuthPromptPayload) => void;
}

interface UseConnectionReturn {
  /** Ref to attach to the terminal container DOM element. */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the terminal is mounted and ready. */
  isReady: boolean;
  /** Error message if terminal setup failed. */
  error: string | null;
  /** Current connection status. */
  status: ConnectionStatusType;
  /** Status message (e.g., error description). */
  statusMessage: string | null;
  /** Reconnect function — opens a new connection. */
  reconnect: () => void;
  /** Host key payload if verification event received. */
  hostKey: HostKeyPayload | null;
  /** Auth prompt payload if auth prompt event received. */
  authPrompt: AuthPromptPayload | null;
}

/**
 * React hook that manages a remote terminal connection lifecycle.
 *
 * Handles: Terminal creation → addon loading → connection open →
 * event binding → I/O bridging → resize sync → cleanup on unmount.
 */
export function useConnection({
  connectionConfig,
  onTitleChange,
  onStatusChange,
  onHostKey,
  onAuthPrompt,
}: UseConnectionOptions): UseConnectionReturn {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatusType>("connecting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [hostKey, setHostKey] = useState<HostKeyPayload | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptPayload | null>(null);

  // Store callbacks in refs to avoid effect re-runs
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onHostKeyRef = useRef(onHostKey);
  onHostKeyRef.current = onHostKey;
  const onAuthPromptRef = useRef(onAuthPrompt);
  onAuthPromptRef.current = onAuthPrompt;

  const reconnect = useCallback(() => {
    setError(null);
    setStatus("connecting");
    setStatusMessage(null);
    setReconnectKey((k) => k + 1);
  }, []);

  // Main effect: create terminal, open connection, bind events
  useEffect(() => {
    if (!terminalRef.current) return;

    const container = terminalRef.current;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    let activeConnectionId: string | null = null;

    const terminal = new Terminal({
      fontSize: TERMINAL_CONFIG.fontSize,
      fontFamily: TERMINAL_CONFIG.fontFamily,
      scrollback: TERMINAL_CONFIG.scrollback,
      theme: DEFAULT_TERMINAL_THEME,
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

    // Fix 6: Load clickable URL addon
    try {
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank");
      });
      terminal.loadAddon(webLinksAddon);
    } catch {
      // Non-critical
    }

    // Open terminal in the DOM container
    terminal.open(container);

    // Try WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      console.warn("WebGL addon failed to load, using canvas renderer");
    }

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }

    // Title change detection
    const titleDisposable = terminal.onTitleChange((title: string) => {
      onTitleChangeRef.current?.(title);
    });

    // Fix 1: Right-click paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (disposed || !activeConnectionId) return;
      const connId = activeConnectionId;
      navigator.clipboard
        .readText()
        .then((text) => {
          if (!text || disposed) return;
          terminal.paste(text);
          const bytes = new TextEncoder().encode(text);
          const base64 = btoa(String.fromCharCode(...bytes));
          invoke("connection_write", {
            connectionId: connId,
            data: base64,
          }).catch(() => {});
        })
        .catch(() => {});
    };
    container.addEventListener("contextmenu", handleContextMenu);

    // Fix 2 & 7: Keyboard shortcuts
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown") return true;

      // Ctrl+Shift+C — copy selection
      if (event.ctrlKey && event.shiftKey && event.key === "C") {
        const selection = terminal.getSelection();
        if (selection) navigator.clipboard.writeText(selection).catch(() => {});
        return false;
      }

      // Ctrl+Shift+V — paste
      if (event.ctrlKey && event.shiftKey && event.key === "V") {
        if (!activeConnectionId) return false;
        const connId = activeConnectionId;
        navigator.clipboard
          .readText()
          .then((text) => {
            if (!text || disposed) return;
            terminal.paste(text);
            const bytes = new TextEncoder().encode(text);
            const base64 = btoa(String.fromCharCode(...bytes));
            invoke("connection_write", {
              connectionId: connId,
              data: base64,
            }).catch(() => {});
          })
          .catch(() => {});
        return false;
      }

      // Fix 7: Ctrl+= / Ctrl+Plus — increase font size
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        (event.key === "=" || event.key === "+")
      ) {
        const current = terminal.options.fontSize ?? FONT_SIZE_DEFAULT;
        terminal.options.fontSize = clampFontSize(current + 1);
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
        return false;
      }

      // Fix 7: Ctrl+- — decrease font size
      if (event.ctrlKey && !event.shiftKey && event.key === "-") {
        const current = terminal.options.fontSize ?? FONT_SIZE_DEFAULT;
        terminal.options.fontSize = clampFontSize(current - 1);
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
        return false;
      }

      // Fix 7: Ctrl+0 — reset font size
      if (event.ctrlKey && !event.shiftKey && event.key === "0") {
        terminal.options.fontSize = FONT_SIZE_DEFAULT;
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
        return false;
      }

      return true;
    });

    // Open connection and set up I/O bridges
    const setup = async () => {
      try {
        // Get terminal dimensions after fit
        const { cols, rows } = terminal;

        // Open the connection
        const connectionId = await invoke<string>("connection_open", {
          input: {
            ...connectionConfig,
            cols,
            rows,
          },
        });

        if (disposed) {
          // Component unmounted during connect — close immediately
          invoke("connection_close", { connectionId }).catch(() => {});
          return;
        }

        activeConnectionId = connectionId;
        connectionIdRef.current = connectionId;

        // Bridge: terminal keystrokes → connection write
        const dataDisposable = terminal.onData((data: string) => {
          if (disposed) return;
          const bytes = new TextEncoder().encode(data);
          const base64 = btoa(String.fromCharCode(...bytes));
          invoke("connection_write", { connectionId, data: base64 }).catch(
            () => {},
          );
        });

        // Bridge: terminal binary data → connection write
        const binaryDisposable = terminal.onBinary((data: string) => {
          if (disposed) return;
          const base64 = btoa(data);
          invoke("connection_write", { connectionId, data: base64 }).catch(
            () => {},
          );
        });

        // Bridge: terminal resize → connection resize
        const resizeDisposable = terminal.onResize(
          ({ cols, rows }: { cols: number; rows: number }) => {
            if (disposed) return;
            invoke("connection_resize", { connectionId, cols, rows }).catch(
              () => {},
            );
          },
        );

        // Listen for connection output (base64 encoded, same as PTY)
        const unlistenOutput = await listen<string>(
          `connection-output-${connectionId}`,
          (event) => {
            if (disposed) return;
            const binary = atob(event.payload);
            const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
            terminal.write(bytes);
          },
        );
        unlisteners.push(unlistenOutput);

        // Listen for connection status changes
        const unlistenStatus = await listen<ConnectionStatusPayload>(
          `connection-status-${connectionId}`,
          (event) => {
            if (disposed) return;
            const { status: newStatus, message } = event.payload;
            setStatus(newStatus);
            setStatusMessage(message ?? null);
            onStatusChangeRef.current?.(newStatus, message);

            if (newStatus === "disconnected" || newStatus === "error") {
              const msg =
                message ??
                (newStatus === "error" ? "Connection error" : "Disconnected");
              terminal.write(`\r\n\x1b[90m[${msg}]\x1b[0m\r\n`);
            }
          },
        );
        unlisteners.push(unlistenStatus);

        // Listen for SSH host key verification events
        const unlistenHostKey = await listen<string>(
          `connection-hostkey-${connectionId}`,
          (event) => {
            if (disposed) return;
            try {
              const payload: HostKeyPayload = JSON.parse(event.payload);
              setHostKey(payload);
              onHostKeyRef.current?.(payload);
            } catch {
              // Malformed payload — ignore
            }
          },
        );
        unlisteners.push(unlistenHostKey);

        // Listen for SSH host key warning events (MITM)
        const unlistenHostKeyWarning = await listen<string>(
          `connection-hostkey-warning-${connectionId}`,
          (event) => {
            if (disposed) return;
            try {
              const payload: HostKeyPayload = JSON.parse(event.payload);
              setHostKey(payload);
              onHostKeyRef.current?.(payload);
            } catch {
              // Malformed payload — ignore
            }
          },
        );
        unlisteners.push(unlistenHostKeyWarning);

        // Listen for SSH auth prompt events
        const unlistenAuthPrompt = await listen<string>(
          `connection-auth-prompt-${connectionId}`,
          (event) => {
            if (disposed) return;
            try {
              const payload: AuthPromptPayload = JSON.parse(event.payload);
              setAuthPrompt(payload);
              onAuthPromptRef.current?.(payload);
            } catch {
              // Malformed payload — ignore
            }
          },
        );
        unlisteners.push(unlistenAuthPrompt);

        // Store disposables for cleanup
        unlisteners.push(() => dataDisposable.dispose());
        unlisteners.push(() => binaryDisposable.dispose());
        unlisteners.push(() => resizeDisposable.dispose());

        if (!disposed) {
          setIsReady(true);
        }
      } catch (err: unknown) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Connection failed: ${message}`);
          setStatus("error");
          setStatusMessage(message);
        }
      }
    };

    setup();

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

    // Fix 9: Detect system sleep/resume via visibilitychange.
    // When the page becomes visible again after being hidden, check if
    // the connection is still alive. If it was connected but is now
    // disconnected, show a reconnect prompt.
    let lastHiddenAt = 0;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
        return;
      }
      // Page just became visible — check if we were away long enough
      if (!disposed && lastHiddenAt > 0) {
        const elapsed = Date.now() - lastHiddenAt;
        if (elapsed > WAKE_RECONNECT_GRACE_MS && activeConnectionId) {
          // Try a small status check — if the connection dropped while
          // we were asleep, the backend will have already emitted a
          // disconnected status event. We just need to nudge the UI
          // by writing a zero-length check or refreshing the terminal.
          try {
            fitAddon.fit();
          } catch {
            // Ignore
          }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup on unmount
    return () => {
      disposed = true;
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      container.removeEventListener("contextmenu", handleContextMenu);
      titleDisposable.dispose();

      for (const unlisten of unlisteners) {
        if (typeof unlisten === "function") {
          unlisten();
        }
      }

      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;

      // Close the connection (fire-and-forget)
      if (activeConnectionId) {
        invoke("connection_close", {
          connectionId: activeConnectionId,
        }).catch(() => {});
      }
      connectionIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectKey]);

  return {
    terminalRef,
    isReady,
    error,
    status,
    statusMessage,
    reconnect,
    hostKey,
    authPrompt,
  };
}
