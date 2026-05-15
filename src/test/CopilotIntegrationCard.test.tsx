/**
 * Tests for CopilotIntegrationCard.
 *
 * Covers:
 * - Loading state (status === null)
 * - copilot detected + not installed → Install button
 * - copilot detected + installed → Reinstall + Uninstall buttons
 * - gh NOT detected → docs link, no Install button
 * - Install click → invokes copilot_install_extension { overwrite: false }
 * - Reinstall click → invokes copilot_install_extension { overwrite: true }
 * - Error from invoke → renders in [role=alert] (path-sanitized)
 * - Dismiss click → returns null on next render via dismissed prop
 * - Dismissal persisted via settingsStore.copilotCardDismissed
 *
 * Tags: [TDD]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { CopilotIntegrationCard } from "../components/Settings/CopilotIntegrationCard";
import { useSettingsStore } from "../stores/settingsStore";

// ── Mock Tauri invoke ────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────

interface Status {
  copilotAvailable: boolean;
  extensionDir: string | null;
  installed: boolean;
}

function statusOf(overrides: Partial<Status> = {}): Status {
  return {
    copilotAvailable: true,
    extensionDir: "/Users/alice/.copilot/extensions",
    installed: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  cleanup();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("CopilotIntegrationCard", () => {
  it("renders a loading skeleton while status is unresolved", () => {
    // invoke returns a never-resolving promise → status stays null
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    expect(screen.getByText(/Detecting Copilot CLI/i)).toBeInTheDocument();
  });

  it("when copilot detected and not installed, shows Install button", async () => {
    mockInvoke.mockResolvedValue(statusOf({ installed: false }));
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Copilot CLI detected/i)).toBeInTheDocument(),
    );
    const btn = screen.getByRole("button", {
      name: /Install Putz integration/i,
    });
    expect(btn).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Reinstall/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Uninstall/i }),
    ).not.toBeInTheDocument();
  });

  it("when copilot detected and installed, shows Reinstall and Uninstall buttons", async () => {
    mockInvoke.mockResolvedValue(statusOf({ installed: true }));
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Installed")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Reinstall/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Uninstall/i }),
    ).toBeInTheDocument();
  });

  it("when gh NOT detected, shows docs link and no Install button", async () => {
    mockInvoke.mockResolvedValue(
      statusOf({ copilotAvailable: false, installed: false }),
    );
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Copilot CLI not detected/i)).toBeInTheDocument(),
    );
    const link = screen.getByRole("link", {
      name: /Installation instructions/i,
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("docs.github.com"),
    );
    expect(
      screen.queryByRole("button", { name: /Install Putz integration/i }),
    ).not.toBeInTheDocument();
  });

  it("Install click invokes copilot_install_extension with overwrite: false", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "copilot_get_status")
        return Promise.resolve(statusOf({ installed: false }));
      if (cmd === "copilot_install_extension")
        return Promise.resolve("/path/to/install");
      return Promise.resolve(undefined);
    });
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    const btn = await screen.findByRole("button", {
      name: /Install Putz integration/i,
    });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("copilot_install_extension", {
        overwrite: false,
      }),
    );
  });

  it("Reinstall click invokes copilot_install_extension with overwrite: true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "copilot_get_status")
        return Promise.resolve(statusOf({ installed: true }));
      if (cmd === "copilot_install_extension")
        return Promise.resolve("/path/to/install");
      return Promise.resolve(undefined);
    });
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    const btn = await screen.findByRole("button", { name: /Reinstall/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("copilot_install_extension", {
        overwrite: true,
      }),
    );
  });

  it("renders sanitized install error in role=alert", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "copilot_get_status")
        return Promise.resolve(statusOf({ installed: false }));
      if (cmd === "copilot_install_extension") {
        return Promise.reject(
          "install failed: copy /Users/alice/secret/x → /Users/alice/dst",
        );
      }
      return Promise.resolve(undefined);
    });
    render(<CopilotIntegrationCard dismissed={false} onDismiss={() => {}} />);
    const btn = await screen.findByRole("button", {
      name: /Install Putz integration/i,
    });
    fireEvent.click(btn);
    const alert = await screen.findByRole("alert");
    // Username path collapsed to ~
    expect(alert.textContent ?? "").toContain("~");
    expect(alert.textContent ?? "").not.toMatch(/\/Users\/alice/);
  });

  it("dismiss click invokes onDismiss callback", async () => {
    mockInvoke.mockResolvedValue(statusOf({ installed: false }));
    const onDismiss = vi.fn();
    render(<CopilotIntegrationCard dismissed={false} onDismiss={onDismiss} />);
    await screen.findByText(/Copilot CLI detected/i);
    fireEvent.click(screen.getByLabelText("Dismiss Copilot integration card"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("returns null when dismissed prop is true", () => {
    mockInvoke.mockResolvedValue(statusOf({ installed: false }));
    const { container } = render(
      <CopilotIntegrationCard dismissed={true} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("settingsStore.setCopilotCardDismissed flips the persisted flag", () => {
    // The store owns persistence; this asserts the action wired to the
    // card's onDismiss prop in SettingsTab actually flips state.
    const initial = useSettingsStore.getState().copilotCardDismissed;
    useSettingsStore.getState().setCopilotCardDismissed(!initial);
    expect(useSettingsStore.getState().copilotCardDismissed).toBe(!initial);
    // Restore for hygiene.
    useSettingsStore.getState().setCopilotCardDismissed(initial);
  });
});
