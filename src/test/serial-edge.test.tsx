/**
 * Edge case and boundary tests for SerialConfig component.
 *
 * Tests unusual inputs, boundary values, error states, and
 * race conditions that the Developer's unit tests don't cover.
 *
 * Tags: [EDGE], [BOUNDARY], [COVERAGE]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SerialConfig, DEFAULT_SERIAL_CONFIG } from "../components/Terminal/SerialConfig";
import type { SerialConfigValues } from "../components/Terminal/SerialConfig";
import type { SerialPortInfo } from "../components/Terminal/connectionTypes";

// Mock the Tauri invoke API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("SerialConfig Edge Cases", () => {
  const defaultOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  function renderConfig(
    overrides: Partial<SerialConfigValues> = {},
    onChange = defaultOnChange,
    errors?: { port?: string },
  ) {
    const values = { ...DEFAULT_SERIAL_CONFIG, ...overrides };
    return render(
      <SerialConfig values={values} onChange={onChange} errors={errors} />,
    );
  }

  // =====================================================================
  // [EDGE] Custom baud rate edge values
  // =====================================================================

  it("[EDGE] custom baud input with zero does not trigger onChange", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    // Switch to custom
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });

    // Enter zero — should NOT fire onChange (component checks val > 0)
    fireEvent.change(screen.getByTestId("serial-baud-input"), {
      target: { value: "0" },
    });

    // onChange should NOT have been called for baud=0
    const baudCalls = onChange.mock.calls.filter(
      (call) => call[0].baudRate === 0,
    );
    expect(baudCalls).toHaveLength(0);
  });

  it("[EDGE] custom baud input with negative does not trigger onChange", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByTestId("serial-baud-input"), {
      target: { value: "-1" },
    });

    const negativeBaudCalls = onChange.mock.calls.filter(
      (call) => call[0].baudRate < 0,
    );
    expect(negativeBaudCalls).toHaveLength(0);
  });

  it("[EDGE] custom baud input with NaN text does not trigger onChange", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByTestId("serial-baud-input"), {
      target: { value: "abc" },
    });

    // onChange should not have been called with NaN
    const nanCalls = onChange.mock.calls.filter(
      (call) => isNaN(call[0].baudRate),
    );
    expect(nanCalls).toHaveLength(0);
  });

  it("[EDGE] custom baud input with very large value is accepted", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByTestId("serial-baud-input"), {
      target: { value: "921600" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 921600 }),
    );
  });

  // =====================================================================
  // [EDGE] Port scan edge cases
  // =====================================================================

  it("[EDGE] port scan returns non-array value → treated as empty", async () => {
    // Backend returns null/undefined unexpectedly
    mockInvoke.mockResolvedValue(null);

    renderConfig();

    await waitFor(() => {
      expect(screen.getByText(/No serial ports found/)).toBeInTheDocument();
    });
  });

  it("[EDGE] port scan returns large list (50+ ports)", async () => {
    const manyPorts: SerialPortInfo[] = Array.from({ length: 50 }, (_, i) => ({
      name: `COM${i + 1}`,
      description: `Port ${i + 1}`,
      portType: "PCI",
    }));
    mockInvoke.mockResolvedValue(manyPorts);

    renderConfig();

    await waitFor(() => {
      const select = screen.getByTestId("serial-port-select");
      // Should have all 50 ports + the "Select port" placeholder
      const options = select.querySelectorAll("option");
      expect(options.length).toBe(51); // 50 ports + "— Select port —"
    });
  });

  it("[EDGE] port names with special characters render correctly", async () => {
    mockInvoke.mockResolvedValue([
      {
        name: "/dev/cu.usbserial-14220",
        description: "CP2102 USB to UART Bridge (长描述)",
        manufacturer: "Silicon Labs™",
        portType: "USB",
      },
    ]);

    renderConfig();

    await waitFor(() => {
      const select = screen.getByTestId("serial-port-select");
      expect(select).toHaveTextContent("/dev/cu.usbserial-14220");
      expect(select).toHaveTextContent("CP2102 USB to UART Bridge");
    });
  });

  it("[EDGE] scan error with non-Error thrown object", async () => {
    // Tauri might throw a string instead of Error
    mockInvoke.mockRejectedValue("RPC channel closed");

    renderConfig();

    await waitFor(() => {
      expect(screen.getByText(/Failed to scan ports/)).toBeInTheDocument();
    });
  });

  // =====================================================================
  // [BOUNDARY] Dropdown options completeness
  // =====================================================================

  it("[BOUNDARY] baud rate dropdown contains all 12 standard rates + Custom", () => {
    renderConfig();

    const select = screen.getByTestId("serial-baud-select");
    const options = select.querySelectorAll("option");
    const optionValues = Array.from(options).map((opt) => opt.getAttribute("value"));

    const expectedRates = [
      "300", "1200", "2400", "4800", "9600", "19200",
      "38400", "57600", "115200", "230400", "460800", "921600", "custom",
    ];

    for (const rate of expectedRates) {
      expect(optionValues).toContain(rate);
    }
  });

  it("[BOUNDARY] data bits dropdown contains all 4 variants", () => {
    renderConfig();

    const select = screen.getByTestId("serial-data-bits");
    const options = Array.from(select.querySelectorAll("option")).map(
      (opt) => opt.getAttribute("value"),
    );

    expect(options).toEqual(["five", "six", "seven", "eight"]);
  });

  it("[BOUNDARY] parity dropdown contains all 3 variants", () => {
    renderConfig();

    const select = screen.getByTestId("serial-parity");
    const options = Array.from(select.querySelectorAll("option")).map(
      (opt) => opt.getAttribute("value"),
    );

    expect(options).toEqual(["none", "even", "odd"]);
  });

  it("[BOUNDARY] stop bits dropdown contains all 2 variants", () => {
    renderConfig();

    const select = screen.getByTestId("serial-stop-bits");
    const options = Array.from(select.querySelectorAll("option")).map(
      (opt) => opt.getAttribute("value"),
    );

    expect(options).toEqual(["one", "two"]);
  });

  it("[BOUNDARY] flow control dropdown contains all 3 variants", () => {
    renderConfig();

    const select = screen.getByTestId("serial-flow-control");
    const options = Array.from(select.querySelectorAll("option")).map(
      (opt) => opt.getAttribute("value"),
    );

    expect(options).toEqual(["none", "hardware", "software"]);
  });

  // =====================================================================
  // [EDGE] Error display
  // =====================================================================

  it("[EDGE] no error span rendered when errors prop is undefined", () => {
    renderConfig();
    expect(screen.queryByTestId("serial-port-error")).not.toBeInTheDocument();
  });

  it("[EDGE] no error span rendered when errors has no port field", () => {
    renderConfig({}, defaultOnChange, {});
    expect(screen.queryByTestId("serial-port-error")).not.toBeInTheDocument();
  });

  it("[EDGE] error span rendered with correct message", () => {
    renderConfig({}, defaultOnChange, { port: "Port is required" });
    expect(screen.getByTestId("serial-port-error")).toHaveTextContent("Port is required");
  });

  // =====================================================================
  // [BOUNDARY] Default values match what backend expects
  // =====================================================================

  it("[BOUNDARY] default values use lowercase string enums matching Rust serde", () => {
    const config = DEFAULT_SERIAL_CONFIG;
    // These must match the Rust serde(rename_all = "lowercase") values
    expect(config.dataBits).toBe("eight");
    expect(config.parity).toBe("none");
    expect(config.stopBits).toBe("one");
    expect(config.flowControl).toBe("none");
  });

  // =====================================================================
  // [EDGE] Multiple rapid refreshes
  // =====================================================================

  it("[EDGE] rapid refresh clicks don't duplicate entries", async () => {
    const ports: SerialPortInfo[] = [
      { name: "COM3", description: "USB Serial", portType: "USB" },
    ];
    mockInvoke.mockResolvedValue(ports);

    renderConfig();

    // Wait for initial scan
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    // Click refresh 3 times rapidly
    const refreshBtn = screen.getByTestId("serial-refresh-btn");
    fireEvent.click(refreshBtn);
    fireEvent.click(refreshBtn);
    fireEvent.click(refreshBtn);

    // Wait for all scans to settle
    await waitFor(() => {
      const select = screen.getByTestId("serial-port-select");
      // Should only have one COM3 entry + placeholder
      const comOptions = Array.from(select.querySelectorAll("option")).filter(
        (opt) => opt.getAttribute("value") === "COM3",
      );
      expect(comOptions).toHaveLength(1);
    });
  });

  // =====================================================================
  // [COVERAGE] Labels and accessibility
  // =====================================================================

  it("[COVERAGE] all fields have associated labels", () => {
    renderConfig();

    // Check labels exist and are associated with form controls
    expect(screen.getByLabelText(/Serial Port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Baud Rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data Bits/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Parity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stop Bits/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Flow Control/i)).toBeInTheDocument();
  });

  it("[COVERAGE] port select has aria-invalid when error exists", () => {
    renderConfig({}, defaultOnChange, { port: "Required" });

    const select = screen.getByTestId("serial-port-select");
    expect(select).toHaveAttribute("aria-invalid", "true");
  });

  it("[COVERAGE] port select has aria-invalid=false when no error", () => {
    renderConfig();

    const select = screen.getByTestId("serial-port-select");
    expect(select).toHaveAttribute("aria-invalid", "false");
  });

  it("[COVERAGE] refresh button has title text for tooltip", () => {
    renderConfig();

    const btn = screen.getByTestId("serial-refresh-btn");
    expect(btn).toHaveAttribute("title", "Refresh port list");
  });
});
