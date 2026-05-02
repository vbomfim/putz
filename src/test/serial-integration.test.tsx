/**
 * Integration tests for SerialConfig component.
 *
 * Tests the full interaction flow between SerialConfig and its
 * IPC layer — port scanning, auto-selection, user configuration
 * changes, and refresh lifecycle.
 *
 * Tags: [AC-1], [AC-3], [AC-6], [INTEGRATION]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  SerialConfig,
  DEFAULT_SERIAL_CONFIG,
} from "../components/Terminal/SerialConfig";
import type { SerialPortInfo } from "../components/Terminal/connectionTypes";

// Mock the Tauri invoke API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("SerialConfig Integration", () => {
  const trackingOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  function renderConfig(
    overrides: Partial<SerialConfigValues> = {},
    onChange = trackingOnChange,
  ) {
    const values = { ...DEFAULT_SERIAL_CONFIG, ...overrides };
    return render(<SerialConfig values={values} onChange={onChange} />);
  }

  // =====================================================================
  // [AC-1] Port scan → auto-select first port
  // =====================================================================

  it("[AC-1] [INTEGRATION] auto-selects first port when current selection is empty", async () => {
    const ports: SerialPortInfo[] = [
      { name: "/dev/ttyUSB0", description: "FT232R", portType: "USB" },
      { name: "/dev/ttyUSB1", description: "CP2102", portType: "USB" },
    ];
    mockInvoke.mockResolvedValue(ports);

    renderConfig({ port: "" });

    await waitFor(() => {
      expect(trackingOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ port: "/dev/ttyUSB0" }),
      );
    });
  });

  it("[AC-1] [INTEGRATION] does not auto-select if port already set", async () => {
    const ports: SerialPortInfo[] = [
      { name: "/dev/ttyUSB0", description: "FT232R", portType: "USB" },
    ];
    mockInvoke.mockResolvedValue(ports);

    renderConfig({ port: "/dev/ttyUSB1" });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("serial_list_ports");
    });

    // Should NOT auto-select first port since port is already set
    expect(trackingOnChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ port: "/dev/ttyUSB0" }),
    );
  });

  it("[AC-1] [INTEGRATION] port dropdown shows port name and description", async () => {
    mockInvoke.mockResolvedValue([
      {
        name: "COM3",
        description: "Prolific USB-to-Serial",
        manufacturer: "Prolific",
        portType: "USB",
      },
    ]);

    renderConfig();

    await waitFor(() => {
      const select = screen.getByTestId("serial-port-select");
      expect(select).toHaveTextContent("COM3");
      expect(select).toHaveTextContent("Prolific USB-to-Serial");
    });
  });

  // =====================================================================
  // [AC-3] Full parameter configuration flow
  // =====================================================================

  it("[AC-3] [INTEGRATION] configuring all serial parameters produces correct output", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    // Change baud rate to 115200
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "115200" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 115200 }),
    );

    // Change data bits to 7
    fireEvent.change(screen.getByTestId("serial-data-bits"), {
      target: { value: "seven" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dataBits: "seven" }),
    );

    // Change parity to even
    fireEvent.change(screen.getByTestId("serial-parity"), {
      target: { value: "even" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ parity: "even" }),
    );

    // Change stop bits to 2
    fireEvent.change(screen.getByTestId("serial-stop-bits"), {
      target: { value: "two" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ stopBits: "two" }),
    );

    // Change flow control to hardware
    fireEvent.change(screen.getByTestId("serial-flow-control"), {
      target: { value: "hardware" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ flowControl: "hardware" }),
    );
  });

  it("[AC-3] [INTEGRATION] port selection triggers onChange with selected port", async () => {
    mockInvoke.mockResolvedValue([
      { name: "/dev/ttyUSB0", description: "FT232R", portType: "USB" },
      { name: "/dev/ttyACM0", description: "Arduino", portType: "USB" },
    ]);

    const onChange = vi.fn();
    renderConfig({ port: "/dev/ttyUSB0" }, onChange);

    await waitFor(() => {
      expect(screen.getByTestId("serial-port-select")).toHaveTextContent(
        "/dev/ttyACM0",
      );
    });

    // Select the second port
    fireEvent.change(screen.getByTestId("serial-port-select"), {
      target: { value: "/dev/ttyACM0" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ port: "/dev/ttyACM0" }),
    );
  });

  // =====================================================================
  // [AC-6] Refresh lifecycle
  // =====================================================================

  it("[AC-6] [INTEGRATION] refresh re-scans and updates port list", async () => {
    // First scan: empty
    mockInvoke.mockResolvedValueOnce([]);

    renderConfig();

    await waitFor(() => {
      expect(screen.getByText(/No serial ports found/)).toBeInTheDocument();
    });

    // Now a port appears (USB adapter plugged in)
    mockInvoke.mockResolvedValueOnce([
      { name: "/dev/ttyUSB0", description: "FT232R", portType: "USB" },
    ]);

    fireEvent.click(screen.getByTestId("serial-refresh-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("serial-port-select")).toHaveTextContent(
        "/dev/ttyUSB0",
      );
    });
  });

  it("[AC-6] [INTEGRATION] refresh button disabled during scan", async () => {
    // Make the scan take longer using a never-resolving promise initially
    let resolvePortScan!: (value: SerialPortInfo[]) => void;
    mockInvoke.mockReturnValueOnce(
      new Promise<SerialPortInfo[]>((resolve) => {
        resolvePortScan = resolve;
      }),
    );

    renderConfig();

    // Button should be disabled while scanning
    const refreshBtn = screen.getByTestId("serial-refresh-btn");
    expect(refreshBtn).toBeDisabled();

    // Resolve the scan
    await act(async () => {
      resolvePortScan([]);
    });

    // Button should be enabled again
    await waitFor(() => {
      expect(refreshBtn).not.toBeDisabled();
    });
  });

  // =====================================================================
  // [INTEGRATION] Error recovery
  // =====================================================================

  it("[INTEGRATION] port scan failure shows error, refresh recovers", async () => {
    // First scan fails
    mockInvoke.mockRejectedValueOnce(new Error("Permission denied"));

    renderConfig();

    await waitFor(() => {
      expect(screen.getByText(/Failed to scan ports/)).toBeInTheDocument();
    });

    // Retry succeeds
    mockInvoke.mockResolvedValueOnce([
      { name: "COM3", description: "USB Serial", portType: "USB" },
    ]);

    fireEvent.click(screen.getByTestId("serial-refresh-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("serial-port-select")).toHaveTextContent(
        "COM3",
      );
      // Error should be cleared
      expect(
        screen.queryByText(/Failed to scan ports/),
      ).not.toBeInTheDocument();
    });
  });

  // =====================================================================
  // [INTEGRATION] Custom baud rate lifecycle
  // =====================================================================

  it("[INTEGRATION] custom baud → entry → switch back to standard resets to 9600", () => {
    const onChange = vi.fn();
    renderConfig({}, onChange);

    // Switch to custom
    fireEvent.change(screen.getByTestId("serial-baud-select"), {
      target: { value: "custom" },
    });

    expect(screen.getByTestId("serial-baud-input")).toBeInTheDocument();

    // Enter a custom value
    fireEvent.change(screen.getByTestId("serial-baud-input"), {
      target: { value: "31250" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 31250 }),
    );

    // Switch back to standard
    fireEvent.click(screen.getByTestId("serial-baud-standard-btn"));

    // Should reset to 9600
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 9600 }),
    );
  });

  it("[INTEGRATION] non-standard baud value starts in custom mode", () => {
    renderConfig({ baudRate: 31250 });

    // Should render custom input since 31250 is not a standard rate
    expect(screen.getByTestId("serial-baud-input")).toBeInTheDocument();
  });

  // =====================================================================
  // [AC-2] Default configuration matches 9600/8/N/1
  // =====================================================================

  it("[AC-2] [INTEGRATION] DEFAULT_SERIAL_CONFIG matches Cisco console defaults", () => {
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
