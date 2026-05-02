/**
 * MacArpViewer — searchable MAC and ARP table viewer with vendor lookup.
 *
 * Parses Cisco `show mac address-table` and `show ip arp` output
 * into a searchable, sortable table with OUI vendor identification.
 */
import { useCallback, useMemo, useState } from "react";
import { detectTableMode, parseMacTable, parseArpTable } from "./parsers";
import type { MacEntry, ArpEntry, TableMode } from "./types";
import "./MacArpViewer.css";

export function MacArpViewer() {
  const [rawOutput, setRawOutput] = useState("");
  const [macEntries, setMacEntries] = useState<MacEntry[]>([]);
  const [arpEntries, setArpEntries] = useState<ArpEntry[]>([]);
  const [mode, setMode] = useState<TableMode | null>(null);
  const [search, setSearch] = useState("");

  const handleParse = useCallback(() => {
    if (!rawOutput.trim()) return;
    const detected = detectTableMode(rawOutput);
    setMode(detected);

    if (detected === "mac") {
      setMacEntries(parseMacTable(rawOutput));
      setArpEntries([]);
    } else if (detected === "arp") {
      setArpEntries(parseArpTable(rawOutput));
      setMacEntries([]);
    }
  }, [rawOutput]);

  const handleClear = useCallback(() => {
    setRawOutput("");
    setMacEntries([]);
    setArpEntries([]);
    setMode(null);
    setSearch("");
  }, []);

  // Filter entries by search term
  const filteredMac = useMemo(() => {
    if (!search.trim()) return macEntries;
    const q = search.toLowerCase();
    return macEntries.filter(
      (e) =>
        e.mac.toLowerCase().includes(q) ||
        e.vlan.toLowerCase().includes(q) ||
        e.interface.toLowerCase().includes(q) ||
        e.vendor.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q),
    );
  }, [macEntries, search]);

  const filteredArp = useMemo(() => {
    if (!search.trim()) return arpEntries;
    const q = search.toLowerCase();
    return arpEntries.filter(
      (e) =>
        e.ip.toLowerCase().includes(q) ||
        e.mac.toLowerCase().includes(q) ||
        e.interface.toLowerCase().includes(q) ||
        e.vendor.toLowerCase().includes(q),
    );
  }, [arpEntries, search]);

  return (
    <div className="macarp-viewer" data-testid="macarp-viewer">
      <h2 className="macarp-title">MAC / ARP Table Viewer</h2>

      <div className="macarp-input-area">
        <textarea
          className="macarp-textarea"
          placeholder="Paste 'show mac address-table' or 'show ip arp' output here…"
          value={rawOutput}
          onChange={(e) => setRawOutput(e.target.value)}
          rows={8}
          data-testid="macarp-textarea"
          aria-label="Command output"
        />
        <div className="macarp-btn-row">
          <button
            className="macarp-parse-btn"
            onClick={handleParse}
            disabled={!rawOutput.trim()}
            type="button"
            data-testid="macarp-parse-btn"
          >
            Parse
          </button>
          <button
            className="macarp-clear-btn"
            onClick={handleClear}
            type="button"
            data-testid="macarp-clear-btn"
          >
            Clear
          </button>
          {mode && (
            <span className="macarp-mode-badge" data-testid="macarp-mode">
              {mode === "mac" ? "MAC TABLE" : "ARP TABLE"}
            </span>
          )}
        </div>
      </div>

      {/* Search bar */}
      {(macEntries.length > 0 || arpEntries.length > 0) && (
        <input
          type="text"
          className="macarp-search"
          placeholder="Search MAC, IP, VLAN, Interface, Vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="macarp-search"
          aria-label="Search entries"
        />
      )}

      {/* MAC Table */}
      {mode === "mac" && filteredMac.length > 0 && (
        <table className="macarp-table" data-testid="macarp-table">
          <thead>
            <tr>
              <th>VLAN</th>
              <th>MAC Address</th>
              <th>Type</th>
              <th>Interface</th>
              <th>Vendor</th>
            </tr>
          </thead>
          <tbody>
            {filteredMac.map((e, i) => (
              <tr key={`${e.mac}-${i}`}>
                <td>{e.vlan}</td>
                <td className="macarp-cell-mac">{e.mac}</td>
                <td>{e.type}</td>
                <td>{e.interface}</td>
                <td className="macarp-cell-vendor">{e.vendor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ARP Table */}
      {mode === "arp" && filteredArp.length > 0 && (
        <table className="macarp-table" data-testid="macarp-table">
          <thead>
            <tr>
              <th>IP Address</th>
              <th>MAC Address</th>
              <th>Age (min)</th>
              <th>Interface</th>
              <th>Vendor</th>
            </tr>
          </thead>
          <tbody>
            {filteredArp.map((e, i) => (
              <tr key={`${e.ip}-${i}`}>
                <td>{e.ip}</td>
                <td className="macarp-cell-mac">{e.mac}</td>
                <td>{e.age}</td>
                <td>{e.interface}</td>
                <td className="macarp-cell-vendor">{e.vendor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mode && filteredMac.length === 0 && filteredArp.length === 0 && (
        <div className="macarp-no-results" data-testid="macarp-no-results">
          {search
            ? "No entries match your search."
            : "No entries parsed. Check the output format."}
        </div>
      )}
    </div>
  );
}
