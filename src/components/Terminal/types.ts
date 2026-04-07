/**
 * Type definitions for the terminal PTY IPC layer.
 *
 * These types mirror the Rust backend's IPC command signatures.
 * Keep in sync with src-tauri/src/ipc/terminal.rs.
 */

/** Arguments for the pty_spawn IPC command. */
export interface PtySpawnArgs {
  /** Shell executable path. Defaults to $SHELL (Unix) or powershell.exe (Windows). */
  shell?: string;
  /** Working directory for the shell process. */
  cwd?: string;
  /** Terminal width in columns. */
  cols: number;
  /** Terminal height in rows. */
  rows: number;
  /** Additional environment variables to set. */
  env?: Record<string, string>;
}

/** Arguments for the pty_write IPC command. */
export interface PtyWriteArgs {
  /** UUID v4 session identifier. */
  sessionId: string;
  /** Raw bytes to write to PTY stdin. */
  data: number[];
}

/** Arguments for the pty_resize IPC command. */
export interface PtyResizeArgs {
  /** UUID v4 session identifier. */
  sessionId: string;
  /** New terminal width in columns. */
  cols: number;
  /** New terminal height in rows. */
  rows: number;
}

/** Arguments for the pty_close IPC command. */
export interface PtyCloseArgs {
  /** UUID v4 session identifier. */
  sessionId: string;
}

/** Payload for the pty-exit-{sessionId} Tauri event. */
export interface PtyExitPayload {
  /** Exit code of the shell process. */
  code: number;
}

/** Terminal theme configuration matching CSS variables. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Default dark terminal theme matching the Putz color scheme. */
export const DEFAULT_TERMINAL_THEME: TerminalTheme = {
  background: "#1a1a2e",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  cursorAccent: "#1a1a2e",
  selectionBackground: "#0f346080",
  black: "#1a1a2e",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#6272a4",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
  white: "#e0e0e0",
  brightBlack: "#6272a4",
  brightRed: "#ff6e6e",
  brightGreen: "#69ff94",
  brightYellow: "#ffffa5",
  brightBlue: "#d6acff",
  brightMagenta: "#ff92df",
  brightCyan: "#a4ffff",
  brightWhite: "#ffffff",
};

/** Terminal configuration constants. */
export const TERMINAL_CONFIG = {
  /** Default font size in pixels. */
  fontSize: 14,
  /** Font family for the terminal. */
  fontFamily:
    '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
  /** Scrollback buffer size in lines. */
  scrollback: 10_000,
  /** Default terminal dimensions. */
  defaultCols: 80,
  /** Default terminal rows. */
  defaultRows: 24,
} as const;
