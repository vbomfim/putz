/**
 * Type definitions for the Interface Status Parser.
 *
 * @module interfaceStatusTypes
 */

/** Parsed interface status entry. */
export interface InterfaceEntry {
  /** Interface name (e.g., "GigabitEthernet0/0", "ge-0/0/0"). */
  name: string;
  /** IP address (if assigned). */
  ipAddress: string;
  /** Operational status. */
  status: "up" | "down" | "admin-down";
  /** Protocol/link status. */
  protocol: "up" | "down";
  /** Detected vendor format. */
  vendor: "cisco" | "junos" | "unknown";
}

/** Supported vendor types for auto-detection. */
export type Vendor = "cisco" | "junos" | "unknown";
