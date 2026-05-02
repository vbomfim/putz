/**
 * KeyManager component tests.
 *
 * Tests the key list UI, context menu, delete confirmation,
 * and generator modal integration.
 *
 * Tags: [TDD], [COMPONENT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KeyManager } from "../components/Keys/KeyManager";

// Mock the IPC layer
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const MOCK_KEYS = [
  {
    id: "key-1",
    name: "Production Server",
    algorithm: "ed25519",
    fingerprint: "SHA256:abc123def456ghi789",
    publicKey: "ssh-ed25519 AAAA...",
    hasPassphrase: false,
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "key-2",
    name: "Staging Server",
    algorithm: "rsa-4096",
    fingerprint: "SHA256:xyz987wvu654",
    publicKey: "rsa-sha2-256 BBBB...",
    hasPassphrase: true,
    passphraseCredentialId: "vault-123",
    createdAt: "2024-06-15T10:30:00Z",
  },
];

describe("KeyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
  });

  // ─── Loading and empty states ──────────────────────────────

  it("shows loading state initially", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<KeyManager />);
    expect(screen.getByTestId("key-manager-loading")).toBeInTheDocument();
  });

  it("shows empty state when no keys exist", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-manager-empty")).toBeInTheDocument();
    });
    expect(screen.getByText("No SSH keys stored.")).toBeInTheDocument();
  });

  it("shows error banner on load failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Connection failed"));
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-manager-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
  });

  // ─── Key list rendering ────────────────────────────────────

  it("renders key list with name and algorithm", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Production Server")).toBeInTheDocument();
    expect(screen.getByText("Staging Server")).toBeInTheDocument();
    expect(screen.getByText("Ed25519")).toBeInTheDocument();
    expect(screen.getByText("RSA-4096")).toBeInTheDocument();
  });

  it("renders fingerprints for each key", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByText("SHA256:abc123def456ghi789")).toBeInTheDocument();
    });
  });

  // ─── Generate button ──────────────────────────────────────

  it("opens generator when + button is clicked", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-manager-generate")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("key-manager-generate"));
    expect(screen.getByTestId("key-generator")).toBeInTheDocument();
  });

  it("opens generator from empty state button", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByText("Generate Key")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Generate Key"));
    expect(screen.getByTestId("key-generator")).toBeInTheDocument();
  });

  // ─── Context menu ─────────────────────────────────────────

  it("shows context menu on right-click", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-item-key-1")).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId("key-item-key-1"));
    expect(screen.getByTestId("key-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("key-context-copy")).toBeInTheDocument();
    expect(screen.getByTestId("key-context-delete")).toBeInTheDocument();
  });

  it("copies public key to clipboard from context menu", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-item-key-1")).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId("key-item-key-1"));

    // Mock key_get_public response
    mockInvoke.mockResolvedValueOnce("ssh-ed25519 AAAA...");

    fireEvent.click(screen.getByTestId("key-context-copy"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("key_get_public", {
        id: "key-1",
      });
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "ssh-ed25519 AAAA...",
    );
  });

  // ─── Delete confirmation ───────────────────────────────────

  it("shows delete confirmation dialog from context menu", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-item-key-1")).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId("key-item-key-1"));
    fireEvent.click(screen.getByTestId("key-context-delete"));

    expect(screen.getByTestId("key-delete-confirm")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This will permanently delete the private key from disk.",
      ),
    ).toBeInTheDocument();
  });

  it("cancels delete on cancel button", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-item-key-1")).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId("key-item-key-1"));
    fireEvent.click(screen.getByTestId("key-context-delete"));
    fireEvent.click(screen.getByTestId("key-delete-cancel"));

    expect(screen.queryByTestId("key-delete-confirm")).not.toBeInTheDocument();
  });

  it("deletes key on confirm", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_KEYS);
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-item-key-1")).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId("key-item-key-1"));
    fireEvent.click(screen.getByTestId("key-context-delete"));

    // Mock delete then re-list
    mockInvoke.mockResolvedValueOnce(undefined); // key_delete
    mockInvoke.mockResolvedValueOnce([MOCK_KEYS[1]]); // key_list after delete

    fireEvent.click(screen.getByTestId("key-delete-confirm-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("key_delete", { id: "key-1" });
    });
  });

  // ─── Error handling ────────────────────────────────────────

  it("dismisses error banner on close button", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Test error"));
    render(<KeyManager />);
    await waitFor(() => {
      expect(screen.getByTestId("key-manager-error")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("✕"));
    expect(screen.queryByTestId("key-manager-error")).not.toBeInTheDocument();
  });
});
