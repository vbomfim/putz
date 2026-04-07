/**
 * MAC/ARP table parsers for Cisco output.
 *
 * Parses `show mac address-table` and `show ip arp` into structured data.
 *
 * @module macArpParsers
 */
import type { MacEntry, ArpEntry, TableMode } from "./types";
import { lookupVendor } from "./ouiVendors";

/**
 * Auto-detects whether the output is a MAC address table or ARP table.
 *
 * Heuristics:
 * - MAC table: contains "Mac Address" and "Vlan" headers
 * - ARP table: contains "Internet" or "Protocol" and "Address" and "Hardware"
 */
export function detectTableMode(output: string): TableMode | null {
  const lines = output.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("mac address") && lower.includes("vlan")) {
      return "mac";
    }
    if (
      lower.includes("internet") ||
      (lower.includes("protocol") && lower.includes("hardware"))
    ) {
      return "arp";
    }
    if (lower.includes("address") && lower.includes("age")) {
      return "arp";
    }
  }
  return null;
}

/**
 * Parses Cisco `show mac address-table` output.
 *
 * Example:
 * ```
 *           Mac Address Table
 * -------------------------------------------
 *
 * Vlan    Mac Address       Type        Ports
 * ----    -----------       --------    -----
 *    1    0100.0ccc.cccc    STATIC      CPU
 *   10    0050.7966.6800    DYNAMIC     Gi0/1
 *   20    aabb.cc00.0100    DYNAMIC     Gi0/2
 * ```
 */
export function parseMacTable(output: string): MacEntry[] {
  const entries: MacEntry[] = [];
  const lines = output.split("\n");

  // Format: VLAN  MAC  TYPE  PORT
  // MAC can be in multiple formats: aabb.ccdd.eeff, aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff
  const macLineRegex =
    /^\s*(\d+|All)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}|[0-9a-fA-F:]{17}|[0-9a-fA-F-]{17})\s+(\S+)\s+(\S+)\s*$/;

  for (const line of lines) {
    const match = macLineRegex.exec(line);
    if (!match) continue;

    const mac = match[2];
    entries.push({
      vlan: match[1],
      mac,
      type: match[3],
      interface: match[4],
      vendor: lookupVendor(mac),
    });
  }

  return entries;
}

/**
 * Parses Cisco `show ip arp` output.
 *
 * Example:
 * ```
 * Protocol  Address          Age (min)  Hardware Addr   Type   Interface
 * Internet  192.168.1.1             -   0050.7966.6800  ARPA   GigabitEthernet0/0
 * Internet  192.168.1.10           15   aabb.cc00.0100  ARPA   GigabitEthernet0/0
 * Internet  10.0.0.1                5   0000.0c07.ac01  ARPA   GigabitEthernet0/1
 * ```
 */
export function parseArpTable(output: string): ArpEntry[] {
  const entries: ArpEntry[] = [];
  const lines = output.split("\n");

  // Format: Protocol  IP  Age  MAC  Type  Interface
  const arpLineRegex =
    /^\s*Internet\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+|-)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}|[0-9a-fA-F:]{17}|[0-9a-fA-F-]{17}|Incomplete)\s+\S+\s+(\S+)\s*$/;

  for (const line of lines) {
    const match = arpLineRegex.exec(line);
    if (!match) continue;

    const mac = match[3];
    entries.push({
      ip: match[1],
      mac,
      age: match[2],
      interface: match[4],
      vendor: mac === "Incomplete" ? "—" : lookupVendor(mac),
    });
  }

  return entries;
}
