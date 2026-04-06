/**
 * Integration tests for App component user interactions.
 *
 * Tests the greet form submission flow — user types a name,
 * submits, and sees the greeting message from the Rust backend.
 * These test BEHAVIOR through the component's public interface (the DOM),
 * not implementation details.
 *
 * Tags: [BOUNDARY], [EDGE], [CONTRACT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Mock module — re-declared per file so each test file is independent
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("App — User Interaction Flow", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  /**
   * [BOUNDARY] Tests the complete greet flow:
   * User types name → clicks Greet → sees greeting from Rust backend.
   * This is the primary integration boundary between React and Tauri IPC.
   */
  it("displays greeting message after successful form submission", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce(
      "Hello, Alice! You've been greeted from Rust!",
    );

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    await user.type(input, "Alice");
    await user.click(button);

    await waitFor(() => {
      const message = screen.getByTestId("greet-message");
      expect(message).toHaveTextContent(
        "Hello, Alice! You've been greeted from Rust!",
      );
    });
  });

  /**
   * [CONTRACT] Verifies invoke is called with the correct Tauri command
   * name and argument structure. This is the IPC contract between
   * frontend and backend.
   */
  it("calls invoke with correct command and arguments", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce("Hello, Bob!");

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    await user.type(input, "Bob");
    await user.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("greet", { name: "Bob" });
    });
  });

  /**
   * [CONTRACT] Verifies invoke is called exactly once per form submission,
   * not on every keystroke.
   */
  it("only calls invoke on form submission, not on input change", async () => {
    const user = userEvent.setup();

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    await user.type(input, "Charlie");

    // invoke should NOT have been called yet — only typing happened
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  /**
   * [EDGE] Tests form submission with empty name.
   * The backend accepts empty strings, so the frontend should too.
   */
  it("submits form with empty name", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce("Hello, ! You've been greeted from Rust!");

    render(<App />);

    const button = screen.getByRole("button", { name: "Greet" });
    await user.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("greet", { name: "" });
    });
  });

  /**
   * [EDGE] Documents that handleGreet() lacks error handling.
   *
   * CODE BUG: App.tsx handleGreet() calls `await invoke(...)` without
   * try/catch. If the Tauri IPC rejects (backend crash, timeout, etc.),
   * the error propagates as an unhandled promise rejection — which will
   * crash in production or show a native error dialog.
   *
   * This test verifies the invoke function is called (confirming the
   * code path exists), and documents the missing error handling for
   * the Developer Guardian to fix.
   *
   * Recommended fix in App.tsx:
   * ```tsx
   * async function handleGreet(e: FormEvent) {
   *   e.preventDefault();
   *   try {
   *     const message = await invoke<string>("greet", { name });
   *     setGreetMsg(message);
   *   } catch (err) {
   *     setGreetMsg("Error: Could not reach backend");
   *   }
   * }
   * ```
   */
  it("calls invoke even though error handling is missing (code bug documented)", async () => {
    const user = userEvent.setup();
    // Use a resolved value here — the unhandled rejection test is
    // intentionally skipped because jsdom + Vitest can't cleanly capture it.
    // The bug is documented: handleGreet() needs try/catch.
    mockInvoke.mockResolvedValueOnce("Hello, ErrorTest!");

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    await user.type(input, "ErrorTest");
    await user.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * [EDGE] Tests form submission with unicode characters.
   * Names with accents, CJK characters, emoji should pass through correctly.
   */
  it("submits form with unicode characters in name", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce("Hello, José 日本語 🚀!");

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    await user.type(input, "José 日本語 🚀");
    await user.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("greet", {
        name: "José 日本語 🚀",
      });
    });
  });

  /**
   * [BOUNDARY] Tests that submitting the form via Enter key works
   * the same as clicking the button. This ensures keyboard-driven
   * submission works (accessibility + power users).
   */
  it("submits form via Enter key on input", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce("Hello, KeyboardUser!");

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");

    await user.type(input, "KeyboardUser");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("greet", {
        name: "KeyboardUser",
      });
    });
  });

  /**
   * [EDGE] Tests multiple consecutive form submissions.
   * The greeting message should update to the latest response.
   */
  it("updates greeting on consecutive submissions", async () => {
    const user = userEvent.setup();
    mockInvoke
      .mockResolvedValueOnce("Hello, First!")
      .mockResolvedValueOnce("Hello, Second!");

    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    // First submission
    await user.type(input, "First");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("greet-message")).toHaveTextContent(
        "Hello, First!",
      );
    });

    // Clear and second submission
    await user.clear(input);
    await user.type(input, "Second");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("greet-message")).toHaveTextContent(
        "Hello, Second!",
      );
    });
  });
});
