/**
 * AuthPromptDialog component tests.
 *
 * Tests rendering, password input, submit, and cancel flows.
 *
 * Tags: [TDD], [AC-SSH-5]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthPromptDialog } from "../components/Terminal/AuthPromptDialog";
import type { AuthPromptPayload } from "../components/Terminal/connectionTypes";

describe("AuthPromptDialog", () => {
  let onSubmit: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  const authPrompt: AuthPromptPayload = {
    username: "admin",
    methods: ["password"],
  };

  beforeEach(() => {
    onSubmit = vi.fn();
    onCancel = vi.fn();
  });

  it("renders the dialog overlay", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByTestId("auth-prompt-dialog")).toBeInTheDocument();
  });

  it("shows SSH Authentication title", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("SSH Authentication")).toBeInTheDocument();
  });

  it("displays username and host", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(
      screen.getByText(/admin@router\.local/),
    ).toBeInTheDocument();
  });

  it("shows a password input field", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "password");
  });

  it("has autoFocus on the password input", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    expect(input).toHaveFocus();
  });

  it("submit button is disabled when password is empty", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const submitBtn = screen.getByTestId("auth-submit");
    expect(submitBtn).toBeDisabled();
  });

  it("submit button is enabled when password has content", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "secret123");

    const submitBtn = screen.getByTestId("auth-submit");
    expect(submitBtn).not.toBeDisabled();
  });

  it("calls onSubmit with password when form is submitted", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "myPassword!");
    fireEvent.click(screen.getByTestId("auth-submit"));

    expect(onSubmit).toHaveBeenCalledWith("myPassword!");
  });

  it("clears password field after submission", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "clearme");
    fireEvent.click(screen.getByTestId("auth-submit"));

    expect(input).toHaveValue("");
  });

  it("calls onCancel when cancel button is clicked", () => {
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("auth-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onSubmit when password is whitespace-only", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "   ");

    // Submit button should be disabled for whitespace-only
    const submitBtn = screen.getByTestId("auth-submit");
    expect(submitBtn).toBeDisabled();
  });

  it("submit via keyboard Enter key works", async () => {
    const user = userEvent.setup();
    render(
      <AuthPromptDialog
        authPrompt={authPrompt}
        host="router.local"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByTestId("auth-password-input");
    await user.type(input, "enterPass{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("enterPass");
  });
});
