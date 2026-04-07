/**
 * KeyGenerator component tests.
 *
 * Tests the key generation form: name input, algorithm selection,
 * passphrase field, submit/cancel behavior, and error handling.
 *
 * Tags: [TDD], [COMPONENT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyGenerator } from "../components/Keys/KeyGenerator";

// Mock the IPC layer
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("KeyGenerator", () => {
  const mockOnGenerated = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
  });

  const renderGenerator = () =>
    render(
      <KeyGenerator onGenerated={mockOnGenerated} onCancel={mockOnCancel} />,
    );

  // ─── Rendering ─────────────────────────────────────────────

  it("renders the generator form", () => {
    renderGenerator();
    expect(screen.getByTestId("key-generator")).toBeInTheDocument();
    expect(screen.getByText("Generate SSH Key")).toBeInTheDocument();
  });

  it("renders name input field", () => {
    renderGenerator();
    expect(screen.getByTestId("key-name-input")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("renders algorithm dropdown with Ed25519 and RSA-4096", () => {
    renderGenerator();
    const select = screen.getByTestId(
      "key-algorithm-select",
    ) as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toBe("Ed25519");
    expect(options[1].textContent).toBe("RSA-4096");
  });

  it("defaults to Ed25519 algorithm", () => {
    renderGenerator();
    const select = screen.getByTestId(
      "key-algorithm-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("ed25519");
  });

  it("renders passphrase field", () => {
    renderGenerator();
    expect(screen.getByTestId("key-passphrase-input")).toBeInTheDocument();
    expect(screen.getByLabelText("Passphrase (optional)")).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    renderGenerator();
    expect(screen.getByTestId("key-generator-submit")).toBeInTheDocument();
    expect(screen.getByTestId("key-generator-cancel")).toBeInTheDocument();
  });

  // ─── Validation ────────────────────────────────────────────

  it("disables submit when name is empty", () => {
    renderGenerator();
    const submit = screen.getByTestId(
      "key-generator-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit when name is entered", async () => {
    renderGenerator();
    const input = screen.getByTestId("key-name-input");
    await userEvent.type(input, "My Key");
    const submit = screen.getByTestId(
      "key-generator-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it("shows error when submitting empty name via form bypass", async () => {
    renderGenerator();
    // Directly call the form submission by finding the form
    const form = screen.getByTestId("key-generator").querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByTestId("key-generator-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Key name is required")).toBeInTheDocument();
  });

  // ─── Submission ────────────────────────────────────────────

  it("calls key_generate with Ed25519 on submit", async () => {
    mockInvoke.mockResolvedValueOnce({
      id: "new-key-id",
      name: "Test Key",
      algorithm: "ed25519",
      fingerprint: "SHA256:test",
      publicKey: "ssh-ed25519 AAAA",
      hasPassphrase: false,
      createdAt: "2024-01-01T00:00:00Z",
    });

    renderGenerator();
    await userEvent.type(screen.getByTestId("key-name-input"), "Test Key");
    fireEvent.click(screen.getByTestId("key-generator-submit"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("key_generate", {
        input: {
          name: "Test Key",
          algorithm: "ed25519",
        },
      });
    });
    expect(mockOnGenerated).toHaveBeenCalled();
  });

  it("calls key_generate with RSA-4096 when selected", async () => {
    mockInvoke.mockResolvedValueOnce({
      id: "rsa-key-id",
      name: "RSA Key",
      algorithm: "rsa-4096",
      fingerprint: "SHA256:rsa",
      publicKey: "rsa-sha2-256 BBBB",
      hasPassphrase: false,
      createdAt: "2024-01-01T00:00:00Z",
    });

    renderGenerator();
    await userEvent.type(screen.getByTestId("key-name-input"), "RSA Key");
    await userEvent.selectOptions(
      screen.getByTestId("key-algorithm-select"),
      "rsa-4096",
    );
    fireEvent.click(screen.getByTestId("key-generator-submit"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("key_generate", {
        input: {
          name: "RSA Key",
          algorithm: "rsa-4096",
        },
      });
    });
  });

  it("includes passphrase when provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      id: "pass-key-id",
      name: "Secured Key",
      algorithm: "ed25519",
      fingerprint: "SHA256:pass",
      publicKey: "ssh-ed25519 CCCC",
      hasPassphrase: true,
      createdAt: "2024-01-01T00:00:00Z",
    });

    renderGenerator();
    await userEvent.type(screen.getByTestId("key-name-input"), "Secured Key");
    await userEvent.type(
      screen.getByTestId("key-passphrase-input"),
      "my-secret",
    );
    fireEvent.click(screen.getByTestId("key-generator-submit"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("key_generate", {
        input: {
          name: "Secured Key",
          algorithm: "ed25519",
          passphrase: "my-secret",
        },
      });
    });
  });

  // ─── Error handling ────────────────────────────────────────

  it("shows error on generation failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Key generation failed"));

    renderGenerator();
    await userEvent.type(screen.getByTestId("key-name-input"), "Fail Key");
    fireEvent.click(screen.getByTestId("key-generator-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("key-generator-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Key generation failed")).toBeInTheDocument();
    expect(mockOnGenerated).not.toHaveBeenCalled();
  });

  // ─── Cancel ────────────────────────────────────────────────

  it("calls onCancel when cancel button is clicked", () => {
    renderGenerator();
    fireEvent.click(screen.getByTestId("key-generator-cancel"));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  // ─── Passphrase type ──────────────────────────────────────

  it("passphrase input is of type password", () => {
    renderGenerator();
    const input = screen.getByTestId(
      "key-passphrase-input",
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
  });
});
