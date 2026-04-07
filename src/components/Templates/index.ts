/**
 * Templates module — command template browser and executor.
 *
 * @module Templates
 */
export { TemplatePanel } from "./TemplatePanel";
export {
  templateList,
  templateGet,
  templateCreate,
  templateDelete,
  templateExecute,
} from "./templateApi";
export type {
  TemplateMeta,
  TemplateWithContent,
  TemplateVariable,
  SaveTemplateInput,
  ExecuteTemplateInput,
} from "./types";
export { MAX_TEMPLATE_SIZE, MAX_TEMPLATE_NAME_LENGTH } from "./types";
