/**
 * TemplatePanel — Command template browser and executor.
 *
 * Lists saved templates, allows selecting one to fill in variables,
 * and sends the rendered output to the active terminal session.
 * Opened via Ctrl+Shift+T.
 *
 * @module TemplatePanel
 */
import { useState, useCallback, useEffect } from "react";
import type {
  TemplateMeta,
  TemplateWithContent,
  TemplateVariable,
} from "./types";
import { templateList, templateGet, templateCreate, templateDelete, templateExecute } from "./templateApi";
import "./Templates.css";

/** Props for the TemplatePanel component. */
interface TemplatePanelProps {
  /** Whether the template panel is visible. */
  isOpen: boolean;
  /** Callback to close the panel. */
  onClose: () => void;
  /** Callback to send rendered template text to the terminal. */
  onSendToTerminal?: (text: string) => void;
}

/** View states within the template panel. */
type PanelView = "list" | "edit" | "execute";

export function TemplatePanel({ isOpen, onClose, onSendToTerminal }: TemplatePanelProps) {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateWithContent | null>(null);
  const [view, setView] = useState<PanelView>("list");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");

  // Variable values for execution
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  /** Loads the template list from the backend. */
  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await templateList();
      setTemplates(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Loads templates when panel opens. */
  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen, loadTemplates]);

  /** Selects a template for execution. */
  const handleSelect = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const tmpl = await templateGet(id);
      setSelectedTemplate(tmpl);
      // Initialize variable values with defaults
      const defaults: Record<string, string> = {};
      tmpl.variables.forEach((v: TemplateVariable) => {
        defaults[v.name] = v.defaultValue;
      });
      setVariableValues(defaults);
      setView("execute");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Opens the edit form for a new template. */
  const handleNewTemplate = useCallback(() => {
    setEditName("");
    setEditDescription("");
    setEditContent("");
    setSelectedTemplate(null);
    setView("edit");
  }, []);

  /** Saves the template being edited. */
  const handleSave = useCallback(async () => {
    if (!editName.trim() || !editContent.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await templateCreate({
        id: selectedTemplate?.meta.id,
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        content: editContent,
      });
      await loadTemplates();
      setView("list");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [editName, editDescription, editContent, selectedTemplate, loadTemplates]);

  /** Deletes a template. */
  const handleDelete = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await templateDelete(id);
        await loadTemplates();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [loadTemplates],
  );

  /** Executes the template and sends result to terminal. */
  const handleExecute = useCallback(async () => {
    if (!selectedTemplate) return;
    setIsLoading(true);
    setError(null);
    try {
      const rendered = await templateExecute({
        templateId: selectedTemplate.meta.id,
        variables: variableValues,
      });
      onSendToTerminal?.(rendered);
      // Don't close — keep panel open for repeated sends
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTemplate, variableValues, onSendToTerminal, onClose]);

  /** Updates a variable value. */
  const handleVariableChange = useCallback(
    (name: string, value: string) => {
      setVariableValues((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  /** Navigates back to the list view. */
  const handleBack = useCallback(() => {
    setView("list");
    setSelectedTemplate(null);
    setError(null);
  }, []);

  /** Close on Escape key. */
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (view !== "list") {
          handleBack();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, view, onClose, handleBack]);

  if (!isOpen) return null;

  return (
    <div className="template-panel" data-testid="template-panel">
      <div className="template-panel__header">
        {view !== "list" && (
          <button
            className="template-panel__back-btn"
            onClick={handleBack}
            type="button"
            data-testid="template-panel-back"
          >
            ◀
          </button>
        )}
        <h2>
          {view === "list"
            ? "Command Templates"
            : view === "edit"
              ? "New Template"
              : selectedTemplate?.meta.name ?? "Execute Template"}
        </h2>
        <div className="template-panel__controls">
          {view === "list" && (
            <button
              className="template-panel__new-btn"
              onClick={handleNewTemplate}
              type="button"
              data-testid="template-panel-new"
            >
              + New
            </button>
          )}
          <button
            className="template-panel__close"
            onClick={onClose}
            type="button"
            aria-label="Close template panel"
            data-testid="template-panel-close"
          >
            ✕
          </button>
        </div>
      </div>

      {error && (
        <div className="template-panel__error" data-testid="template-panel-error">
          {error}
        </div>
      )}

      {/* ── List View ──────────────────────────────────────── */}
      {view === "list" && (
        <div className="template-panel__list" data-testid="template-panel-list">
          {isLoading && (
            <div className="template-panel__loading">Loading templates...</div>
          )}
          {!isLoading && templates.length === 0 && (
            <div className="template-panel__empty">
              <p>No templates yet.</p>
              <p className="template-panel__hint">
                Create command templates with {"{{variable}}"} placeholders.
              </p>
            </div>
          )}
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="template-panel__item">
              <button
                className="template-panel__item-btn"
                onClick={() => handleSelect(tmpl.id)}
                type="button"
                data-testid={`template-item-${tmpl.id}`}
              >
                <span className="template-panel__item-name">
                  {tmpl.isBuiltin && <span className="template-panel__builtin-badge">Built-in</span>}
                  {tmpl.name}
                </span>
                {tmpl.description && (
                  <span className="template-panel__item-desc">{tmpl.description}</span>
                )}
              </button>
              {!tmpl.isBuiltin && (
                <button
                  className="template-panel__delete-btn"
                  onClick={() => handleDelete(tmpl.id)}
                  type="button"
                  title="Delete template"
                  data-testid={`template-delete-${tmpl.id}`}
                >
                  🗑
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Edit View ──────────────────────────────────────── */}
      {view === "edit" && (
        <div className="template-panel__edit" data-testid="template-panel-edit">
          <div className="template-panel__field">
            <label>Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g., Backup Running Config"
              data-testid="template-edit-name"
            />
          </div>
          <div className="template-panel__field">
            <label>Description</label>
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Optional description"
              data-testid="template-edit-description"
            />
          </div>
          <div className="template-panel__field">
            <label>Template Content</label>
            <textarea
              className="template-panel__textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder={"enable\nconfigure terminal\nhostname {{hostname}}\n!"}
              spellCheck={false}
              data-testid="template-edit-content"
            />
          </div>
          <div className="template-panel__actions">
            <button
              className="template-panel__btn template-panel__btn--primary"
              onClick={handleSave}
              type="button"
              disabled={!editName.trim() || !editContent.trim() || isLoading}
              data-testid="template-edit-save"
            >
              Save Template
            </button>
            <button
              className="template-panel__btn template-panel__btn--secondary"
              onClick={handleBack}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Execute View ───────────────────────────────────── */}
      {view === "execute" && selectedTemplate && (
        <div className="template-panel__execute" data-testid="template-panel-execute">
          {selectedTemplate.meta.description && (
            <p className="template-panel__desc">{selectedTemplate.meta.description}</p>
          )}

          <div className="template-panel__preview">
            <label>Template Preview</label>
            <pre className="template-panel__preview-text">
              {selectedTemplate.content}
            </pre>
          </div>

          {selectedTemplate.variables.length > 0 && (
            <div className="template-panel__variables" data-testid="template-variables">
              <label>Variables</label>
              {selectedTemplate.variables.map((variable) => (
                <div key={variable.name} className="template-panel__variable">
                  <label className="template-panel__variable-name">
                    {`{{${variable.name}}}`}
                  </label>
                  <input
                    type="text"
                    value={variableValues[variable.name] ?? ""}
                    onChange={(e) =>
                      handleVariableChange(variable.name, e.target.value)
                    }
                    placeholder={variable.defaultValue || variable.name}
                    data-testid={`template-var-${variable.name}`}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="template-panel__actions">
            <button
              className="template-panel__btn template-panel__btn--primary"
              onClick={handleExecute}
              type="button"
              disabled={isLoading}
              data-testid="template-execute-btn"
            >
              Send to Terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
