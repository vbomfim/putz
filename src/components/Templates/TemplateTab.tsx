/**
 * TemplateTab — Command templates as a tab.
 *
 * Three views: list → execute (fill variables + send) → edit.
 * Click a template to fill variables and send to terminal.
 * Fast workflow: select template → fill vars → Enter → done.
 *
 * @module TemplateTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "../Vault/VaultTab.css";

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateVariable {
  name: string;
  defaultValue: string;
}

interface TemplateWithContent {
  meta: TemplateMeta;
  content: string;
  variables: TemplateVariable[];
}

type View = "list" | "execute" | "edit";

export function TemplateTab() {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<TemplateWithContent | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState("");
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  // Edit form
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editId, setEditId] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const firstVarRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await invoke<TemplateMeta[]>("template_list");
      setTemplates(list);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Select a template → load content → go to execute view
  const handleSelect = useCallback(
    async (id: string) => {
      try {
        const tmpl = await invoke<TemplateWithContent>("template_get", { id });
        setSelected(tmpl);
        const vars: Record<string, string> = {};
        for (const v of tmpl.variables) {
          vars[v.name] = v.defaultValue;
        }
        setVariables(vars);
        setRendered(tmpl.content);
        setView("execute");
        setTimeout(() => firstVarRef.current?.focus(), 50);
      } catch {
        showToast("Failed to load template");
      }
    },
    [showToast],
  );

  // Render template with current variable values
  const handleRender = useCallback(async () => {
    if (!selected) return;
    try {
      const text = await invoke<string>("template_execute", {
        input: { templateId: selected.meta.id, variables },
      });
      setRendered(text);
      return text;
    } catch {
      showToast("Render failed");
      return null;
    }
  }, [selected, variables, showToast]);

  // Send rendered template to active terminal
  const handleSend = useCallback(async () => {
    const text = await handleRender();
    if (!text) return;
    const state = useLayoutStore.getState();
    const sessionId = state.getActiveSessionId();
    if (!sessionId) {
      showToast("No active terminal");
      return;
    }
    const region = state.getFocusedRegion();
    const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
    const bytes = Array.from(new TextEncoder().encode(text + "\n"));
    const ipcCommand =
      activeTab?.status === "connected" ? "connection_write" : "pty_write";
    invoke(ipcCommand, { sessionId, data: bytes }).catch(() => {});
    showToast("Sent to terminal");
  }, [handleRender, showToast]);

  // Edit
  const handleStartEdit = useCallback((tmpl?: TemplateWithContent) => {
    setEditId(tmpl?.meta.id);
    setEditName(tmpl?.meta.name || "");
    setEditDesc(tmpl?.meta.description || "");
    setEditContent(tmpl?.content || "");
    setView("edit");
  }, []);

  const handleSave = useCallback(async () => {
    if (!editName.trim() || !editContent.trim()) return;
    setIsSaving(true);
    try {
      await invoke("template_create", {
        input: {
          id: editId,
          name: editName.trim(),
          description: editDesc.trim() || undefined,
          content: editContent,
        },
      });
      showToast(editId ? "Updated" : "Created");
      setView("list");
      await loadTemplates();
    } catch (err) {
      showToast(`Error: ${err}`);
    }
    setIsSaving(false);
  }, [editId, editName, editDesc, editContent, loadTemplates, showToast]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await invoke("template_delete", { id });
        showToast("Deleted");
        await loadTemplates();
      } catch {
        showToast("Cannot delete built-in template");
      }
    },
    [loadTemplates, showToast],
  );

  // Update rendered preview when variables change
  useEffect(() => {
    if (view === "execute" && selected) {
      const timer = setTimeout(() => handleRender(), 300);
      return () => clearTimeout(timer);
    }
  }, [variables, view, selected, handleRender]);

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.description.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="vault-tab">
      {toast && <div className="vault-tab__toast">{toast}</div>}

      <div className="vault-tab__header">
        {view !== "list" && (
          <button
            className="vault-tab__add-btn"
            style={{
              background: "transparent",
              border: "1px solid var(--hover-bg)",
              color: "var(--text-secondary)",
              fontSize: 14,
            }}
            onClick={() => setView("list")}
            title="Back to list"
          >
            ←
          </button>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
          📋{" "}
          {view === "list"
            ? "Templates"
            : view === "execute"
              ? selected?.meta.name
              : "Edit Template"}
        </span>
        {view === "list" && (
          <>
            <input
              className="vault-tab__filter"
              style={{ flex: 1 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
            />
            <button
              className="vault-tab__add-btn"
              onClick={() => handleStartEdit()}
              title="New template"
            >
              +
            </button>
          </>
        )}
      </div>

      {/* ── List View ──────────────────────────────────── */}
      {view === "list" && (
        <div className="vault-tab__list">
          {loading && <div className="vault-tab__empty">Loading…</div>}
          {filtered.map((t) => (
            <div
              key={t.id}
              className="vault-tab__item"
              style={{ cursor: "pointer" }}
            >
              <div
                className="vault-tab__item-info"
                style={{ flex: 1 }}
                onClick={() => handleSelect(t.id)}
              >
                <span className="vault-tab__item-name">{t.name}</span>
                {t.isBuiltin && (
                  <span className="vault-tab__item-badge">BUILT-IN</span>
                )}
                {t.description && (
                  <span className="vault-tab__item-user">{t.description}</span>
                )}
              </div>
              <div className="vault-tab__item-actions" style={{ opacity: 1 }}>
                {!t.isBuiltin && (
                  <>
                    <button
                      className="vault-tab__action"
                      onClick={() =>
                        handleSelect(t.id).then(() =>
                          handleStartEdit(selected || undefined),
                        )
                      }
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      className="vault-tab__action vault-tab__action--danger"
                      onClick={() => handleDelete(t.id)}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="vault-tab__empty">
              {filter
                ? "No matching templates"
                : "No templates — click + to create"}
            </div>
          )}
        </div>
      )}

      {/* ── Execute View ───────────────────────────────── */}
      {view === "execute" && selected && (
        <div
          className="vault-tab__list"
          style={{
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {selected.meta.description && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {selected.meta.description}
            </div>
          )}

          {/* Variables */}
          {selected.variables.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Variables
              </span>
              {selected.variables.map((v, i) => (
                <div
                  key={v.name}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--accent)",
                      fontFamily: "monospace",
                      minWidth: 100,
                    }}
                  >
                    {`{{${v.name}}}`}
                  </span>
                  <input
                    ref={i === 0 ? firstVarRef : undefined}
                    className="vault-tab__form-input"
                    value={variables[v.name] || ""}
                    onChange={(e) =>
                      setVariables({ ...variables, [v.name]: e.target.value })
                    }
                    placeholder={v.defaultValue || v.name}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSend();
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Preview */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              background: "var(--bg-secondary)",
              borderRadius: 4,
              padding: 8,
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              color: "var(--text-primary)",
              border: "1px solid var(--hover-bg)",
            }}
          >
            {rendered}
          </div>

          {/* Send button */}
          <button
            className="vault-tab__add-btn"
            style={{ width: "100%", height: 32, fontSize: 12 }}
            onClick={handleSend}
          >
            ▶ Send to Terminal
          </button>
        </div>
      )}

      {/* ── Edit View ──────────────────────────────────── */}
      {view === "edit" && (
        <div
          className="vault-tab__list"
          style={{
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <input
            className="vault-tab__form-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Template name"
            autoFocus
          />
          <input
            className="vault-tab__form-input"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Description (optional)"
          />
          <textarea
            style={{
              flex: 1,
              minHeight: 120,
              resize: "none",
              padding: 8,
              borderRadius: 4,
              border: "1px solid var(--hover-bg)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontFamily: "monospace",
              fontSize: 12,
              outline: "none",
            }}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder={
              "show ip interface brief\n! Use {{variable}} for substitution"
            }
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              className="vault-tab__form-cancel"
              style={{ width: "auto", padding: "4px 12px" }}
              onClick={() => setView("list")}
            >
              Cancel
            </button>
            <button
              className="vault-tab__form-save"
              style={{ width: "auto", padding: "4px 12px" }}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
