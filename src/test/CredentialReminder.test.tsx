/**
 * CredentialReminder component tests.
 *
 * Tests the notification bar that displays credentials nearing expiration.
 *
 * Tags: [AC-3], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CredentialReminder } from "../components/Vault/CredentialReminder";

// Mock the vault API module
vi.mock("../components/Vault/vaultApi", () => ({
  vaultList: vi.fn(),
  vaultGet: vi.fn(),
  vaultSet: vi.fn(),
  vaultDelete: vi.fn(),
  vaultCheckExpiring: vi.fn(),
}));

import { vaultCheckExpiring } from "../components/Vault/vaultApi";
const mockVaultCheckExpiring = vi.mocked(vaultCheckExpiring);

const sampleExpiring = [
  {
    id: "cred-1",
    name: "DC1 Admin",
    username: "admin",
    credentialType: "password" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    rotationDays: 90,
  },
  {
    id: "cred-2",
    name: "SSH Key Pass",
    username: "deploy",
    credentialType: "key_passphrase" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    rotationDays: 30,
  },
];

describe("CredentialReminder", () => {
  beforeEach(() => {
    mockVaultCheckExpiring.mockReset();
  });

  it("renders nothing when no credentials are expiring", async () => {
    mockVaultCheckExpiring.mockResolvedValue([]);
    const { container } = render(<CredentialReminder />);

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("renders nothing when backend errors out", async () => {
    mockVaultCheckExpiring.mockRejectedValue(new Error("IPC error"));
    const { container } = render(<CredentialReminder />);

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("shows notification with count when credentials expiring", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByText(/2 credentials expire/)).toBeInTheDocument();
    });
  });

  it("shows singular form for 1 credential", async () => {
    mockVaultCheckExpiring.mockResolvedValue([sampleExpiring[0]]);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByText(/1 credential expires/)).toBeInTheDocument();
    });
  });

  it("shows correct days ahead in message", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder daysAhead={14} />);

    await waitFor(() => {
      expect(screen.getByText(/within 14 days/)).toBeInTheDocument();
    });
  });

  it("dismisses when X button is clicked", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-reminder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("credential-reminder-dismiss"));

    expect(screen.queryByTestId("credential-reminder")).not.toBeInTheDocument();
  });

  it("expands to show credential list on Show click", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-reminder-toggle")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("credential-reminder-toggle"));

    expect(screen.getByTestId("credential-reminder-list")).toBeInTheDocument();
    expect(screen.getByText("DC1 Admin")).toBeInTheDocument();
    expect(screen.getByText("SSH Key Pass")).toBeInTheDocument();
  });

  it("collapses the list on second Show/Hide click", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-reminder-toggle")).toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByTestId("credential-reminder-toggle"));
    expect(screen.getByTestId("credential-reminder-list")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByTestId("credential-reminder-toggle"));
    expect(screen.queryByTestId("credential-reminder-list")).not.toBeInTheDocument();
  });

  it("calls onUpdateCredential when Update Now is clicked", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    const onUpdate = vi.fn();
    render(
      <CredentialReminder onUpdateCredential={onUpdate} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("credential-reminder-toggle")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("credential-reminder-toggle"));
    fireEvent.click(screen.getByTestId("credential-reminder-update-cred-1"));

    expect(onUpdate).toHaveBeenCalledWith("cred-1");
  });

  it("does not show Update Now buttons when no callback provided", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      expect(screen.getByTestId("credential-reminder-toggle")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("credential-reminder-toggle"));

    expect(
      screen.queryByTestId("credential-reminder-update-cred-1")
    ).not.toBeInTheDocument();
  });

  it("passes daysAhead to vaultCheckExpiring", async () => {
    mockVaultCheckExpiring.mockResolvedValue([]);
    render(<CredentialReminder daysAhead={30} />);

    await waitFor(() => {
      expect(mockVaultCheckExpiring).toHaveBeenCalledWith(30);
    });
  });

  it("has alert role for accessibility", async () => {
    mockVaultCheckExpiring.mockResolvedValue(sampleExpiring);
    render(<CredentialReminder />);

    await waitFor(() => {
      const reminder = screen.getByTestId("credential-reminder");
      expect(reminder).toHaveAttribute("role", "alert");
    });
  });
});
