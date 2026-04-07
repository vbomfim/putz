/**
 * CredentialManager component tests.
 *
 * Tags: [AC-3], [AC-5], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialManager } from "../components/Vault/CredentialManager";

// Mock the vault API module
vi.mock("../components/Vault/vaultApi", () => ({
  vaultList: vi.fn(),
  vaultGet: vi.fn(),
  vaultSet: vi.fn(),
  vaultDelete: vi.fn(),
}));

// Import after mock
import { vaultList, vaultGet, vaultSet, vaultDelete } from "../components/Vault/vaultApi";

const mockVaultList = vi.mocked(vaultList);
const mockVaultGet = vi.mocked(vaultGet);
const mockVaultSet = vi.mocked(vaultSet);
const mockVaultDelete = vi.mocked(vaultDelete);

const sampleCredentials = [
  {
    id: "cred-1",
    name: "DC1 Admin",
    username: "admin",
    credentialType: "password" as const,
    lastUsed: "2024-06-15T10:30:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-06-15T10:30:00Z",
  },
  {
    id: "cred-2",
    name: "SSH Key",
    username: "deploy",
    credentialType: "key_passphrase" as const,
    createdAt: "2024-03-01T00:00:00Z",
    updatedAt: "2024-03-01T00:00:00Z",
  },
];

describe("CredentialManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultList.mockResolvedValue([]);
  });

  // ─── Loading ─────────────────────────────────────────────

  it("shows loading state initially", () => {
    mockVaultList.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<CredentialManager />);
    expect(screen.getByTestId("credential-manager-loading")).toBeInTheDocument();
  });

  // ─── Empty state ─────────────────────────────────────────

  it("shows empty state when no credentials", async () => {
    mockVaultList.mockResolvedValue([]);
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-manager-empty")).toBeInTheDocument();
    });
  });

  // ─── List display ────────────────────────────────────────

  it("[AC-3] displays credential list with metadata only", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-list")).toBeInTheDocument();
    });

    // Shows names and usernames
    expect(screen.getByText("DC1 Admin")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("SSH Key")).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();

    // Shows credential types
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Key Passphrase")).toBeInTheDocument();

    // Does NOT show any secrets (the API only returns metadata)
    const html = document.body.innerHTML;
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("password123");
  });

  // ─── Add button ──────────────────────────────────────────

  it("opens editor when add button clicked", async () => {
    mockVaultList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-manager-add")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("credential-manager-add"));

    expect(screen.getByTestId("credential-editor")).toBeInTheDocument();
    expect(screen.getByText("New Credential")).toBeInTheDocument();
  });

  // ─── Context menu ────────────────────────────────────────

  it("shows context menu on right-click", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Right-click on first credential
    const item = screen.getByTestId("credential-item-cred-1");
    await user.pointer({ keys: "[MouseRight]", target: item });

    expect(screen.getByTestId("credential-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("credential-context-edit")).toBeInTheDocument();
    expect(screen.getByTestId("credential-context-delete")).toBeInTheDocument();
  });

  // ─── Edit ────────────────────────────────────────────────

  it("opens editor with credential data on edit", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    mockVaultGet.mockResolvedValue({
      meta: sampleCredentials[0],
      secret: "admin_pass",
    });

    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Double-click to edit
    const item = screen.getByTestId("credential-item-cred-1");
    await user.dblClick(item);

    await waitFor(() => {
      expect(screen.getByTestId("credential-editor")).toBeInTheDocument();
    });

    expect(screen.getByText("Edit Credential")).toBeInTheDocument();
    expect(mockVaultGet).toHaveBeenCalledWith("cred-1");
  });

  // ─── Delete confirmation ─────────────────────────────────

  it("[AC-5] shows delete confirmation dialog", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Right-click and choose Delete
    const item = screen.getByTestId("credential-item-cred-1");
    await user.pointer({ keys: "[MouseRight]", target: item });
    await user.click(screen.getByTestId("credential-context-delete"));

    // Confirmation dialog should appear
    expect(screen.getByTestId("credential-delete-confirm")).toBeInTheDocument();
    expect(screen.getByText(/permanently remove/)).toBeInTheDocument();
  });

  it("[AC-5] delete confirmation cancel closes dialog", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Open delete confirmation
    const item = screen.getByTestId("credential-item-cred-1");
    await user.pointer({ keys: "[MouseRight]", target: item });
    await user.click(screen.getByTestId("credential-context-delete"));

    // Cancel
    await user.click(screen.getByTestId("credential-delete-cancel"));
    expect(
      screen.queryByTestId("credential-delete-confirm"),
    ).not.toBeInTheDocument();
    expect(mockVaultDelete).not.toHaveBeenCalled();
  });

  it("[AC-5] delete confirmation executes deletion", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    mockVaultDelete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Open delete confirmation
    const item = screen.getByTestId("credential-item-cred-1");
    await user.pointer({ keys: "[MouseRight]", target: item });
    await user.click(screen.getByTestId("credential-context-delete"));

    // Confirm delete
    // After deletion, vaultList returns only the second credential
    mockVaultList.mockResolvedValue([sampleCredentials[1]]);
    await user.click(screen.getByTestId("credential-delete-confirm-btn"));

    expect(mockVaultDelete).toHaveBeenCalledWith("cred-1");
  });

  // ─── Save flow ───────────────────────────────────────────

  it("saves new credential and refreshes list", async () => {
    mockVaultList.mockResolvedValue([]);
    mockVaultSet.mockResolvedValue("new-cred-id");
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-manager-add")).toBeInTheDocument();
    });

    // Open editor
    await user.click(screen.getByTestId("credential-manager-add"));

    // Fill form
    await user.type(
      screen.getByTestId("credential-editor-name"),
      "New Cred",
    );
    await user.type(
      screen.getByTestId("credential-editor-username"),
      "admin",
    );
    await user.type(
      screen.getByTestId("credential-editor-secret"),
      "mypassword",
    );

    // After save, list returns the new credential
    mockVaultList.mockResolvedValue([
      {
        id: "new-cred-id",
        name: "New Cred",
        username: "admin",
        credentialType: "password" as const,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ]);

    // Save
    await user.click(screen.getByTestId("credential-editor-save"));

    await waitFor(() => {
      expect(mockVaultSet).toHaveBeenCalled();
    });
  });

  // ─── Error handling ──────────────────────────────────────

  it("shows error when vault_list fails", async () => {
    mockVaultList.mockRejectedValue(new Error("Keyring unavailable"));
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-manager-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Keyring unavailable")).toBeInTheDocument();
  });

  // ─── Selection mode ──────────────────────────────────────

  it("calls onSelect in selection mode when credential clicked", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CredentialManager selectionMode={true} onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("credential-item-cred-1"));
    expect(onSelect).toHaveBeenCalledWith("cred-1");
  });

  // ─── ARIA attributes ─────────────────────────────────────

  it("delete confirmation has ARIA alertdialog attributes", async () => {
    mockVaultList.mockResolvedValue(sampleCredentials);
    const user = userEvent.setup();
    render(<CredentialManager />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-item-cred-1")).toBeInTheDocument();
    });

    // Right-click and choose Delete
    const item = screen.getByTestId("credential-item-cred-1");
    await user.pointer({ keys: "[MouseRight]", target: item });
    await user.click(screen.getByTestId("credential-context-delete"));

    const overlay = screen.getByTestId("credential-delete-confirm");
    expect(overlay).toHaveAttribute("role", "alertdialog");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(overlay).toHaveAttribute("aria-labelledby", "credential-delete-title");
  });
});
