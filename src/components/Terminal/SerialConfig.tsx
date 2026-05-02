/**
 * SerialConfig — serial port settings panel for the session editor.
 *
 * Displays serial-specific configuration fields:
 * - Port selector (dropdown, populated from serial_list_ports IPC)
 * - Refresh button to re-scan for hot-plugged adapters
 * - Baud rate (dropdown with common values + custom input)
 * - Data bits, Parity, Stop bits, Flow control dropdowns
 *
 * All fields have sensible defaults matching standard Cisco console
 * settings: 9600/8/N/1/None.
 */
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SerialPortInfo,
  SerialDataBits,
  SerialParity,
  SerialStopBits,
  SerialFlowControl,
  SerialConfigValues,
} from "./connectionTypes";
import { DEFAULT_SERIAL_CONFIG } from "./connectionTypes";

/** Standard baud rates shown in the dropdown. */
const STANDARD_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800,
  921600,
];

/** Data bits options. */
const DATA_BITS_OPTIONS: { value: SerialDataBits; label: string }[] = [
  { value: "five", label: "5" },
  { value: "six", label: "6" },
  { value: "seven", label: "7" },
  { value: "eight", label: "8" },
];

/** Parity options. */
const PARITY_OPTIONS: { value: SerialParity; label: string }[] = [
  { value: "none", label: "None" },
  { value: "even", label: "Even" },
  { value: "odd", label: "Odd" },
];

/** Stop bits options. */
const STOP_BITS_OPTIONS: { value: SerialStopBits; label: string }[] = [
  { value: "one", label: "1" },
  { value: "two", label: "2" },
];

/** Flow control options. */
const FLOW_CONTROL_OPTIONS: { value: SerialFlowControl; label: string }[] = [
  { value: "none", label: "None" },
  { value: "hardware", label: "Hardware (RTS/CTS)" },
  { value: "software", label: "Software (XON/XOFF)" },
];

interface SerialConfigProps {
  /** Current serial configuration values. */
  values: SerialConfigValues;
  /** Called when any value changes. */
  onChange: (values: SerialConfigValues) => void;
  /** Validation errors keyed by field name. */
  errors?: { port?: string };
}

// Re-export for backward compatibility
export { DEFAULT_SERIAL_CONFIG };
export type { SerialConfigValues };

export function SerialConfig({ values, onChange, errors }: SerialConfigProps) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [useCustomBaud, setUseCustomBaud] = useState(
    !STANDARD_BAUD_RATES.includes(values.baudRate),
  );

  /** Scans for available serial ports via IPC. */
  const refreshPorts = useCallback(async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const result = await invoke<SerialPortInfo[]>("serial_list_ports");
      const portList = Array.isArray(result) ? result : [];
      setPorts(portList);
      // Auto-select first port if current selection is empty
      if (!values.port && portList.length > 0) {
        onChange({ ...values, port: portList[0].name });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setScanError(`Failed to scan ports: ${message}`);
    } finally {
      setIsScanning(false);
    }
  }, [values, onChange]);

  // Scan ports on mount
  useEffect(() => {
    refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBaudChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === "custom") {
        setUseCustomBaud(true);
      } else {
        setUseCustomBaud(false);
        onChange({ ...values, baudRate: parseInt(val, 10) });
      }
    },
    [values, onChange],
  );

  const handleCustomBaudChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val > 0) {
        onChange({ ...values, baudRate: val });
      }
    },
    [values, onChange],
  );

  return (
    <div className="serial-config" data-testid="serial-config">
      {/* Port selector */}
      <div className="session-editor-field">
        <label htmlFor="serial-port">Serial Port *</label>
        <div className="serial-port-row">
          <select
            id="serial-port"
            value={values.port}
            onChange={(e) => onChange({ ...values, port: e.target.value })}
            aria-invalid={!!errors?.port}
            data-testid="serial-port-select"
          >
            <option value="">— Select port —</option>
            {ports.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="serial-refresh-btn"
            onClick={refreshPorts}
            disabled={isScanning}
            title="Refresh port list"
            data-testid="serial-refresh-btn"
          >
            {isScanning ? "⟳" : "↻"}
          </button>
        </div>
        {errors?.port && (
          <span
            className="session-editor-error"
            data-testid="serial-port-error"
          >
            {errors.port}
          </span>
        )}
        {scanError && <span className="session-editor-error">{scanError}</span>}
        {!isScanning && ports.length === 0 && !scanError && (
          <span className="session-editor-hint">
            No serial ports found. Plug in a USB adapter and click ↻.
          </span>
        )}
      </div>

      {/* Baud rate */}
      <div className="session-editor-field">
        <label htmlFor="serial-baud">Baud Rate</label>
        {useCustomBaud ? (
          <div className="serial-baud-custom">
            <input
              id="serial-baud"
              type="number"
              value={values.baudRate}
              onChange={handleCustomBaudChange}
              min={1}
              data-testid="serial-baud-input"
            />
            <button
              type="button"
              className="serial-baud-standard-btn"
              onClick={() => {
                setUseCustomBaud(false);
                onChange({ ...values, baudRate: 9600 });
              }}
              title="Use standard baud rate"
              data-testid="serial-baud-standard-btn"
            >
              Standard
            </button>
          </div>
        ) : (
          <select
            id="serial-baud"
            value={values.baudRate}
            onChange={handleBaudChange}
            data-testid="serial-baud-select"
          >
            {STANDARD_BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        )}
      </div>

      {/* Data bits */}
      <div className="session-editor-field">
        <label htmlFor="serial-data-bits">Data Bits</label>
        <select
          id="serial-data-bits"
          value={values.dataBits}
          onChange={(e) =>
            onChange({
              ...values,
              dataBits: e.target.value as SerialDataBits,
            })
          }
          data-testid="serial-data-bits"
        >
          {DATA_BITS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Parity */}
      <div className="session-editor-field">
        <label htmlFor="serial-parity">Parity</label>
        <select
          id="serial-parity"
          value={values.parity}
          onChange={(e) =>
            onChange({
              ...values,
              parity: e.target.value as SerialParity,
            })
          }
          data-testid="serial-parity"
        >
          {PARITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Stop bits */}
      <div className="session-editor-field">
        <label htmlFor="serial-stop-bits">Stop Bits</label>
        <select
          id="serial-stop-bits"
          value={values.stopBits}
          onChange={(e) =>
            onChange({
              ...values,
              stopBits: e.target.value as SerialStopBits,
            })
          }
          data-testid="serial-stop-bits"
        >
          {STOP_BITS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Flow control */}
      <div className="session-editor-field">
        <label htmlFor="serial-flow-control">Flow Control</label>
        <select
          id="serial-flow-control"
          value={values.flowControl}
          onChange={(e) =>
            onChange({
              ...values,
              flowControl: e.target.value as SerialFlowControl,
            })
          }
          data-testid="serial-flow-control"
        >
          {FLOW_CONTROL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
