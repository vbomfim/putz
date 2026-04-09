/**
 * Scripting module — automation engine components.
 *
 * @module Scripting
 */
export { ScriptEditor } from "./ScriptEditor";
export { ScriptLibrary } from "./ScriptLibrary";
export { ScriptRunner } from "./ScriptRunner";
export { MonacoEditor } from "./MonacoEditor";
export { EditorTab } from "./EditorTab";
export type { EditorLanguage } from "./MonacoEditor";
export {
  scriptList,
  scriptGet,
  scriptSave,
  scriptDelete,
  scriptRun,
  scriptRunMulti,
  scriptStatus,
  scriptStop,
  scriptRecordStart,
  scriptRecordStop,
} from "./scriptApi";
export type {
  ScriptMeta,
  ScriptWithContent,
  LogLevel,
  ScriptLogEntry,
  ScriptStatus,
  ScriptRunResult,
  SaveScriptInput,
  RunScriptInput,
  RunMultiInput,
} from "./types";
export { DEFAULT_SCRIPT_CONTENT, MAX_SCRIPT_SIZE, MAX_SCRIPT_NAME_LENGTH } from "./types";
