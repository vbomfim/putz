/**
 * InterfaceStatus — color-coded interface status table.
 *
 * Parses Cisco/Junos interface output and displays a color-coded
 * table showing interface name, IP, status, and protocol.
 */
import { useCallback, useState } from "react";
import { parseInterfaces, detectVendor } from "./parsers";
import type { InterfaceEntry } from "./types";
import "./InterfaceStatus.css";

/** Returns a CSS class for the interface status. */
function statusClass(status: InterfaceEntry["status"]): string {
  switch (status) {
    case "up":
      return "intf-status-up";
    case "down":
      return "intf-status-down";
    case "admin-down":
      return "intf-status-admin-down";
  }
}

/** Returns a CSS class for the protocol status. */
function protocolClass(protocol: "up" | "down"): string {
  return protocol === "up" ? "intf-proto-up" : "intf-proto-down";
}

export function InterfaceStatus() {
  const [rawOutput, setRawOutput] = useState("");
  const [entries, setEntries] = useState<InterfaceEntry[]>([]);
  const [detectedVendor, setDetectedVendor] = useState<string>("");

  const handleParse = useCallback(() => {
    if (!rawOutput.trim()) return;
    const vendor = detectVendor(rawOutput);
    setDetectedVendor(vendor);
    const parsed = parseInterfaces(rawOutput);
    setEntries(parsed);
  }, [rawOutput]);

  const handleClear = useCallback(() => {
    setRawOutput("");
    setEntries([]);
    setDetectedVendor("");
  }, []);

  return (
    <div className="intf-status" data-testid="interface-status">
      <h2 className="intf-title">Interface Status</h2>

      <div className="intf-input-area">
        <textarea
          className="intf-textarea"
          placeholder="Paste 'show ip int brief' (Cisco) or 'show interfaces terse' (Junos) output here…"
          value={rawOutput}
          onChange={(e) => setRawOutput(e.target.value)}
          rows={8}
          data-testid="intf-textarea"
          aria-label="Command output"
        />
        <div className="intf-btn-row">
          <button
            className="intf-parse-btn"
            onClick={handleParse}
            disabled={!rawOutput.trim()}
            type="button"
            data-testid="intf-parse-btn"
          >
            Parse
          </button>
          <button
            className="intf-clear-btn"
            onClick={handleClear}
            type="button"
            data-testid="intf-clear-btn"
          >
            Clear
          </button>
          {detectedVendor && (
            <span className="intf-vendor-badge" data-testid="intf-vendor">
              {detectedVendor.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {entries.length > 0 && (
        <table className="intf-table" data-testid="intf-table">
          <thead>
            <tr>
              <th>Interface</th>
              <th>IP Address</th>
              <th>Status</th>
              <th>Protocol</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.name}-${i}`} data-testid={`intf-row-${e.name}`}>
                <td className="intf-cell-name">{e.name}</td>
                <td>{e.ipAddress || "—"}</td>
                <td className={statusClass(e.status)}>{e.status}</td>
                <td className={protocolClass(e.protocol)}>{e.protocol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entries.length === 0 && rawOutput.trim() && detectedVendor && (
        <div className="intf-no-results" data-testid="intf-no-results">
          No interfaces parsed. Check the output format.
        </div>
      )}
    </div>
  );
}
