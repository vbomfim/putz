/**
 * Terminal component module — public API exports.
 */
export { TerminalView } from "./TerminalView";
export { ConnectionTerminalView } from "./ConnectionTerminalView";
export { useTerminal } from "./useTerminal";
export { useConnection } from "./useConnection";
export type {
  PtySpawnArgs,
  PtyWriteArgs,
  PtyResizeArgs,
  PtyCloseArgs,
  PtyExitPayload,
  TerminalTheme,
} from "./types";
export type {
  ConnectionOpenInput,
  ConnectionWriteArgs,
  ConnectionResizeArgs,
  ConnectionCloseArgs,
  ConnectionStatusPayload,
  ConnectionStatusType,
  ConnectionProtocol,
} from "./connectionTypes";
export { DEFAULT_TERMINAL_THEME, TERMINAL_CONFIG } from "./types";
