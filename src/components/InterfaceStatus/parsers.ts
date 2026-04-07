/**
 * Interface status parsers for Cisco and Juniper output.
 *
 * Parses `show ip interface brief` (Cisco) and
 * `show interfaces terse` (Junos) into structured data.
 *
 * @module interfaceStatusParsers
 */
import type { InterfaceEntry, Vendor } from "./types";

/**
 * Auto-detects the vendor from raw command output.
 *
 * Heuristics:
 * - Cisco: contains "Interface" and "IP-Address" header columns
 * - Junos: contains "Interface" and "Admin" and "Link" header columns
 */
export function detectVendor(output: string): Vendor {
  const lines = output.split("\n");
  for (const line of lines) {
    // Cisco: "Interface  IP-Address  OK? Method Status Protocol"
    if (/Interface\s+IP-Address/i.test(line)) {
      return "cisco";
    }
    // Junos: "Interface  Admin Link Proto Local  Remote"
    if (/Interface\s+Admin\s+Link/i.test(line)) {
      return "junos";
    }
  }
  return "unknown";
}

/**
 * Parses Cisco `show ip interface brief` output.
 *
 * Example input:
 * ```
 * Interface              IP-Address      OK? Method Status                Protocol
 * GigabitEthernet0/0     192.168.1.1     YES manual up                    up
 * GigabitEthernet0/1     unassigned      YES unset  administratively down down
 * Loopback0              10.0.0.1        YES manual up                    up
 * ```
 */
export function parseCiscoInterfaces(output: string): InterfaceEntry[] {
  const entries: InterfaceEntry[] = [];
  const lines = output.split("\n");

  // Regex for Cisco show ip int brief lines
  // Interface name, IP address, OK?, Method, Status (may be multi-word), Protocol
  const lineRegex =
    /^(\S+)\s+(\S+)\s+\S+\s+\S+\s+(up|down|administratively\s+down)\s+(up|down)\s*$/i;

  for (const line of lines) {
    const match = lineRegex.exec(line.trim());
    if (!match) continue;

    const name = match[1];
    const ipAddress = match[2] === "unassigned" ? "" : match[2];
    const rawStatus = match[3].toLowerCase();
    const rawProtocol = match[4].toLowerCase();

    let status: InterfaceEntry["status"];
    if (rawStatus.includes("administratively")) {
      status = "admin-down";
    } else if (rawStatus === "up") {
      status = "up";
    } else {
      status = "down";
    }

    entries.push({
      name,
      ipAddress,
      status,
      protocol: rawProtocol as "up" | "down",
      vendor: "cisco",
    });
  }

  return entries;
}

/**
 * Parses Juniper `show interfaces terse` output.
 *
 * Example input:
 * ```
 * Interface               Admin Link Proto    Local                 Remote
 * ge-0/0/0                up    up
 * ge-0/0/0.0              up    up   inet     192.168.1.1/24
 * ge-0/0/1                up    down
 * lo0                     up    up
 * lo0.0                   up    up   inet     10.0.0.1/32
 * ```
 */
export function parseJunosInterfaces(output: string): InterfaceEntry[] {
  const entries: InterfaceEntry[] = [];
  const lines = output.split("\n");

  // Regex: Interface, Admin, Link, optional Proto, optional Local
  const lineRegex = /^(\S+)\s+(up|down)\s+(up|down)(?:\s+(\S+)\s+(\S+))?\s*$/i;

  for (const line of lines) {
    const match = lineRegex.exec(line.trim());
    if (!match) continue;

    const name = match[1];
    const adminStatus = match[2].toLowerCase();
    const linkStatus = match[3].toLowerCase();
    const localAddr = match[5] || "";

    // Extract IP without prefix length
    const ipAddress = localAddr.includes("/")
      ? localAddr.split("/")[0]
      : localAddr;

    entries.push({
      name,
      ipAddress,
      status: adminStatus === "up" ? "up" : "admin-down",
      protocol: linkStatus as "up" | "down",
      vendor: "junos",
    });
  }

  return entries;
}

/**
 * Parses interface status output, auto-detecting vendor.
 */
export function parseInterfaces(output: string): InterfaceEntry[] {
  const vendor = detectVendor(output);
  switch (vendor) {
    case "cisco":
      return parseCiscoInterfaces(output);
    case "junos":
      return parseJunosInterfaces(output);
    default:
      return [];
  }
}
