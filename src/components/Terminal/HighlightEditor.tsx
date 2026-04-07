/**
 * HighlightEditor — modal form for creating/editing highlight sets.
 *
 * Supports create and edit modes:
 * - Create: empty form, generates new highlight set on save
 * - Edit: pre-filled form with existing rules
 *
 * Rules can be added/removed/reordered within the editor.
 * Built-in presets are shown read-only.
 */
import { useState, useCallback } from "react";
import type {
  HighlightSet,
  CreateHighlightSetInput,
  CreateHighlightRuleInput,
  MatchType,
} from "./highlightTypes";
import { MATCH_TYPE_LABELS, HIGHLIGHT_COLOR_PALETTE } from "./highlightTypes";

interface HighlightEditorProps {
  /** Highlight set to edit (undefined = create mode). */
  highlightSet?: HighlightSet;
  /** Called with validated input on save. */
  onSave: (input: CreateHighlightSetInput) => void;
  /** Called when the editor is cancelled. */
  onCancel: () => void;
  /** Whether the form is currently saving. */
  isSaving?: boolean;
}

/** Default empty rule for new entries. */
function createEmptyRule(): CreateHighlightRuleInput {
  return {
    pattern: "",
    matchType: "exact",
    foregroundColor: HIGHLIGHT_COLOR_PALETTE[0].hex,
    backgroundColor: "",
    bold: false,
    underline: false,
    priority: 50,
  };
}

/** All match type options. */
const MATCH_TYPES: MatchType[] = [
  "exact",
  "exactinsensitive",
  "wildcard",
  "regex",
];

