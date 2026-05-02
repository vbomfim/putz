/**
 * VaultTab — Credentials and SSH Keys in a single tab.
 *
 * Designed for speed: inline editing, one-click copy password,
 * one-click copy public key. No modal popups.
 *
 * @module VaultTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./VaultTab.css";

// ── Types (mirror Rust models) ────────────────────────────────
interface CredentialMeta {
  id: string;
  name: string;
  username: string;
  credentialType: "password" | "key_passphrase";
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SSHKeyMeta {
  id: string;
  name: string;
  algorithm: "ed25519" | "rsa-4096";
  fingerprint: string;
  publicKey: string;
  hasPassphrase: boolean;
  createdAt: string;
}

// ── Main Component ────────────────────────────────────────────
export function VaultTab() {
  // Credentials state
  const [creds, setCreds] = useState<CredentialMeta[]>([]);
  const [keys, setKeys] = useState<SSHKeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("");
  const [section, setSection] = useState<"creds" | "keys">("creds");

  // Inline editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    secret: "",
    type: "password" as "password" | "key_passphrase",
  });
  const [keyForm, setKeyForm] = useState({
    name: "",
    algorithm: "ed25519" as "ed25519" | "rsa-4096",
    passphrase: "",
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  // Load data
  const loadAll = useCallback(async () => {
    try {
      const [credList, keyList] = await Promise.all([
        invoke<CredentialMeta[]>("vault_list"),
        invoke<SSHKeyMeta[]>("key_list"),
      ]);
      setCreds(credList);
      setKeys(keyList);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Credential actions ──────────────────────────────────────
  const handleCopyPassword = useCallback(
    async (id: string) => {
      try {
        const cred = await invoke<{ meta: CredentialMeta; secret: string }>(
          "vault_get",
          { id },
        );
        await navigator.clipboard.writeText(cred.secret);
        showToast("Password copied");
      } catch {
        showToast("Failed to copy");
      }
    },
    [showToast],
  );

  const handleCopyUsername = useCallback(
    async (username: string) => {
      await navigator.clipboard.writeText(username);
      showToast("Username copied");
    },
    [showToast],
  );

  const handleEditCred = useCallback(
    async (id: string) => {
      try {
        const cred = await invoke<{ meta: CredentialMeta; secret: string }>(
          "vault_get",
          { id },
        );
        setForm({
          name: cred.meta.name,
          username: cred.meta.username,
          secret: cred.secret,
          type: cred.meta.credentialType,
        });
        setEditingId(id);
        setIsAdding(false);
        setTimeout(() => nameInputRef.current?.focus(), 50);
      } catch {
        showToast("Failed to load credential");
      }
    },
    [showToast],
  );

  const handleAddCred = useCallback(() => {
    setForm({ name: "", username: "", secret: "", type: "password" });
    setEditingId(null);
    setIsAdding(true);
    setSection("creds");
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleSaveCred = useCallback(async () => {
    if (!form.name.trim() || !form.username.trim() || !form.secret.trim())
      return;
    setIsSaving(true);
    try {
      await invoke("vault_set", {
        input: {
          id: editingId || undefined,
          name: form.name.trim(),
          username: form.username.trim(),
          secret: form.secret,
          credentialType: form.type,
        },
      });
      setEditingId(null);
      setIsAdding(false);
      showToast(editingId ? "Updated" : "Created");
      await loadAll();
    } catch (err) {
      showToast(`Error: ${err}`);
    }
    setIsSaving(false);
  }, [form, editingId, loadAll, showToast]);

  const handleDeleteCred = useCallback(
    async (id: string) => {
      try {
        await invoke("vault_delete", { id });
        if (editingId === id) {
          setEditingId(null);
          setIsAdding(false);
        }
        showToast("Deleted");
        await loadAll();
      } catch {
        showToast("Failed to delete");
      }
    },
    [editingId, loadAll, showToast],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setIsAdding(false);
  }, []);

  // ── SSH Key actions ─────────────────────────────────────────
  const handleCopyPubKey = useCallback(
    async (id: string) => {
      try {
        const pubKey = await invoke<string>("key_get_public", { id });
        await navigator.clipboard.writeText(pubKey);
        showToast("Public key copied");
      } catch {
        showToast("Failed to copy");
      }
    },
    [showToast],
  );

  const handleDeleteKey = useCallback(
    async (id: string) => {
      try {
        await invoke("key_delete", { id });
        showToast("Key deleted");
        await loadAll();
      } catch {
        showToast("Failed to delete");
      }
    },
    [loadAll, showToast],
  );

  const handleGenerateKey = useCallback(async () => {
    if (!keyForm.name.trim()) return;
    setIsGenerating(true);
    try {
      await invoke("key_generate", {
        input: {
          name: keyForm.name.trim(),
          algorithm: keyForm.algorithm,
          passphrase: keyForm.passphrase || undefined,
        },
      });
      setKeyForm({ name: "", algorithm: "ed25519", passphrase: "" });
      setIsAdding(false);
      showToast("Key generated");
      await loadAll();
    } catch (err) {
      showToast(`Error: ${err}`);
    }
    setIsGenerating(false);
  }, [keyForm, loadAll, showToast]);

  // ── Filter ──────────────────────────────────────────────────
  const lowerFilter = filter.toLowerCase();
  const filteredCreds = creds.filter(
    (c) =>
      c.name.toLowerCase().includes(lowerFilter) ||
      c.username.toLowerCase().includes(lowerFilter),
  );
  const filteredKeys = keys.filter(
    (k) =>
      k.name.toLowerCase().includes(lowerFilter) ||
      k.fingerprint.toLowerCase().includes(lowerFilter),
  );

  // ── Keyboard shortcuts ──────────────────────────────────────
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (section === "creds") handleSaveCred();
        else handleGenerateKey();
      }
      if (e.key === "Escape") handleCancelEdit();
    },
    [section, handleSaveCred, handleGenerateKey, handleCancelEdit],
  );

  if (loading) {
    return (
      <div className="vault-tab">
        <div className="vault-tab__loading">Loading vault…</div>
      </div>
    );
  }

  return (
    <div className="vault-tab" onKeyDown={handleFormKeyDown}>
      {/* Toast */}
      {toast && <div className="vault-tab__toast">{toast}</div>}

      {/* Header: filter + section tabs + add button */}
      <div className="vault-tab__header">
        <div className="vault-tab__section-tabs">
          <button
            className={`vault-tab__section-btn ${section === "creds" ? "vault-tab__section-btn--active" : ""}`}
            onClick={() => setSection("creds")}
          >
            🔑 Credentials ({creds.length})
          </button>
          <button
            className={`vault-tab__section-btn ${section === "keys" ? "vault-tab__section-btn--active" : ""}`}
            onClick={() => setSection("keys")}
          >
            🔐 SSH Keys ({keys.length})
          </button>
        </div>
        <input
          className="vault-tab__filter"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
        />
        <button
          className="vault-tab__add-btn"
          onClick={() => {
            if (section === "creds") handleAddCred();
            else {
              setIsAdding(true);
              setSection("keys");
            }
          }}
        >
          +
        </button>
      </div>

      {/* ── Credentials section ──────────────────────────── */}
      {section === "creds" && (
        <div className="vault-tab__list">
          {/* Inline add/edit form */}
          {(isAdding || editingId) && (
            <div className="vault-tab__inline-form">
              <div className="vault-tab__form-row">
                <input
                  ref={nameInputRef}
                  className="vault-tab__form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Name (e.g. router-admin)"
                />
                <input
                  className="vault-tab__form-input"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  placeholder="Username"
                />
              </div>
              <div className="vault-tab__form-row">
                <input
                  className="vault-tab__form-input vault-tab__form-input--flex"
                  type="password"
                  value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                  placeholder="Password / Secret"
                />
                <select
                  className="vault-tab__form-select"
                  value={form.type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      type: e.target.value as "password" | "key_passphrase",
                    })
                  }
                >
                  <option value="password">Password</option>
                  <option value="key_passphrase">Key Passphrase</option>
                </select>
                <button
                  className="vault-tab__form-save"
                  onClick={handleSaveCred}
                  disabled={isSaving}
                >
                  {isSaving ? "…" : "✓"}
                </button>
                <button
                  className="vault-tab__form-cancel"
                  onClick={handleCancelEdit}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Credential list */}
          {filteredCreds.map((c) => (
            <div
              key={c.id}
              className={`vault-tab__item ${editingId === c.id ? "vault-tab__item--editing" : ""}`}
            >
              <div className="vault-tab__item-info">
                <span className="vault-tab__item-name">{c.name}</span>
                <span className="vault-tab__item-user">{c.username}</span>
                <span className="vault-tab__item-badge">
                  {c.credentialType === "password" ? "PWD" : "KEY"}
                </span>
              </div>
              <div className="vault-tab__item-actions">
                <button
                  className="vault-tab__action"
                  onClick={() => handleCopyUsername(c.username)}
                  title="Copy username"
                >
                  👤
                </button>
                <button
                  className="vault-tab__action"
                  onClick={() => handleCopyPassword(c.id)}
                  title="Copy password"
                >
                  📋
                </button>
                <button
                  className="vault-tab__action"
                  onClick={() => handleEditCred(c.id)}
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  className="vault-tab__action vault-tab__action--danger"
                  onClick={() => handleDeleteCred(c.id)}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
          {filteredCreds.length === 0 && !isAdding && (
            <div className="vault-tab__empty">
              {filter
                ? "No matching credentials"
                : "No credentials — click + to add"}
            </div>
          )}
        </div>
      )}

      {/* ── SSH Keys section ─────────────────────────────── */}
      {section === "keys" && (
        <div className="vault-tab__list">
          {/* Inline generate form */}
          {isAdding && (
            <div className="vault-tab__inline-form">
              <div className="vault-tab__form-row">
                <input
                  ref={nameInputRef}
                  className="vault-tab__form-input vault-tab__form-input--flex"
                  value={keyForm.name}
                  onChange={(e) =>
                    setKeyForm({ ...keyForm, name: e.target.value })
                  }
                  placeholder="Key name (e.g. prod-router)"
                  autoFocus
                />
                <select
                  className="vault-tab__form-select"
                  value={keyForm.algorithm}
                  onChange={(e) =>
                    setKeyForm({
                      ...keyForm,
                      algorithm: e.target.value as "ed25519" | "rsa-4096",
                    })
                  }
                >
                  <option value="ed25519">Ed25519</option>
                  <option value="rsa-4096">RSA-4096</option>
                </select>
                <input
                  className="vault-tab__form-input"
                  type="password"
                  value={keyForm.passphrase}
                  onChange={(e) =>
                    setKeyForm({ ...keyForm, passphrase: e.target.value })
                  }
                  placeholder="Passphrase (optional)"
                />
                <button
                  className="vault-tab__form-save"
                  onClick={handleGenerateKey}
                  disabled={isGenerating}
                >
                  {isGenerating ? "…" : "⚡"}
                </button>
                <button
                  className="vault-tab__form-cancel"
                  onClick={handleCancelEdit}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Key list */}
          {filteredKeys.map((k) => (
            <div key={k.id} className="vault-tab__item">
              <div className="vault-tab__item-info">
                <span className="vault-tab__item-name">{k.name}</span>
                <span className="vault-tab__item-badge">
                  {k.algorithm === "ed25519" ? "ED25519" : "RSA"}
                </span>
                <span
                  className="vault-tab__item-fingerprint"
                  title={k.fingerprint}
                >
                  {k.fingerprint.substring(0, 24)}…
                </span>
              </div>
              <div className="vault-tab__item-actions">
                <button
                  className="vault-tab__action"
                  onClick={() => handleCopyPubKey(k.id)}
                  title="Copy public key"
                >
                  📋
                </button>
                <button
                  className="vault-tab__action vault-tab__action--danger"
                  onClick={() => handleDeleteKey(k.id)}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
          {filteredKeys.length === 0 && !isAdding && (
            <div className="vault-tab__empty">
              {filter
                ? "No matching keys"
                : "No SSH keys — click + to generate"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
