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
// WebglAddon intentionally NOT imported — known compositor bug with WebView2
// causes stale-pixel artifacts under overlays. Using xterm's default renderer.
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
import {
  recordSessionCwd,
  getSessionCwdAtLine,
  parseCwdFromTitle,
  parseCwdFromOsc7,
} from "./cwdRegistry";
import { pasteToTerminal } from "./pasteHelper";

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
}

// NOTE: pasteToTerminal() is now imported from ./pasteHelper.ts — the single
// source of truth for all paste operations. It handles clipboard reading,
// bracketed paste mode (via xterm.js's terminal.paste()), and deduplication
// to prevent double-paste when multiple event handlers fire for one gesture.
// See #99 for details.

/**
 * Scan the terminal buffer upward from `startLine` for a shell prompt that
 * embeds its cwd (PowerShell `PS C:\path>` or CMD `C:\path>`). Returns the
 * most recent cwd found, or undefined.
 *
 * This is used as a fallback cwd source on Windows because PowerShell's
 * `cd`/`Set-Location` updates `$PWD` but does NOT sync the Win32 process
 * `CurrentDirectory` in the PEB — so reading it via NtQueryInformationProcess
 * can return a stale value (usually the user's home directory).
 */
function scanPromptCwdAboveLine(
  terminal: Terminal,
  startLine: number,
): string | undefined {
  const buf = terminal.buffer.active;
  const start = Math.max(0, startLine - 200);
  // Collapse `\\+` or `/+` to a single separator, strip trailing quote /
  // punctuation, strip trailing separator. Some prompt themes (Oh-My-Posh,
  // PSReadLine in debug) render paths with escaped double backslashes.
  const clean = (p: string): string =>
    p
      .replace(/["'`]+$/, "")
      .replace(/\\{2,}/g, "\\")
      .replace(/\/{2,}/g, "/")
      .replace(/[\\/]+$/, "");
  // PowerShell: "PS C:\path> " — may be prefixed with conda "(base) ",
  // posh-git prompt glyphs, etc. We anchor on "PS " + drive letter.
  const psRegex = /PS\s+([A-Za-z]:[\\/][^>]*?)\s*>/;
  // CMD: line ends with "C:\path>" (optionally with a trailing space).
  const cmdRegex = /([A-Za-z]:[\\/][^>\s]*)\s*>\s*$/;
  // Oh-My-Posh / Starship style: path appears bare on a line with a prompt
  // glyph (❯, →, ➜). We look for a drive-letter path on the same line.
  // Exclude quotes and closing brackets so we don't pick up surrounding
  // prompt decoration.
  const glyphRegex =
    /[❯→➜►»]\s*.*?([A-Za-z]:[\\/][^\s>"'`()[\]]+)|([A-Za-z]:[\\/][^\s>"'`()[\]]+)\s*[❯→➜►»]/;
  // Multi-line Oh-My-Posh: path on one line (often after "user@host  "),
  // glyph alone on the next. Matches any drive-letter path on the line,
  // which we use when scanning the line directly above a bare-glyph line.
  const bareDrivePathRegex = /([A-Za-z]:[\\/][^\s>"'`()[\]]*)/;
  const debugLines: string[] = [];
  for (let y = startLine; y >= start; y--) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (debugLines.length < 6 && text.trim())
      debugLines.push(`y=${y}:${JSON.stringify(text.slice(0, 120))}`);
    const psMatch = text.match(psRegex);
    if (psMatch) {
      const p = clean(psMatch[1]);
      invoke("perf_log", { line: `promptScan HIT PS y=${y} cwd=${p}` }).catch(
        () => {},
      );
      return p;
    }
    const cmdMatch = text.match(cmdRegex);
    if (cmdMatch) {
      const p = clean(cmdMatch[1]);
      invoke("perf_log", { line: `promptScan HIT CMD y=${y} cwd=${p}` }).catch(
        () => {},
      );
      return p;
    }
    const glyphMatch = text.match(glyphRegex);
    if (glyphMatch) {
      const p = clean(glyphMatch[1] || glyphMatch[2]);
      invoke("perf_log", {
        line: `promptScan HIT GLYPH y=${y} cwd=${p}`,
      }).catch(() => {});
      return p;
    }
    // Multi-line glyph prompt: a line containing only a bare glyph means the
    // cwd lives on the previous line (Oh-My-Posh two-line layout).
    const bareGlyph = text.trim();
    if (/^[❯→➜►»]\s*$/.test(bareGlyph)) {
      const above = buf.getLine(y - 1);
      if (above) {
        const aboveText = above.translateToString(true);
        const m = aboveText.match(bareDrivePathRegex);
        if (m) {
          const p = clean(m[1]);
          invoke("perf_log", {
            line: `promptScan HIT GLYPH2L y=${y} cwd=${p}`,
          }).catch(() => {});
          return p;
        }
      }
    }
  }
  invoke("perf_log", {
    line: `promptScan MISS startLine=${startLine} sampled=[${debugLines.join(" | ")}]`,
  }).catch(() => {});
  return undefined;
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
  const onBellRef = useRef(onBell);
  onBellRef.current = onBell;

  // Main effect: create terminal, bind events, set up I/O bridge
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    const container = terminalRef.current;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    // Debounce pty_cwd: on Windows the backend enumerates processes and reads
    // remote memory — each call can take 50-200ms. Burst-presses of Enter or
    // rapid title changes would otherwise queue on the pty sessions mutex and
    // stall pty_write. One trailing read after a quiet period is enough.
    //
    // IMPORTANT: the optional anchor (marker + line) lets the caller pin the
    // cwd record at the line where the cd *was issued*, not at where the
    // cursor happens to sit 300ms later (which is usually AFTER the command
    // output has printed — causing clicks on listed files to walk past the
    // record and hit a stale older entry instead).
    let cwdProbeTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingAnchor: {
      marker: import("@xterm/xterm").IMarker | null;
      line: number;
    } | null = null;
    // Once OSC 7 has been received for this session we know the shell is
    // self-reporting its cwd reliably — skip the PEB probe entirely, since
    // on PowerShell the PEB lags behind and would stomp the OSC 7 value
    // with a stale directory (usually the user's home).
    let hasReceivedOsc7 = false;
    const probeSessionCwd = (anchor?: {
      marker: import("@xterm/xterm").IMarker | null;
      line: number;
    }) => {
      if (hasReceivedOsc7) return;
      if (cwdProbeTimer) clearTimeout(cwdProbeTimer);
      // Prefer the earliest anchor in the current debounce window — it's
      // closest to when the cd was actually typed.
      if (anchor && !pendingAnchor) pendingAnchor = anchor;
      cwdProbeTimer = setTimeout(() => {
        cwdProbeTimer = null;
        const anchor = pendingAnchor;
        pendingAnchor = null;
        if (disposed) return;

        // STRICT PEB read. PowerShell emits OSC 7 via our injected prompt
        // wrapper (see pty/manager.rs), which is authoritative — we do NOT
        // buffer-scan here anymore because scanning upward from the cursor
        // can find an OLD prompt (e.g. after `cd ..` the prompt above the
        // cursor still shows the previous directory) and stomp on the
        // correct OSC 7 value.
        invoke<string>("pty_cwd_strict", { sessionId })
          .then((processCwd) => {
            if (!processCwd || disposed) return;
            if (anchor) {
              recordSessionCwd(
                sessionId,
                processCwd,
                anchor.marker,
                anchor.line,
              );
            } else {
              recordCwdAtCursor(processCwd);
            }
          })
          .catch(() => {
            /* strict failure — rely on OSC 7 / title */
          });
      }, 300);
    };

    // Read initial font/theme from themeStore
    const themeState = useThemeStore.getState();
    const initialFontSettings = themeState.fontSettings;

    const terminal = new Terminal({
      fontSize: initialFontSettings.fontSize,
      fontFamily: initialFontSettings.fontFamily,
      scrollback: TERMINAL_CONFIG.scrollback,
      theme: themeState.activeColors || DEFAULT_TERMINAL_THEME,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
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
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString();
        const links: {
          startIndex: number;
          length: number;
          text: string;
          isRelative: boolean;
        }[] = [];

        // Match absolute paths: /path/to/file.ext
        const absRegex = /(?:^|\s)(\/[\w./-]+\.\w{1,10})\b/g;
        let match: RegExpExecArray | null;
        while ((match = absRegex.exec(text)) !== null) {
          const path = match[1];
          const startIndex = match.index + match[0].indexOf(path);
          links.push({
            startIndex,
            length: path.length,
            text: path,
            isRelative: false,
          });
        }

        // Match filenames with common config/script extensions anywhere in line
        // (covers ls output "CR4.txt", ls -lah trailing filenames, etc.)
        const fileExts =
          "txt|cfg|conf|config|ios|acl|js|ts|py|sh|yaml|yml|json|xml|csv|log|bak|md|drawio|tsv";
        const fnRegex = new RegExp(
          `(?:^|\\s)([\\w][\\w.+-]*\\.(?:${fileExts}))(?=\\s|$)`,
          "gi",
        );
        while ((match = fnRegex.exec(text)) !== null) {
          const fname = match[1];
          const startIndex = match.index + match[0].indexOf(fname);
          // Skip if already matched as absolute path
          if (links.some((l) => l.startIndex === startIndex)) continue;
          links.push({
            startIndex,
            length: fname.length,
            text: fname,
            isRelative: true,
          });
        }

        if (links.length === 0) {
          callback(undefined);
          return;
        }
        callback(
          links.map((l) => ({
            range: {
              start: { x: l.startIndex + 1, y: bufferLineNumber },
              end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
            },
            text: l.text,
            activate() {
              const resolveAndOpen = (openFn: (path: string) => void) => {
                if (!l.isRelative) {
                  openFn(l.text);
                  return;
                }

                const joinPath = (cwd: string, name: string): string => {
                  const sep = cwd.includes("\\") ? "\\" : "/";
                  return cwd.endsWith(sep)
                    ? `${cwd}${name}`
                    : `${cwd}${sep}${name}`;
                };

                // Prompt-scan FIRST: the shell prompt (PS C:\path> / C:\path>)
                // sits right next to the filename the user clicked and always
                // reflects the real cwd at that moment. This beats:
                //  - window-title parsing (PowerShell does NOT update the
                //    title on `cd`, so titleCwd often sticks at the startup
                //    value of user-home)
                //  - `pty_cwd` (PowerShell's `cd` doesn't sync the Win32 PEB
                //    CurrentDirectory, so NtQueryInformationProcess returns
                //    a stale value)
                const promptCwd = scanPromptCwdAboveLine(
                  terminal,
                  bufferLineNumber,
                );
                if (promptCwd) {
                  const resolved = joinPath(promptCwd, l.text);
                  invoke("perf_log", {
                    line: `link activate name=${l.text} line=${bufferLineNumber} source=promptScan cwd=${promptCwd} resolved=${resolved}`,
                  }).catch(() => {});
                  openFn(resolved);
                  return;
                }

                // Line-aware title/OSC7 history — resolves to the cwd that
                // was active when this filename was printed, not the current
                // cwd. Works well for zsh/bash with title-update hooks.
                const titleCwd = getSessionCwdAtLine(
                  sessionId,
                  bufferLineNumber,
                );
                if (titleCwd) {
                  const resolved = joinPath(titleCwd, l.text);
                  invoke("perf_log", {
                    line: `link activate name=${l.text} line=${bufferLineNumber} source=titleCwd cwd=${titleCwd} resolved=${resolved}`,
                  }).catch(() => {});
                  openFn(resolved);
                  return;
                }

                invoke<string>("pty_cwd", { sessionId })
                  .then((cwd) => {
                    const resolved = joinPath(cwd, l.text);
                    invoke("perf_log", {
                      line: `link activate name=${l.text} line=${bufferLineNumber} source=pty_cwd cwd=${cwd} resolved=${resolved}`,
                    }).catch(() => {});
                    openFn(resolved);
                  })
                  .catch(() => {
                    invoke("perf_log", {
                      line: `link activate name=${l.text} line=${bufferLineNumber} source=fallback-bare-name`,
                    }).catch(() => {});
                    openFn(l.text);
                  });
              };

              const ext = l.text.split(".").pop()?.toLowerCase() || "";
              if (ext === "md" || ext === "markdown" || ext === "mdx") {
                // Show context menu for markdown: View or Edit
                const menu = document.createElement("div");
                menu.className = "region-tabbar__context-menu";
                menu.style.cssText = `position:fixed;z-index:1000;left:${window.innerWidth / 2 - 60}px;top:${window.innerHeight / 2 - 30}px;`;
                menu.innerHTML = `
                <button class="region-tabbar__context-item" data-action="view">📖 View Rendered</button>
                <button class="region-tabbar__context-item" data-action="edit">✏️ Edit Source</button>
              `;
                document.body.appendChild(menu);
                const cleanup = () => {
                  menu.remove();
                  document.removeEventListener("click", outsideClick);
                };
                const outsideClick = (e: MouseEvent) => {
                  if (!menu.contains(e.target as Node)) cleanup();
                };
                setTimeout(
                  () => document.addEventListener("click", outsideClick),
                  10,
                );
                menu.addEventListener("click", (e) => {
                  const action = (e.target as HTMLElement).getAttribute(
                    "data-action",
                  );
                  cleanup();
                  if (action === "view") {
                    resolveAndOpen((path) =>
                      useLayoutStore.getState().addMarkdownTab(undefined, path),
                    );
                  } else if (action === "edit") {
                    resolveAndOpen((path) =>
                      useLayoutStore
                        .getState()
                        .addEditorTab(undefined, path, undefined, true),
                    );
                  }
                });
              } else {
                resolveAndOpen((path) =>
                  useLayoutStore.getState().addEditorTab(undefined, path),
                );
              }
            },
          })),
        );
      },
    });

    // Open terminal in the DOM container
    terminal.open(container);

    // NOTE: WebGL renderer is intentionally DISABLED on Windows / WebView2.
    // The `WebglAddon` + WebView2 compositor has a known bug where any overlay
    // (popover menus, modals) causes the canvas to go stale and render black
    // zones or ghost pixels from prior frames. The default DOM renderer has
    // none of these issues and is fast enough for typical terminal workloads.
    // See checkpoint 004 for the full investigation history.

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

    // Focus the terminal so keystrokes and the blinking cursor are active
    // immediately on mount. On Windows/Chromium (WebView2), the xterm helper
    // textarea does not auto-focus when inserted into the DOM, so moving a
    // tab between region groups (which remounts TerminalView) loses the
    // cursor until the user clicks. One RAF after mount covers the case
    // where the container isn't fully laid out yet. The ResizeObserver
    // below handles any further layout changes.
    const safeFocus = () => {
      if (disposed) return;
      try {
        terminal.focus();
      } catch {
        /* container not ready */
      }
    };
    safeFocus();

    const fitRaf = requestAnimationFrame(() => {
      safeFit();
      safeFocus();
    });

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

    // Bridge: terminal keystrokes → PTY write
    terminal.onData((data: string) => {
      if (disposed) return;

      const bytes = Array.from(new TextEncoder().encode(data));
      broadcastWrite(sessionId, bytes);
      invoke("pty_write", { sessionId, data: bytes }).catch(() => {
        // pty_write failure — input dropped silently
      });

      // After Enter, check if CWD changed (shell ran a command).
      // Capture a marker AT THE ENTER LINE so the eventual probe records the
      // new cwd at the command line — not where the cursor sits 300ms later
      // (which is typically AFTER the command's output has printed).
      if (data.includes("\r") || data.includes("\n")) {
        const buffer = terminal.buffer.active;
        const cursorAbsLine = buffer.baseY + buffer.cursorY;
        let marker: import("@xterm/xterm").IMarker | null = null;
        try {
          marker = terminal.registerMarker(0);
        } catch {
          /* best effort */
        }
        probeSessionCwd({ marker, line: cursorAbsLine });
      }
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
    terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (disposed) return;
      invoke("pty_resize", { sessionId, cols, rows }).catch(() => {
        // pty_resize failure — terminal may be out of sync
      });
    });

    // Title change detection (via escape sequences like \e]0;title\a)
    // Also feeds the per-session CWD registry — many shells set the title
    // to the prompt path, which we mine to resolve relative file links
    // when the backend cannot read the child's CWD (Windows in particular).
    // Helper: pin a marker at the current cursor line and record a cwd change.
    const recordCwdAtCursor = (cwd: string) => {
      const buffer = terminal.buffer.active;
      const cursorAbsLine = buffer.baseY + buffer.cursorY;
      let marker: import("@xterm/xterm").IMarker | null = null;
      try {
        marker = terminal.registerMarker(0);
      } catch {
        // registerMarker can throw if cursor is out of viewport — best effort
      }
      recordSessionCwd(sessionId, cwd, marker, cursorAbsLine);
    };

    terminal.onTitleChange((title: string) => {
      onTitleChangeRef.current?.(title);
      const cwd = parseCwdFromTitle(title);
      if (cwd) {
        recordCwdAtCursor(cwd);
      } else {
        // Shell title didn't contain a parseable path — read CWD from the process
        probeSessionCwd();
      }
    });

    // OSC 7 — modern cwd notification (\e]7;file://hostname/path\a).
    // macOS Terminal.app, iTerm2, GNOME Terminal, VS Code's terminal all use
    // this. zsh on macOS sends it from /etc/zshrc via update_terminal_cwd.
    // xterm.js does NOT surface OSC 7 via onTitleChange — register directly.
    try {
      terminal.parser.registerOscHandler(7, (data: string) => {
        // data is everything after "7;" up to ST/BEL.
        // Format: file://hostname/percent-encoded/path
        const cwd = parseCwdFromOsc7(data);
        if (cwd) {
          hasReceivedOsc7 = true;
          recordCwdAtCursor(cwd);
        }
        return false; // let other handlers (if any) run
      });
    } catch {
      // Older xterm.js versions may not expose parser.registerOscHandler
    }

    // OSC 1337 — iTerm2's CurrentDir notification (\e]1337;CurrentDir=/path\a).
    // Used by some shell integration scripts (oh-my-zsh, iTerm2 shell integration).
    try {
      terminal.parser.registerOscHandler(1337, (data: string) => {
        const m = data.match(/^CurrentDir=(.+)$/);
        if (m) recordCwdAtCursor(m[1]);
        return false;
      });
    } catch {
      // ignore
    }

    // Keyboard shortcuts: Cmd/Ctrl+C/V/A (copy/paste/select-all),
    // Ctrl+Shift+H (highlight), Ctrl+Plus/Minus/0 (font zoom)
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown") return true;

      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // Cmd+C / Ctrl+C — copy selection (if any), otherwise send SIGINT
      if (isMod && !event.shiftKey && (key === "c" || event.code === "KeyC")) {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          return false; // Consumed — don't send to PTY
        }
        // No selection → let xterm send Ctrl+C (SIGINT) to PTY
        return true;
      }

      // Cmd+V / Ctrl+V — paste from clipboard
      if (isMod && !event.shiftKey && (key === "v" || event.code === "KeyV")) {
        event.preventDefault();
        pasteToTerminal(terminal, sessionId);
        return false;
      }

      // Cmd+A / Ctrl+A — select all terminal content
      if (isMod && !event.shiftKey && (key === "a" || event.code === "KeyA")) {
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
        event.preventDefault();
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

      // Ctrl+- — decrease font size
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

      // Ctrl+0 — reset font size to default
      if (event.ctrlKey && !event.shiftKey && event.key === "0") {
        terminal.options.fontSize = FONT_SIZE_DEFAULT;
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
        return false;
      }

      return true; // Allow normal key processing
    });

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

    // An overlay (popover/menu) opened or closed — the xterm WebGL canvas can
    // leave stale pixels where the overlay was. Force a full refresh.
    const handleOverlayToggle = () => {
      if (disposed) return;
      try {
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        // ignore — terminal may be disposed
      }
    };
    window.addEventListener("putz-overlay-toggle", handleOverlayToggle);

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

    // Initial fit — ResizeObserver below fires on observe() when the
    // container has dimensions, so no standalone timer is needed here.

    // Cleanup on unmount
    return () => {
      disposed = true;
      if (cwdProbeTimer) clearTimeout(cwdProbeTimer);
      cancelAnimationFrame(fitRaf);
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      if (resizeObserverTimer !== null) {
        clearTimeout(resizeObserverTimer);
      }
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("putz-overlay-toggle", handleOverlayToggle);
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
    const applyTheme = () => {
      const term = terminalInstanceRef.current;
      if (!term) return;
      const themeState = useThemeStore.getState();
      if (themeState.fontSettings) {
        term.options.fontSize = themeState.fontSettings.fontSize;
        term.options.fontFamily = themeState.fontSettings.fontFamily;
        term.options.lineHeight = themeState.fontSettings.lineHeight;
      }
      if (themeState.activeColors) {
        term.options.theme = themeState.activeColors;
      }
      try {
        fitAddonRef.current?.fit();
      } catch {
        /* ignore */
      }
    };
    const unsub = useThemeStore.subscribe(applyTheme);
    return unsub;
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

  return {
    terminalRef,
    isReady,
    error,
    hasExited,
    exitCode,
    terminalInstance: terminalInstanceRef.current,
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
