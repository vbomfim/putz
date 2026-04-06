/**
 * Accessibility tests for the App component.
 *
 * Verifies semantic HTML structure, ARIA attributes, and keyboard
 * accessibility. The PO ticket (Issue #2) requires WCAG 2.2 Level AA
 * for all non-terminal UI elements.
 *
 * Tags: [COVERAGE], [AC-2]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App";

// Mock the Tauri invoke API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("App — Accessibility", () => {
  /**
   * [COVERAGE] The main container uses semantic <main> element,
   * which is critical for screen readers to identify the primary content.
   */
  it("uses semantic <main> element as app container", () => {
    render(<App />);

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
  });

  /**
   * [COVERAGE] Page has exactly one <h1> heading — required for
   * proper document outline and screen reader navigation.
   */
  it("has exactly one h1 heading", () => {
    render(<App />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Welcome to Putz");
  });

  /**
   * [COVERAGE] The name input has an aria-label for screen readers,
   * since it doesn't have a visible <label> element associated with it.
   */
  it("name input has aria-label for screen readers", () => {
    render(<App />);

    const input = screen.getByLabelText("Name input");
    expect(input).toBeInTheDocument();
  });

  /**
   * [COVERAGE] The submit button has accessible text via its content.
   */
  it("submit button has accessible name", () => {
    render(<App />);

    const button = screen.getByRole("button", { name: "Greet" });
    expect(button).toBeInTheDocument();
  });

  /**
   * [COVERAGE] The greet form is a proper <form> element with
   * submit behavior, not a div with onClick handlers.
   */
  it("uses a proper form element for the greet input", () => {
    render(<App />);

    const form = document.querySelector("form.greet-form");
    expect(form).not.toBeNull();
  });

  /**
   * [COVERAGE] The submit button has type="submit" so it works
   * with native form submission and keyboard Enter.
   */
  it("submit button has type=submit for keyboard accessibility", () => {
    render(<App />);

    const button = screen.getByRole("button", { name: "Greet" });
    expect(button).toHaveAttribute("type", "submit");
  });

  /**
   * [COVERAGE] The input has a placeholder text to guide users.
   */
  it("input has descriptive placeholder text", () => {
    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    expect(input).toBeInTheDocument();
  });

  /**
   * [COVERAGE] The greet message area has a test ID for automation
   * AND is present in the DOM even when empty (not conditionally rendered),
   * so screen readers can track the live region.
   */
  it("greet message area is always present in DOM", () => {
    render(<App />);

    const message = screen.getByTestId("greet-message");
    expect(message).toBeInTheDocument();
    // Should be a <p> element for semantic meaning
    expect(message.tagName).toBe("P");
  });
});
