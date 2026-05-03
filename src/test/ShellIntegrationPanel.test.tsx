/**
 * Tests for ShellIntegrationPanel component.
 *
 * Covers:
 * - AC7: Detection — panel shows detected shells with status
 * - AC1–AC4: Install buttons invoke IPC for each shell
 * - AC5: Idempotent — "Already installed" state shown
 * - AC6: Uninstall — removes integration
 * - Show snippet — displays snippet content
 * - Bulk install — "Install for all detected" button
 * - cmd.exe warning — special warning for registry-based install
 *
 * Tags: [TDD], [AC-7], [S3]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ShellIntegrationPanel } from "../components/Settings/ShellIntegrationPanel";

// ── Mock Tauri invoke ────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Test data ────────────────────────────────────────────────────────

const mockShells = [
  {
    id: "zsh",
    name: "Zsh",
    binary_path: "/bin/zsh",
    version: "zsh 5.9",
    dotfile_path: "/Users/test/.zshrc",
    dotfile_exists: true,
    status: "Installed" as const,
  },
  {
    id: "bash",
    name: "Bash",
    binary_path: "/bin/bash",
    version: "GNU bash, version 3.2.57",
    dotfile_path: "/Users/test/.bashrc",
    dotfile_exists: true,
    status: "NotInstalled" as const,
  },
  {
    id: "fish",
    name: "Fish",
    binary_path: "/usr/local/bin/fish",
    version: "fish, version 3.7.0",
    dotfile_path: "/Users/test/.config/fish/config.fish",
    dotfile_exists: false,
    status: "NotInstalled" as const,
  },
];

const mockShellsWithCmd = [
  ...mockShells,
  {
    id: "cmd",
    name: "Command Prompt",
    binary_path: "cmd.exe",
    version: "N/A",
    dotfile_path: "HKCU\\Software\\Microsoft\\Command Processor\\AutoRun",
    dotfile_exists: true,
    status: "NotInstalled" as const,
  },
];

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "shell_integration_detect") {
        return Promise.resolve(mockShells);
      }
      if (cmd === "shell_integration_install") {
        return Promise.resolve({
          success: true,
          dotfile_path: `/Users/test/.${args?.shellId}rc`,
          backup_path: null,
          message: `Shell integration installed for ${args?.shellId}`,
        });
      }
      if (cmd === "shell_integration_uninstall") {
        return Promise.resolve({
          success: true,
          dotfile_path: `/Users/test/.${args?.shellId}rc`,
          backup_path: null,
          message: `Shell integration uninstalled for ${args?.shellId}`,
        });
      }
      if (cmd === "shell_integration_show_snippet") {
        return Promise.resolve(
          `# snippet for ${args?.shellId}\nprintf '\\e]7;...'`,
        );
      }
      return Promise.resolve(undefined);
    },
  );
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ShellIntegrationPanel", () => {
  describe("Detection (AC7)", () => {
    it("renders detected shells as cards", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("shell-card-zsh")).toBeTruthy();
        expect(screen.getByTestId("shell-card-bash")).toBeTruthy();
        expect(screen.getByTestId("shell-card-fish")).toBeTruthy();
      });
    });

    it("shows shell names and binary paths", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByText(/Zsh/)).toBeTruthy();
        expect(screen.getByText(/\/bin\/zsh/)).toBeTruthy();
        expect(screen.getByText(/Bash/)).toBeTruthy();
        expect(screen.getByText(/\/bin\/bash/)).toBeTruthy();
      });
    });

    it("shows install status badges", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByText(/Installed/)).toBeTruthy();
        expect(
          screen.getAllByText(/Not installed/).length,
        ).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows 'will be created' for missing dotfiles", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByText(/will be created/)).toBeTruthy();
      });
    });

    it("shows loading state initially", () => {
      mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
      render(<ShellIntegrationPanel />);
      expect(screen.getByText(/Detecting shells/)).toBeTruthy();
    });

    it("shows error state on detection failure", async () => {
      mockInvoke.mockRejectedValueOnce("Detection failed");
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByText(/Failed to detect shells/)).toBeTruthy();
      });
    });

    it("shows empty state when no shells detected", async () => {
      mockInvoke.mockResolvedValueOnce([]);
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByText(/No tier-1 shells detected/)).toBeTruthy();
      });
    });
  });

  describe("Install (AC1–AC4)", () => {
    it("shows Install button for not-installed shells", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("install-btn-bash")).toBeTruthy();
      });
    });

    it("does not show Install button for already-installed shells", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.queryByTestId("install-btn-zsh")).toBeNull();
      });
    });

    it("calls shell_integration_install IPC on click", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-bash"));
      fireEvent.click(screen.getByTestId("install-btn-bash"));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("shell_integration_install", {
          shellId: "bash",
        });
      });
    });

    it("shows success message after install", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-bash"));
      fireEvent.click(screen.getByTestId("install-btn-bash"));
      await waitFor(() => {
        expect(screen.getByTestId("message-bash")).toBeTruthy();
        expect(
          screen.getByText(/Shell integration installed for bash/),
        ).toBeTruthy();
      });
    });

    it("refreshes detection after install", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-bash"));
      fireEvent.click(screen.getByTestId("install-btn-bash"));
      await waitFor(() => {
        // detect is called once on mount, then again after install
        const detectCalls = mockInvoke.mock.calls.filter(
          (c) => c[0] === "shell_integration_detect",
        );
        expect(detectCalls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe("Uninstall (AC6)", () => {
    it("shows Uninstall button for installed shells", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("uninstall-btn-zsh")).toBeTruthy();
      });
    });

    it("calls shell_integration_uninstall IPC on click", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("uninstall-btn-zsh"));
      fireEvent.click(screen.getByTestId("uninstall-btn-zsh"));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("shell_integration_uninstall", {
          shellId: "zsh",
        });
      });
    });
  });

  describe("Show Snippet", () => {
    it("shows snippet content when button clicked", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("snippet-btn-bash"));
      fireEvent.click(screen.getByTestId("snippet-btn-bash"));
      await waitFor(() => {
        expect(screen.getByTestId("snippet-content-bash")).toBeTruthy();
        expect(screen.getByText(/snippet for bash/)).toBeTruthy();
      });
    });

    it("hides snippet when clicked again", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("snippet-btn-bash"));
      // Show
      fireEvent.click(screen.getByTestId("snippet-btn-bash"));
      await waitFor(() => screen.getByTestId("snippet-content-bash"));
      // Hide
      fireEvent.click(screen.getByTestId("snippet-btn-bash"));
      await waitFor(() => {
        expect(screen.queryByTestId("snippet-content-bash")).toBeNull();
      });
    });
  });

  describe("Bulk Install", () => {
    it("shows 'Install for all detected' button with count", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("install-all-btn")).toBeTruthy();
        expect(screen.getByText(/Install for all detected \(2\)/)).toBeTruthy();
      });
    });

    it("installs for all not-installed shells on click", async () => {
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-all-btn"));
      fireEvent.click(screen.getByTestId("install-all-btn"));
      await waitFor(() => {
        const installCalls = mockInvoke.mock.calls.filter(
          (c) => c[0] === "shell_integration_install",
        );
        expect(installCalls.length).toBe(2); // bash + fish
      });
    });
  });

  describe("cmd.exe safeguards", () => {
    it("shows warning for cmd.exe card", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "shell_integration_detect") {
          return Promise.resolve(mockShellsWithCmd);
        }
        return Promise.resolve(undefined);
      });
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("cmd-warning")).toBeTruthy();
        expect(screen.getByText(/Windows Registry AutoRun/)).toBeTruthy();
      });
    });

    it("shows Install with confirmation button for cmd.exe", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "shell_integration_detect") {
          return Promise.resolve(mockShellsWithCmd);
        }
        return Promise.resolve(undefined);
      });
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("shell-card-cmd"));
      expect(screen.getByTestId("install-btn-cmd")).toBeTruthy();
      expect(screen.getByText(/with confirmation/)).toBeTruthy();
    });

    it("excludes cmd from bulk install count", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "shell_integration_detect") {
          return Promise.resolve(mockShellsWithCmd);
        }
        return Promise.resolve(undefined);
      });
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        // Should be 2 (bash + fish), NOT 3 (excluding cmd)
        expect(screen.getByText(/Install for all detected \(2\)/)).toBeTruthy();
      });
    });
  });

  describe("Custom modification", () => {
    it("shows Reinstall button for custom modification status", async () => {
      const customShells = [
        {
          ...mockShells[0],
          status: "CustomModification" as const,
        },
      ];
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "shell_integration_detect")
          return Promise.resolve(customShells);
        return Promise.resolve(undefined);
      });
      render(<ShellIntegrationPanel />);
      await waitFor(() => {
        expect(screen.getByTestId("reinstall-btn-zsh")).toBeTruthy();
        expect(screen.getByText(/Custom modification/)).toBeTruthy();
      });
    });
  });

  describe("cmd.exe confirmation dialog", () => {
    const cmdMockInvoke = (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "shell_integration_detect") {
        return Promise.resolve(mockShellsWithCmd);
      }
      if (cmd === "shell_integration_cmd_preview") {
        return Promise.resolve({
          has_existing_entries: true,
          has_existing_putz_segment: false,
          proposed_autorun:
            'chcp 65001 & "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat"',
          snippet_path: "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat",
          explanation:
            "The AutoRun registry value already contains entries from other applications.",
        });
      }
      if (cmd === "shell_integration_cmd_show_existing") {
        return Promise.resolve("chcp 65001");
      }
      if (cmd === "shell_integration_cmd_install_confirmed") {
        return Promise.resolve({
          previous: "chcp 65001",
          new: 'chcp 65001 & "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat"',
          action: "installed",
          snippet_path: "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat",
        });
      }
      if (cmd === "shell_integration_cmd_uninstall") {
        return Promise.resolve({
          previous:
            'chcp 65001 & "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat"',
          new: "chcp 65001",
          action: "uninstalled",
          snippet_path: "C:\\Users\\test\\AppData\\Local\\putz\\cmd-init.bat",
        });
      }
      if (cmd === "shell_integration_show_snippet") {
        return Promise.resolve(`# snippet for ${args?.shellId}`);
      }
      return Promise.resolve(undefined);
    };

    it("opens confirmation dialog when cmd Install clicked", async () => {
      mockInvoke.mockImplementation(cmdMockInvoke);
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => {
        expect(screen.getByTestId("cmd-confirm-dialog")).toBeTruthy();
      });
    });

    it("dialog shows existing and proposed values", async () => {
      mockInvoke.mockImplementation(cmdMockInvoke);
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => {
        // Proposed is open by default
        expect(screen.getByTestId("cmd-proposed-value")).toBeTruthy();
      });
      // Expand existing value
      fireEvent.click(screen.getByTestId("cmd-existing-toggle"));
      await waitFor(() => {
        expect(screen.getByTestId("cmd-existing-value")).toBeTruthy();
      });
    });

    it("dialog shows explanation text", async () => {
      mockInvoke.mockImplementation(cmdMockInvoke);
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => {
        expect(screen.getByTestId("cmd-dialog-explanation")).toBeTruthy();
        expect(screen.getByText(/already contains entries/)).toBeTruthy();
      });
    });

    it("Cancel closes dialog without calling install IPC", async () => {
      mockInvoke.mockImplementation(cmdMockInvoke);
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => screen.getByTestId("cmd-cancel-btn"));
      fireEvent.click(screen.getByTestId("cmd-cancel-btn"));
      await waitFor(() => {
        expect(screen.queryByTestId("cmd-confirm-dialog")).toBeNull();
      });
      // Confirm IPC was NOT called.
      const installCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "shell_integration_cmd_install_confirmed",
      );
      expect(installCalls.length).toBe(0);
    });

    it("Install button calls confirmed IPC and closes dialog", async () => {
      mockInvoke.mockImplementation(cmdMockInvoke);
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => screen.getByTestId("cmd-confirm-btn"));
      fireEvent.click(screen.getByTestId("cmd-confirm-btn"));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "shell_integration_cmd_install_confirmed",
        );
      });
      // Dialog should close.
      await waitFor(() => {
        expect(screen.queryByTestId("cmd-confirm-dialog")).toBeNull();
      });
    });

    it("shows error in dialog on preview failure", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "shell_integration_detect") {
          return Promise.resolve(mockShellsWithCmd);
        }
        if (cmd === "shell_integration_cmd_preview") {
          return Promise.reject("cmd.exe is only supported on Windows");
        }
        return Promise.resolve(undefined);
      });
      render(<ShellIntegrationPanel />);
      await waitFor(() => screen.getByTestId("install-btn-cmd"));
      fireEvent.click(screen.getByTestId("install-btn-cmd"));
      await waitFor(() => {
        expect(screen.getByTestId("cmd-dialog-error")).toBeTruthy();
        expect(screen.getByText(/only supported on Windows/)).toBeTruthy();
      });
    });
  });
});