export function HighlightEditor({
  highlightSet,
  onSave,
  onCancel,
  isSaving = false,
}: HighlightEditorProps) {
  const isEdit = !!highlightSet;
  const isBuiltin = highlightSet?.isBuiltin ?? false;

  const [name, setName] = useState(highlightSet?.name ?? "");
  const [description, setDescription] = useState(
    highlightSet?.description ?? "",
  );
  const [rules, setRules] = useState<CreateHighlightRuleInput[]>(
    highlightSet?.rules.map((r) => ({
      pattern: r.pattern,
      matchType: r.matchType,
      foregroundColor: r.foregroundColor,
      backgroundColor: r.backgroundColor,
      bold: r.bold,
      underline: r.underline,
      priority: r.priority,
    })) ?? [createEmptyRule()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    }

    rules.forEach((rule, idx) => {
      if (!rule.pattern.trim()) {
        newErrors[`rule-${idx}-pattern`] = "Pattern is required";
      }
      if (
        rule.foregroundColor &&
        !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rule.foregroundColor)
      ) {
        newErrors[`rule-${idx}-fg`] = "Invalid hex color";
      }
      if (
        rule.backgroundColor &&
        !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rule.backgroundColor)
      ) {
        newErrors[`rule-${idx}-bg`] = "Invalid hex color";
      }
      if (rule.matchType === "regex") {
        try {
          new RegExp(rule.pattern);
        } catch {
          newErrors[`rule-${idx}-pattern`] = "Invalid regex pattern";
        }
      }
      if (rule.priority < 0 || rule.priority > 999) {
        newErrors[`rule-${idx}-priority`] = "Priority must be 0–999";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, rules]);

  const handleSave = useCallback(() => {
    if (!validate()) return;

    onSave({
      name: name.trim(),
      description: description.trim(),
      rules: rules.filter((r) => r.pattern.trim() !== ""),
    });
  }, [name, description, rules, validate, onSave]);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, createEmptyRule()]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateRule = useCallback(
    (index: number, field: keyof CreateHighlightRuleInput, value: unknown) => {
      setRules((prev) =>
        prev.map((rule, i) =>
          i === index ? { ...rule, [field]: value } : rule,
        ),
      );
    },
    [],
  );

  return (
    <div
      className="highlight-editor-overlay"
      data-testid="highlight-editor"
      role="dialog"
      aria-label={isEdit ? "Edit Highlight Set" : "Create Highlight Set"}
    >
      <div className="highlight-editor-modal">
        <h2>
          {isBuiltin
            ? "View Preset"
            : isEdit
              ? "Edit Highlight Set"
              : "Create Highlight Set"}
        </h2>

        {/* Name field */}
        <div className="highlight-editor-field">
          <label htmlFor="highlight-name">Name</label>
          <input
            id="highlight-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBuiltin || isSaving}
            placeholder="e.g., Cisco IOS"
            data-testid="highlight-name-input"
          />
          {errors.name && (
            <span className="highlight-editor-error">{errors.name}</span>
          )}
        </div>

        {/* Description field */}
        <div className="highlight-editor-field">
          <label htmlFor="highlight-description">Description</label>
          <input
            id="highlight-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isBuiltin || isSaving}
            placeholder="Optional description"
            data-testid="highlight-description-input"
          />
        </div>

        {/* Rules list */}
        <div className="highlight-editor-rules">
          <h3>Rules</h3>
          {rules.map((rule, idx) => (
            <div
              key={idx}
              className="highlight-editor-rule"
              data-testid={`highlight-rule-${idx}`}
            >
              {/* Pattern */}
              <div className="highlight-editor-field">
                <label htmlFor={`rule-pattern-${idx}`}>Pattern</label>
                <input
                  id={`rule-pattern-${idx}`}
                  type="text"
                  value={rule.pattern}
                  onChange={(e) => updateRule(idx, "pattern", e.target.value)}
                  disabled={isBuiltin || isSaving}
                  placeholder="e.g., ERROR or \\d+\\.\\d+\\.\\d+\\.\\d+"
                  data-testid={`rule-pattern-input-${idx}`}
                />
                {errors[`rule-${idx}-pattern`] && (
                  <span className="highlight-editor-error">
                    {errors[`rule-${idx}-pattern`]}
                  </span>
                )}
              </div>

              {/* Match Type */}
              <div className="highlight-editor-field">
                <label htmlFor={`rule-matchtype-${idx}`}>Match Type</label>
                <select
                  id={`rule-matchtype-${idx}`}
                  value={rule.matchType}
                  onChange={(e) =>
                    updateRule(idx, "matchType", e.target.value as MatchType)
                  }
                  disabled={isBuiltin || isSaving}
                  data-testid={`rule-matchtype-select-${idx}`}
                >
                  {MATCH_TYPES.map((mt) => (
                    <option key={mt} value={mt}>
                      {MATCH_TYPE_LABELS[mt]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Colors */}
              <div className="highlight-editor-colors">
                <div className="highlight-editor-field">
                  <label htmlFor={`rule-fg-${idx}`}>Foreground</label>
                  <div className="highlight-editor-color-input">
                    <input
                      id={`rule-fg-${idx}`}
                      type="color"
                      value={rule.foregroundColor || "#FF5555"}
                      onChange={(e) =>
                        updateRule(idx, "foregroundColor", e.target.value)
                      }
                      disabled={isBuiltin || isSaving}
                      data-testid={`rule-fg-input-${idx}`}
                    />
                    <span>{rule.foregroundColor}</span>
                  </div>
                  {errors[`rule-${idx}-fg`] && (
                    <span className="highlight-editor-error">
                      {errors[`rule-${idx}-fg`]}
                    </span>
                  )}
                </div>
                <div className="highlight-editor-field">
                  <label htmlFor={`rule-bg-${idx}`}>Background</label>
                  <div className="highlight-editor-color-input">
                    <input
                      id={`rule-bg-${idx}`}
                      type="color"
                      value={rule.backgroundColor || "#1a1a2e"}
                      onChange={(e) =>
                        updateRule(idx, "backgroundColor", e.target.value)
                      }
                      disabled={isBuiltin || isSaving}
                      data-testid={`rule-bg-input-${idx}`}
                    />
                    <span>{rule.backgroundColor || "(transparent)"}</span>
                  </div>
                  {errors[`rule-${idx}-bg`] && (
                    <span className="highlight-editor-error">
                      {errors[`rule-${idx}-bg`]}
                    </span>
                  )}
                </div>
              </div>

              {/* Style options */}
              <div className="highlight-editor-style-options">
                <label>
                  <input
                    type="checkbox"
                    checked={rule.bold}
                    onChange={(e) => updateRule(idx, "bold", e.target.checked)}
                    disabled={isBuiltin || isSaving}
                    data-testid={`rule-bold-${idx}`}
                  />
                  Bold
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={rule.underline}
                    onChange={(e) =>
                      updateRule(idx, "underline", e.target.checked)
                    }
                    disabled={isBuiltin || isSaving}
                    data-testid={`rule-underline-${idx}`}
                  />
                  Underline
                </label>
              </div>

              {/* Priority */}
              <div className="highlight-editor-field">
                <label htmlFor={`rule-priority-${idx}`}>Priority (0–999)</label>
                <input
                  id={`rule-priority-${idx}`}
                  type="number"
                  min={0}
                  max={999}
                  value={rule.priority}
                  onChange={(e) =>
                    updateRule(
                      idx,
                      "priority",
                      parseInt(e.target.value, 10) || 0,
                    )
                  }
                  disabled={isBuiltin || isSaving}
                  data-testid={`rule-priority-input-${idx}`}
                />
                {errors[`rule-${idx}-priority`] && (
                  <span className="highlight-editor-error">
                    {errors[`rule-${idx}-priority`]}
                  </span>
                )}
              </div>

              {/* Remove rule button */}
              {!isBuiltin && rules.length > 1 && (
                <button
                  type="button"
                  className="highlight-editor-remove-rule"
                  onClick={() => removeRule(idx)}
                  disabled={isSaving}
                  data-testid={`rule-remove-${idx}`}
                >
                  Remove Rule
                </button>
              )}
            </div>
          ))}

          {!isBuiltin && (
            <button
              type="button"
              className="highlight-editor-add-rule"
              onClick={addRule}
              disabled={isSaving}
              data-testid="highlight-add-rule-btn"
            >
              + Add Rule
            </button>
          )}
        </div>

        {/* Quick Color Palette */}
        {!isBuiltin && (
          <div className="highlight-editor-palette">
            <h4>Color Palette (4.5:1 contrast)</h4>
            <div className="highlight-editor-palette-swatches">
              {HIGHLIGHT_COLOR_PALETTE.map((color) => (
                <div
                  key={color.hex}
                  className="highlight-editor-swatch"
                  style={{ backgroundColor: color.hex }}
                  title={`${color.name} (${color.hex})`}
                  data-testid={`palette-${color.name.toLowerCase().replace(/\s+/g, "-")}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="highlight-editor-actions">
          <button
            type="button"
            className="highlight-editor-cancel"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="highlight-cancel-btn"
          >
            {isBuiltin ? "Close" : "Cancel"}
          </button>
          {!isBuiltin && (
            <button
              type="button"
              className="highlight-editor-save"
              onClick={handleSave}
              disabled={isSaving}
              data-testid="highlight-save-btn"
            >
              {isSaving ? "Saving…" : isEdit ? "Update" : "Create"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
