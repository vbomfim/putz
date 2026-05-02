/**
 * Type definitions for the Quick Connect bar.
 *
 * Defines the parsed connection result from free-form input.
 */

import type { ConnectionProtocol } from "../Terminal/connectionTypes";

/** Parsed result from a quick connect string. */
export interface ParsedConnection {
  protocol: ConnectionProtocol;
  host: string;
  port?: number;
  username?: string;
}

/** Default ports for each protocol. */
export const PROTOCOL_DEFAULTS: Record<ConnectionProtocol, number | undefined> =
  {
    ssh: 22,
    telnet: 23,
    serial: undefined,
    local: undefined,
  };
