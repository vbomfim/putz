/**
 * Terminal component module — public API exports.
 */
export { TerminalView } from "./TerminalView";
export { ConnectionTerminalView } from "./ConnectionTerminalView";
export { HostKeyDialog } from "./HostKeyDialog";
export { AuthPromptDialog } from "./AuthPromptDialog";
export { SearchBar } from "./SearchBar";
export { HighlightEditor } from "./HighlightEditor";
export { HighlightEngine } from "./HighlightEngine";
export { hasNestedQuantifiers, execRegexWithTimeout } from "./HighlightEngine";
export { useTerminal } from "./useTerminal";
export { useConnection } from "./useConnection";
export { useSearch } from "./useSearch";
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
  HostKeyPayload,
  AuthPromptPayload,
  SerialPortInfo,
  SerialDataBits,
  SerialParity,
  SerialStopBits,
  SerialFlowControl,
  SerialConfigValues,
} from "./connectionTypes";
export type {
  HighlightRule,
  HighlightSet,
  MatchType,
  CreateHighlightSetInput,
  CreateHighlightRuleInput,
  UpdateHighlightSetInput,
} from "./highlightTypes";
export { MATCH_TYPE_LABELS, HIGHLIGHT_COLOR_PALETTE } from "./highlightTypes";
export { DEFAULT_SERIAL_CONFIG } from "./connectionTypes";
export { DEFAULT_TERMINAL_THEME, TERMINAL_CONFIG } from "./types";
export { SerialConfig } from "./SerialConfig";
export { ThemeEditor } from "./ThemeEditor";
export { FontConfig } from "./FontConfig";
export type {
  ThemeColors,
  Theme,
  CreateThemeInput,
  UpdateThemeInput,
  ThemeExport,
  FontSettings,
  UiThemeMode,
} from "./themeTypes";
export {
  THEME_COLOR_FIELDS,
  DEFAULT_FONT_SETTINGS,
  MONOSPACE_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
} from "./themeTypes";
export {
  highlightListSets,
  highlightGetSet,
  highlightCreateSet,
  highlightUpdateSet,
  highlightDeleteSet,
} from "./highlightApi";
export {
  themeList,
  themeGet,
  themeCreate,
  themeUpdate,
  themeDelete,
  themeImport,
  themeExport,
} from "./themeApi";
