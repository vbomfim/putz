/**
 * Terminal component module — public API exports.
 */
export { TerminalView } from "./TerminalView";
export { useTerminal } from "./useTerminal";
export type {
  PtySpawnArgs,
  PtyWriteArgs,
  PtyResizeArgs,
  PtyCloseArgs,
  PtyExitPayload,
  TerminalTheme,
} from "./types";
export { DEFAULT_TERMINAL_THEME, TERMINAL_CONFIG } from "./types";
