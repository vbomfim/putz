/**
 * History component module — public API exports.
 */
export { HistoryPanel } from "./HistoryPanel";
export {
  historyAdd,
  historySearch,
  historyGetRecent,
  historyClear,
} from "./historyApi";
export type {
  CommandEntry,
  AddCommandInput,
  SearchHistoryInput,
  GetRecentInput,
} from "./types";
