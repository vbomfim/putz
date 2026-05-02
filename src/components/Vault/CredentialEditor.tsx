/**
 * CredentialEditor — modal form for creating/editing credentials.
 *
 * Supports create and edit modes:
 * - Create: empty form, generates new credential on save
 * - Edit: pre-filled form (password masked), updates existing on save
 *
 * SECURITY: Password field is masked by default with a reveal toggle.
 * The secret only transits through the frontend for this editor form.
 */
import { useState, useCallback, useEffect } from "react";
import type { CredentialType, SetCredentialInput, Credential } from "./types";
import { CREDENTIAL_TYPE_LABELS } from "./types";

interface CredentialEditorProps {
  /** Credential to edit (undefined = create mode). */
  credential?: Credential;
  /** Called with validated input on save. */
  onSave: (input: SetCredentialInput) => void;
  /** Called when the editor is cancelled. */
  onCancel: () => void;
  /** Whether the form is currently saving. */
  isSaving?: boolean;
}

/** Validation errors keyed by field name. */
interface FormErrors {
  name?: string;
  username?: string;
  secret?: string;
}

/** All credential type options. */
const CREDENTIAL_TYPES: CredentialType[] = ["password", "key_passphrase"];

export function CredentialEditor({
  credential,
  onSave,
  onCancel,
  isSaving = false,
}: CredentialEditorProps) {
  const isEdit = !!credential;

  const [name, setName] = useState(credential?.meta.name ?? "");
  const [username, setUsername] = useState(credential?.meta.username ?? "");
  const [secret, setSecret] = useState(credential?.secret ?? "");
  const [credentialType, setCredentialType] = useState<CredentialType>(
    credential?.meta.credentialType ?? "password",
  );
  const [showSecret, setShowSecret] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const validate = useCallback((): FormErrors => {
    const errs: FormErrors = {};

    if (!name.trim()) {
      errs.name = "Name is required";
    } else if (name.trim().length > 200) {
      errs.name = "Name must be 200 characters or less";
    } else if (name.includes("/") || name.includes("\\")) {
      errs.name = "Name cannot contain / or \\";
    }

    if (!username.trim()) {
      errs.username = "Username is required";
    } else if (username.trim().length > 200) {
      errs.username = "Username must be 200 characters or less";
    }

    if (!secret) {
      errs.secret = "Password is required";
    }

    return errs;
  }, [name, username, secret]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const errs = validate();
      setErrors(errs);

      if (Object.keys(errs).length > 0) {
        return;
      }

      const input: SetCredentialInput = {
        id: isEdit ? credential?.meta.id : undefined,
        name: name.trim(),
        username: username.trim(),
        secret,
        credentialType,
      };
      onSave(input);
    },
    [
      name,
      username,
      secret,
      credentialType,
      isEdit,
      credential,
      onSave,
      validate,
    ],
  );

  return (
    <div
      className="credential-editor-overlay"
      data-testid="credential-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credential-editor-title"
      onClick={onCancel}
    >
      <form
        className="credential-editor"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        data-testid="credential-editor-form"
      >
        <h2 className="credential-editor-title" id="credential-editor-title">
          {isEdit ? "Edit Credential" : "New Credential"}
        </h2>

        {/* Name */}
        <div className="credential-editor-field">
          <label htmlFor="credential-name">Name *</label>
          <input
            id="credential-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="DC1 Admin"
            aria-invalid={!!errors.name}
            data-testid="credential-editor-name"
            autoFocus
          />
          {errors.name && (
            <span
              className="credential-editor-error"
              data-testid="credential-editor-name-error"
            >
              {errors.name}
            </span>
          )}
        </div>

        {/* Username */}
        <div className="credential-editor-field">
          <label htmlFor="credential-username">Username *</label>
          <input
            id="credential-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            aria-invalid={!!errors.username}
            data-testid="credential-editor-username"
          />
          {errors.username && (
            <span
              className="credential-editor-error"
              data-testid="credential-editor-username-error"
            >
              {errors.username}
            </span>
          )}
        </div>

        {/* Secret (Password / Passphrase) */}
        <div className="credential-editor-field">
          <label htmlFor="credential-secret">
            {credentialType === "key_passphrase" ? "Passphrase" : "Password"} *
          </label>
          <div className="credential-editor-secret-row">
            <input
              id="credential-secret"
              type={showSecret ? "text" : "password"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••"
              aria-invalid={!!errors.secret}
              autoComplete="off"
              data-testid="credential-editor-secret"
            />
            <button
              type="button"
              className="credential-editor-toggle-secret"
              onClick={() => setShowSecret(!showSecret)}
              data-testid="credential-editor-toggle-secret"
              aria-label={showSecret ? "Hide password" : "Show password"}
            >
              {showSecret ? "🙈" : "👁"}
            </button>
          </div>
          {errors.secret && (
            <span
              className="credential-editor-error"
              data-testid="credential-editor-secret-error"
            >
              {errors.secret}
            </span>
          )}
        </div>

        {/* Type */}
        <div className="credential-editor-field">
          <label htmlFor="credential-type">Type</label>
          <select
            id="credential-type"
            value={credentialType}
            onChange={(e) =>
              setCredentialType(e.target.value as CredentialType)
            }
            data-testid="credential-editor-type"
          >
            {CREDENTIAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CREDENTIAL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="credential-editor-actions">
          <button
            type="button"
            className="credential-editor-cancel"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="credential-editor-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="credential-editor-save"
            disabled={isSaving}
            data-testid="credential-editor-save"
          >
            {isSaving ? "Saving…" : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
