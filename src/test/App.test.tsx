import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App";

// Mock the Tauri invoke API so tests run without a Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("App", () => {
  it("renders the welcome heading", () => {
    render(<App />);

    const heading = screen.getByText("Welcome to Putz");
    expect(heading).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    render(<App />);

    const subtitle = screen.getByText(
      "A cross-platform terminal emulator built with Tauri",
    );
    expect(subtitle).toBeInTheDocument();
  });

  it("renders the greet form with input and button", () => {
    render(<App />);

    const input = screen.getByPlaceholderText("Enter a name...");
    const button = screen.getByRole("button", { name: "Greet" });

    expect(input).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it("has the app-root test id on the main container", () => {
    render(<App />);

    const root = screen.getByTestId("app-root");
    expect(root).toBeInTheDocument();
  });

  it("initially shows empty greet message", () => {
    render(<App />);

    const message = screen.getByTestId("greet-message");
    expect(message).toHaveTextContent("");
  });
});
