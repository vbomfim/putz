/**
 * Tests for the SerialConfig component.
 *
 * Verifies that the serial configuration form renders correctly,
 * handles port selection, baud rate changes, and custom baud input.
 *
 * Tags: [AC-1], [AC-3], [AC-6]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SerialConfig, DEFAULT_SERIAL_CONFIG } from "../components/Terminal/SerialConfig";
import type { SerialConfigValues } from "../components/Terminal/SerialConfig";

// Mock the Tauri invoke API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("SerialConfig", () => {
  const defaultOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: serial_list_ports returns empty list
    mockInvoke.mockResolvedValue([]);
  });

  function renderConfig(
    overrides: Partial<SerialConfigValues> = {},
    onChange = defaultOnChange,
  ) {
    const values = { ...DEFAULT_SERIAL_CONFIG, ...overrides };
    return render(
      <SerialConfig values={values} onChange={onChange} />,
    );
  }

  // =====================================================================
  // Rendering tests
  // =====================================================================

  it("renders all configuration fields", () => {
    renderConfig();
    expect(screen.getByTestId("serial-config")).toBeInTheDocument();
    expect(screen.getByTestId("serial-port-select")).toBeInTheDocument();
    expect(screen.getByTestId("serial-baud-select")).toBeInTheDocument();
    expect(screen.getByTestId("serial-data-bits")).toBeInTheDocument();
    expect(screen.getByTestId("serial-parity")).toBeInTheDocument();
    expect(screen.getByTestId("serial-stop-bits")).toBeInTheDocument();
    expect(screen.getByTestId("serial-flow-control")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    renderConfig();
    expect(screen.getByTestId("serial-refresh-btn")).toBeInTheDocument();
  });

  it("shows default baud rate of 9600", () => {
    renderConfig();
    const select = screen.getByTestId("serial-baud-select") as HTMLSelectElement;
    expect(select.value).toBe("9600");
  });

  it("shows default data bits of eight", () => {
    renderConfig();
    const select = screen.getByTestId("serial-data-bits") as HTMLSelectElement;
    expect(select.value).toBe("eight");
  });

  it("shows default parity of none", () => {
    renderConfig();
    const select = screen.getByTestId("serial-parity") as HTMLSelectElement;
    expect(select.value).toBe("none");
  });

  it("shows default stop bits of one", () => {
    renderConfig();
    const select = screen.getByTestId("serial-stop-bits") as HTMLSelectElement;
    expect(select.value).toBe("one");
  });

  it("shows default flow control of none", () => {
    renderConfig();
    const select = screen.getByTestId("serial-flow-control") as HTMLSelectElement;
    expect(select.value).toBe("none");
  });

  // =====================================================================
  // Port list tests [AC-1] [AC-6]
  // =====================================================================

  it("calls serial_list_ports on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    renderConfig();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("serial_list_ports");
    });
  });

  it("populates port dropdown with scanned ports", async () => {
    mockInvoke.mockResolvedValue([
      {
        name: "/dev/ttyUSB0",
        description: "FT232R",
        portType: "USB",
      },
      {
        name: "/dev/ttyACM0",
        description: "Arduino",
        portType: "USB",
      },
    ]);

    renderConfig();

    await waitFor(() => {
      const select = screen.getByTestId("serial-port-select");
      expect(select).toHaveTextContent("/dev/ttyUSB0");
      expect(select).toHaveTextContent("/dev/ttyACM0");
    });
  });

  it("shows hint when no ports found", async () => {
    mockInvoke.mockResolvedValue([]);
    renderConfig();
    await waitFor(() => {
      expect(screen.getByText(/No serial ports found/)).toBeInTheDocument();
    });
  });

  it("refresh button triggers re-scan", async () => {
    mockInvoke.mockResolvedValue([]);
    renderConfig();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId("serial-refresh-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  // =====================================================================
  // Value change tests [AC-3]
  // =====================================================================

  it("calls onChange when baud rate changes", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "115200" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 115200 }),
    );
  });

  it("calls onChange when data bits change", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);
    fireEvent.change(screen.getByTestId("serial-data-bits"), {
      target: { value: "seven" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dataBits: "seven" }),
    );
  });

  it("calls onChange when parity changes", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);
    fireEvent.change(screen.getByTestId("serial-parity"), {
      target: { value: "even" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ parity: "even" }),
    );
  });

  it("calls onChange when stop bits change", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);
    fireEvent.change(screen.getByTestId("serial-stop-bits"), {
      target: { value: "two" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ stopBits: "two" }),
    );
  });

  it("calls onChange when flow control changes", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);
    fireEvent.change(screen.getByTestId("serial-flow-control"), {
      target: { value: "hardware" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ flowControl: "hardware" }),
    );
  });

  // =====================================================================
  // Custom baud rate tests
  // =====================================================================

  it("switches to custom baud input when 'Custom' selected", () => {
    renderConfig();
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });
    expect(screen.getByTestId("serial-baud-input")).toBeInTheDocument();
  });

  it("switches back to standard from custom", () => {
    renderConfig();
    // Switch to custom
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });
    expect(screen.getByTestId("serial-baud-input")).toBeInTheDocument();

    // Switch back to standard
    fireEvent.click(screen.getByTestId("serial-baud-standard-btn"));
    expect(screen.getByTestId("serial-baud-select")).toBeInTheDocument();
  });

  // =====================================================================
  // Error display tests
  // =====================================================================

  it("shows port error when provided", () => {
    render(
      <SerialConfig
        values={DEFAULT_SERIAL_CONFIG}
        onChange={defaultOnChange}
        errors={{ port: "Serial port is required" }}
      />,
    );
    expect(screen.getByTestId("serial-port-error")).toHaveTextContent(
      "Serial port is required",
    );
  });

  // =====================================================================
  // DEFAULT_SERIAL_CONFIG tests
  // =====================================================================

  it("DEFAULT_SERIAL_CONFIG has expected values", () => {
    expect(DEFAULT_SERIAL_CONFIG).toEqual({
      port: "",
      baudRate: 9600,
      dataBits: "eight",
      parity: "none",
      stopBits: "one",
      flowControl: "none",
    });
  });
});
