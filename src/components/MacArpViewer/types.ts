/**
 * Type definitions for the MAC/ARP Table Viewer.
 *
 * @module macArpTypes
 */

/** Parsed MAC address table entry. */
export interface MacEntry {
  /** VLAN ID. */
  vlan: string;
  /** MAC address. */
  mac: string;
  /** Entry type (DYNAMIC, STATIC, etc.). */
  type: string;
  /** Interface/port. */
  interface: string;
  /** Vendor name from OUI lookup. */
  vendor: string;
}

/** Parsed ARP table entry. */
export interface ArpEntry {
  /** IP address. */
  ip: string;
  /** MAC address. */
  mac: string;
  /** Age (minutes or -). */
  age: string;
  /** Interface. */
  interface: string;
  /** Vendor name from OUI lookup. */
  vendor: string;
}

/** Union type for displayed table rows. */
export type TableEntry = MacEntry | ArpEntry;

/** Table mode — MAC table or ARP table. */
export type TableMode = "mac" | "arp";
