/**
 * CredentialEditor component tests.
 *
 * Tags: [AC-1], [AC-4], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialEditor } from "../components/Vault/CredentialEditor";
import type { Credential } from "../components/Vault/types";

describe("CredentialEditor", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn();
    onCancel = vi.fn();
  });

  // ─── Create mode ─────────────────────────────────────────

  it("renders create mode title", () => {
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText("New Credential")).toBeInTheDocument();
  });

  it("shows all required fields in create mode", () => {
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTestId("credential-editor-name")).toBeInTheDocument();
    expect(
      screen.getByTestId("credential-editor-username"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("credential-editor-secret"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("credential-editor-type")).toBeInTheDocument();
  });

  it("[AC-4] password field is masked by default", () => {
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);
    const secretInput = screen.getByTestId(
      "credential-editor-secret",
    ) as HTMLInputElement;
    expect(secretInput.type).toBe("password");
  });

  it("[AC-4] toggle reveals and hides password", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    const secretInput = screen.getByTestId(
      "credential-editor-secret",
    ) as HTMLInputElement;
    const toggleBtn = screen.getByTestId("credential-editor-toggle-secret");

    // Initially masked
    expect(secretInput.type).toBe("password");

    // Click to reveal
    await user.click(toggleBtn);
    expect(secretInput.type).toBe("text");

    // Click to hide again
    await user.click(toggleBtn);
    expect(secretInput.type).toBe("password");
  });

  // ─── Validation ──────────────────────────────────────────

  it("shows error when name is empty on submit", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    const saveBtn = screen.getByTestId("credential-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("credential-editor-name-error"),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows error when username is empty on submit", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("credential-editor-name"), "Test Cred");
    const saveBtn = screen.getByTestId("credential-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("credential-editor-username-error"),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows error when secret is empty on submit", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByTestId("credential-editor-name"), "Test");
    await user.type(
      screen.getByTestId("credential-editor-username"),
      "admin",
    );
    const saveBtn = screen.getByTestId("credential-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("credential-editor-secret-error"),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows error for name with path separator", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(
      screen.getByTestId("credential-editor-name"),
      "cred/prod",
    );
    await user.type(
      screen.getByTestId("credential-editor-username"),
      "admin",
    );
    await user.type(
      screen.getByTestId("credential-editor-secret"),
      "password",
    );
    await user.click(screen.getByTestId("credential-editor-save"));

    expect(
      screen.getByTestId("credential-editor-name-error"),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  // ─── Successful submit ──────────────────────────────────

  it("[AC-1] calls onSave with SetCredentialInput on valid submit", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(
      screen.getByTestId("credential-editor-name"),
      "DC1 Admin",
    );
    await user.type(
      screen.getByTestId("credential-editor-username"),
      "admin",
    );
    await user.type(
      screen.getByTestId("credential-editor-secret"),
      "hunter2",
    );
    await user.click(screen.getByTestId("credential-editor-save"));

    expect(onSave).toHaveBeenCalledWith({
      id: undefined,
      name: "DC1 Admin",
      username: "admin",
      secret: "hunter2",
      credentialType: "password",
    });
  });

  it("submits with key_passphrase type", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(
      screen.getByTestId("credential-editor-name"),
      "SSH Key",
    );
    await user.type(
      screen.getByTestId("credential-editor-username"),
      "deploy",
    );
    await user.type(
      screen.getByTestId("credential-editor-secret"),
      "passphrase",
    );
    await user.selectOptions(
      screen.getByTestId("credential-editor-type"),
      "key_passphrase",
    );
    await user.click(screen.getByTestId("credential-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialType: "key_passphrase",
      }),
    );
  });

  // ─── Edit mode ───────────────────────────────────────────

  it("[AC-4] renders edit mode with pre-filled data", () => {
    const credential: Credential = {
      meta: {
        id: "c1",
        name: "Existing Cred",
        username: "root",
        credentialType: "password",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      secret: "existingpass",
    };

    render(
      <CredentialEditor
        credential={credential}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Edit Credential")).toBeInTheDocument();
    expect(screen.getByTestId("credential-editor-name")).toHaveValue(
      "Existing Cred",
    );
    expect(screen.getByTestId("credential-editor-username")).toHaveValue(
      "root",
    );
    // Password is masked but has value
    const secretInput = screen.getByTestId(
      "credential-editor-secret",
    ) as HTMLInputElement;
    expect(secretInput.value).toBe("existingpass");
    expect(secretInput.type).toBe("password");
  });

  it("shows Update button in edit mode", () => {
    const credential: Credential = {
      meta: {
        id: "c1",
        name: "Test",
        username: "user",
        credentialType: "password",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      secret: "pass",
    };

    render(
      <CredentialEditor
        credential={credential}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId("credential-editor-save")).toHaveTextContent(
      "Update",
    );
  });

  it("includes credential id in edit mode submit", async () => {
    const user = userEvent.setup();
    const credential: Credential = {
      meta: {
        id: "cred-uuid-123",
        name: "Old Name",
        username: "admin",
        credentialType: "password",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      secret: "oldpass",
    };

    render(
      <CredentialEditor
        credential={credential}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByTestId("credential-editor-save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cred-uuid-123",
      }),
    );
  });

  // ─── Cancel ──────────────────────────────────────────────

  it("calls onCancel when cancel button clicked", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByTestId("credential-editor-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  // ─── Saving state ────────────────────────────────────────

  it("disables buttons when saving", () => {
    render(
      <CredentialEditor
        onSave={onSave}
        onCancel={onCancel}
        isSaving={true}
      />,
    );

    expect(screen.getByTestId("credential-editor-save")).toBeDisabled();
    expect(screen.getByTestId("credential-editor-cancel")).toBeDisabled();
    expect(screen.getByTestId("credential-editor-save")).toHaveTextContent(
      "Saving…",
    );
  });

  // ─── Label changes with type ─────────────────────────────

  it("shows Passphrase label for key_passphrase type", async () => {
    const user = userEvent.setup();
    render(<CredentialEditor onSave={onSave} onCancel={onCancel} />);

    await user.selectOptions(
      screen.getByTestId("credential-editor-type"),
      "key_passphrase",
    );

    expect(screen.getByLabelText(/Passphrase/)).toBeInTheDocument();
  });
});
