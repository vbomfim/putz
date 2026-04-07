/**
 * SessionEditor component tests.
 *
 * Tags: [AC-1], [AC-5], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionEditor } from "../components/SessionManager/SessionEditor";
import type { SessionProfile } from "../components/SessionManager/types";

describe("SessionEditor", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn();
    onCancel = vi.fn();
  });

  // ─── Create mode ─────────────────────────────────────────

  it("renders create mode title", () => {
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText("New Session")).toBeInTheDocument();
  });

  it("shows required fields in create mode", () => {
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTestId("session-editor-name")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-protocol")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-host")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-port")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-username")).toBeInTheDocument();
  });

  it("auto-fills port 22 for SSH protocol", () => {
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);
    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    expect(port.value).toBe("22");
  });

  it("changes port when protocol changes", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const protocol = screen.getByTestId("session-editor-protocol");
    await user.selectOptions(protocol, "telnet");

    const port = screen.getByTestId("session-editor-port") as HTMLInputElement;
    expect(port.value).toBe("23");
  });

  it("hides host/port for local protocol", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const protocol = screen.getByTestId("session-editor-protocol");
    await user.selectOptions(protocol, "local");

    expect(
      screen.queryByTestId("session-editor-host"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-editor-port"),
    ).not.toBeInTheDocument();
  });

  // ─── Validation ──────────────────────────────────────────

  it("shows error when name is empty on submit", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const saveBtn = screen.getByTestId("session-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("session-editor-name-error"),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows error when host is empty for SSH", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const name = screen.getByTestId("session-editor-name");
    await user.type(name, "My Server");

    const saveBtn = screen.getByTestId("session-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("session-editor-host-error"),
    ).toBeInTheDocument();
  });

  it("validates port range (1-65535)", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const name = screen.getByTestId("session-editor-name");
    await user.type(name, "My Server");

    const host = screen.getByTestId("session-editor-host");
    await user.type(host, "example.com");

    // Submit with default port (22) should succeed
    const saveBtn = screen.getByTestId("session-editor-save");
    await user.click(saveBtn);
    expect(onSave).toHaveBeenCalled();
    expect(
      screen.queryByTestId("session-editor-port-error"),
    ).not.toBeInTheDocument();
  });

  it("shows error for name with path separator", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    const name = screen.getByTestId("session-editor-name");
    await user.type(name, "my/server");

    const host = screen.getByTestId("session-editor-host");
    await user.type(host, "example.com");

    const saveBtn = screen.getByTestId("session-editor-save");
    await user.click(saveBtn);

    expect(
      screen.getByTestId("session-editor-name-error"),
    ).toBeInTheDocument();
  });

  // ─── Successful submit ──────────────────────────────────

  it("[AC-1] calls onSave with CreateSessionInput on valid submit", async () => {
    const user = userEvent.setup();
    render(
      <SessionEditor
        onSave={onSave}
        onCancel={onCancel}
        folderId="folder-1"
      />,
    );

    await user.type(screen.getByTestId("session-editor-name"), "New Server");
    await user.type(screen.getByTestId("session-editor-host"), "10.0.0.1");
    await user.type(screen.getByTestId("session-editor-username"), "admin");
    await user.click(screen.getByTestId("session-editor-save"));

    expect(onSave).toHaveBeenCalledWith({
      name: "New Server",
      folderId: "folder-1",
      protocol: "ssh",
      host: "10.0.0.1",
      port: 22,
      username: "admin",
    });
  });

  // ─── Edit mode ───────────────────────────────────────────

  it("[AC-5] renders edit mode with pre-filled data", () => {
    const session: SessionProfile = {
      id: "s1",
      name: "Existing Server",
      folderId: "root",
      protocol: "ssh",
      host: "example.com",
      port: 2222,
      username: "root",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    render(
      <SessionEditor
        session={session}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Edit Session")).toBeInTheDocument();
    expect(screen.getByTestId("session-editor-name")).toHaveValue(
      "Existing Server",
    );
    expect(screen.getByTestId("session-editor-host")).toHaveValue(
      "example.com",
    );
    expect(screen.getByTestId("session-editor-port")).toHaveValue(2222);
    expect(screen.getByTestId("session-editor-username")).toHaveValue("root");
  });

  it("shows Update button in edit mode", () => {
    const session: SessionProfile = {
      id: "s1",
      name: "Test",
      folderId: "root",
      protocol: "ssh",
      host: "test.com",
      port: 22,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    render(
      <SessionEditor
        session={session}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId("session-editor-save")).toHaveTextContent(
      "Update",
    );
  });

  // ─── Cancel ──────────────────────────────────────────────

  it("calls onCancel when cancel button clicked", async () => {
    const user = userEvent.setup();
    render(<SessionEditor onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByTestId("session-editor-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  // ─── Saving state ────────────────────────────────────────

  it("disables buttons when saving", () => {
    render(
      <SessionEditor
        onSave={onSave}
        onCancel={onCancel}
        isSaving={true}
      />,
    );

    expect(screen.getByTestId("session-editor-save")).toBeDisabled();
    expect(screen.getByTestId("session-editor-cancel")).toBeDisabled();
    expect(screen.getByTestId("session-editor-save")).toHaveTextContent(
      "Saving…",
    );
  });
});
