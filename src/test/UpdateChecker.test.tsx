/**
 * Unit tests for the UpdateChecker component.
 *
 * TDD: These tests were written BEFORE the implementation.
 * They verify the auto-update notification UI and user interactions.
 *
 * Tags: [TDD], [AC-AUTOUPDATE]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks ---

/** Mock update object returned by check() when an update is available. */
const mockUpdate = {
  version: "1.2.0",
  body: "Bug fixes and performance improvements",
  date: "2024-06-01T00:00:00Z",
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
};

/** Mock check function from @tauri-apps/plugin-updater. */
const mockCheck = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

/** Mock relaunch from @tauri-apps/plugin-process. */
const mockRelaunch = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));

// Import component after mocks are set up
import { UpdateChecker } from "../components/UpdateChecker";

describe("UpdateChecker", () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    mockUpdate.downloadAndInstall.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders nothing when no update is available", async () => {
    mockCheck.mockResolvedValue(null);

    const { container } = render(<UpdateChecker />);

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    expect(
      container.querySelector("[data-testid='update-notification']"),
    ).toBeNull();
  });

  it("shows notification when an update is available", async () => {
    mockCheck.mockResolvedValue(mockUpdate);

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("downloads and installs when 'Update Now' is clicked", async () => {
    mockCheck.mockResolvedValue(mockUpdate);
    const user = userEvent.setup();

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /update now/i }));

    await waitFor(() => {
      expect(mockUpdate.downloadAndInstall).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockRelaunch).toHaveBeenCalledTimes(1);
    });
  });

  it("shows downloading state during update", async () => {
    // Make downloadAndInstall hang to observe the downloading state
    let resolveDownload: () => void;
    const downloadPromise = new Promise<void>((resolve) => {
      resolveDownload = resolve;
    });
    mockUpdate.downloadAndInstall.mockReturnValue(downloadPromise);
    mockCheck.mockResolvedValue(mockUpdate);
    const user = userEvent.setup();

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /update now/i }));

    await waitFor(() => {
      expect(screen.getByText(/downloading/i)).toBeInTheDocument();
    });

    // Resolve the download
    await act(async () => {
      resolveDownload!();
    });
  });

  it("dismisses notification when 'Later' is clicked", async () => {
    mockCheck.mockResolvedValue(mockUpdate);
    const user = userEvent.setup();

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /later/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("update-notification")).toBeNull();
    });

    // Later should NOT store anything in localStorage
    expect(localStorage.getItem("putz-skipped-version")).toBeNull();
  });

  it("stores skipped version when 'Skip' is clicked", async () => {
    mockCheck.mockResolvedValue(mockUpdate);
    const user = userEvent.setup();

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /skip/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("update-notification")).toBeNull();
    });

    expect(localStorage.getItem("putz-skipped-version")).toBe("1.2.0");
  });

  it("does not show notification for a previously skipped version", async () => {
    localStorage.setItem("putz-skipped-version", "1.2.0");
    mockCheck.mockResolvedValue(mockUpdate);

    const { container } = render(<UpdateChecker />);

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    // Small delay to ensure state settles
    await new Promise((r) => setTimeout(r, 50));

    expect(
      container.querySelector("[data-testid='update-notification']"),
    ).toBeNull();
  });

  it("shows notification for a newer version even if older was skipped", async () => {
    localStorage.setItem("putz-skipped-version", "1.1.0");
    mockCheck.mockResolvedValue(mockUpdate); // 1.2.0

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });
  });

  it("handles check() errors gracefully without crashing", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { container } = render(<UpdateChecker />);

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    // Should render nothing — no error UI, no crash
    expect(
      container.querySelector("[data-testid='update-notification']"),
    ).toBeNull();
  });

  it("handles downloadAndInstall errors gracefully", async () => {
    mockUpdate.downloadAndInstall.mockRejectedValue(
      new Error("Download failed"),
    );
    mockCheck.mockResolvedValue(mockUpdate);
    const user = userEvent.setup();

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /update now/i }));

    // Should show error state, not crash
    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    });

    // Relaunch should NOT be called on failure
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("has accessible role and label on the notification", async () => {
    mockCheck.mockResolvedValue(mockUpdate);

    render(<UpdateChecker />);

    await waitFor(() => {
      const notification = screen.getByTestId("update-notification");
      expect(notification).toHaveAttribute("role", "alert");
    });
  });
});
