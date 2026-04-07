/**
 * SessionEditor — modal form for creating/editing session profiles.
 *
 * Supports create and edit modes:
 * - Create: empty form, generates new session on save
 * - Edit: pre-filled form, updates existing session on save
 *
 * Validates required fields and shows inline errors.
 * Port auto-fills based on selected protocol.
 */
import { useState, useCallback, useEffect } from "react";
import type {
  Protocol,
  CreateSessionInput,
  UpdateSessionInput,
  SessionProfile,
} from "./types";
import { PROTOCOL_DEFAULT_PORTS, PROTOCOL_LABELS } from "./types";

interface SessionEditorProps {
  /** Session to edit (undefined = create mode). */
  session?: SessionProfile;
  /** Default folder ID for new sessions. */
  folderId?: string;
  /** Called with validated input on save. */
  onSave: (input: CreateSessionInput | UpdateSessionInput) => void;
  /** Called when the editor is cancelled. */
  onCancel: () => void;
  /** Whether the form is currently saving. */
  isSaving?: boolean;
}

/** Validation errors keyed by field name. */
interface FormErrors {
  name?: string;
  host?: string;
  port?: string;
}

/** All protocol options. */
const PROTOCOLS: Protocol[] = ["ssh", "telnet", "serial", "local"];

export function SessionEditor({
  session,
  folderId = "root",
  onSave,
  onCancel,
  isSaving = false,
}: SessionEditorProps) {
  const isEdit = !!session;

  const [name, setName] = useState(session?.name ?? "");
  const [protocol, setProtocol] = useState<Protocol>(
    session?.protocol ?? "ssh",
  );
  const [host, setHost] = useState(session?.host ?? "");
  const [port, setPort] = useState(
    session?.port?.toString() ?? PROTOCOL_DEFAULT_PORTS.ssh?.toString() ?? "",
  );
  const [username, setUsername] = useState(session?.username ?? "");
  const [errors, setErrors] = useState<FormErrors>({});

  // Auto-fill port when protocol changes (only in create mode)
  useEffect(() => {
    if (!isEdit) {
      const defaultPort = PROTOCOL_DEFAULT_PORTS[protocol];
      setPort(defaultPort?.toString() ?? "");
    }
  }, [protocol, isEdit]);

  const validate = useCallback((): FormErrors => {
    const errs: FormErrors = {};

    if (!name.trim()) {
      errs.name = "Name is required";
    } else if (name.trim().length > 200) {
      errs.name = "Name must be 200 characters or less";
    } else if (name.includes("/") || name.includes("\\")) {
      errs.name = "Name cannot contain / or \\";
    }

    if (protocol === "ssh" || protocol === "telnet") {
      if (!host.trim()) {
        errs.host = "Host is required for this protocol";
      }
    }

    if (port.trim()) {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errs.port = "Port must be between 1 and 65535";
      }
    }

    return errs;
  }, [name, host, port, protocol]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const errs = validate();
      setErrors(errs);

      if (Object.keys(errs).length > 0) {
        return;
      }

      const portNum = port.trim() ? parseInt(port, 10) : undefined;

      if (isEdit) {
        const input: UpdateSessionInput = {
          name: name.trim(),
          protocol,
          host: host.trim() || undefined,
          port: portNum,
          username: username.trim() || undefined,
        };
        onSave(input);
      } else {
        const input: CreateSessionInput = {
          name: name.trim(),
          folderId,
          protocol,
          host: host.trim() || undefined,
          port: portNum,
          username: username.trim() || undefined,
        };
        onSave(input);
      }
    },
    [name, protocol, host, port, username, folderId, isEdit, onSave, validate],
  );

  /** Whether the protocol needs host/port fields. */
  const needsHost = protocol === "ssh" || protocol === "telnet";

  return (
    <div
      className="session-editor-overlay"
      data-testid="session-editor"
      onClick={onCancel}
    >
      <form
        className="session-editor"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        data-testid="session-editor-form"
      >
        <h2 className="session-editor-title">
          {isEdit ? "Edit Session" : "New Session"}
        </h2>

        {/* Name */}
        <div className="session-editor-field">
          <label htmlFor="session-name">Name *</label>
          <input
            id="session-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Server"
            aria-invalid={!!errors.name}
            data-testid="session-editor-name"
            autoFocus
          />
          {errors.name && (
            <span
              className="session-editor-error"
              data-testid="session-editor-name-error"
            >
              {errors.name}
            </span>
          )}
        </div>

        {/* Protocol */}
        <div className="session-editor-field">
          <label htmlFor="session-protocol">Protocol</label>
          <select
            id="session-protocol"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol)}
            data-testid="session-editor-protocol"
          >
            {PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {PROTOCOL_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        {/* Host */}
        {needsHost && (
          <div className="session-editor-field">
            <label htmlFor="session-host">Host *</label>
            <input
              id="session-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="hostname or IP"
              aria-invalid={!!errors.host}
              data-testid="session-editor-host"
            />
            {errors.host && (
              <span
                className="session-editor-error"
                data-testid="session-editor-host-error"
              >
                {errors.host}
              </span>
            )}
          </div>
        )}

        {/* Port */}
        {needsHost && (
          <div className="session-editor-field">
            <label htmlFor="session-port">Port</label>
            <input
              id="session-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1}
              max={65535}
              aria-invalid={!!errors.port}
              data-testid="session-editor-port"
            />
            {errors.port && (
              <span
                className="session-editor-error"
                data-testid="session-editor-port-error"
              >
                {errors.port}
              </span>
            )}
          </div>
        )}

        {/* Username */}
        <div className="session-editor-field">
          <label htmlFor="session-username">Username</label>
          <input
            id="session-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            data-testid="session-editor-username"
          />
        </div>

        {/* Actions */}
        <div className="session-editor-actions">
          <button
            type="button"
            className="session-editor-cancel"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="session-editor-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="session-editor-save"
            disabled={isSaving}
            data-testid="session-editor-save"
          >
            {isSaving ? "Saving…" : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
