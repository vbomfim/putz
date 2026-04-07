/**
 * Quick connect input parser.
 *
 * Parses free-form connection strings into structured connection details.
 *
 * Supported formats:
 * - `ssh admin@10.0.0.1` — SSH with username
 * - `ssh admin@10.0.0.1:2222` — SSH with username and port
 * - `telnet 10.0.0.1 23` — Telnet with port
 * - `serial /dev/ttyUSB0` — Serial connection
 * - `10.0.0.1` — Plain hostname defaults to SSH
 * - `admin@10.0.0.1` — With username defaults to SSH
 *
 * @module parseConnection
 */
import type { ConnectionProtocol } from "../Terminal/connectionTypes";
import type { ParsedConnection } from "./types";

/**
 * Parses a quick connect string into structured connection details.
 *
 * Returns null if the input is empty or invalid.
 */
export function parseConnection(input: string): ParsedConnection | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const first = parts[0].toLowerCase();

  // Check for explicit protocol prefix
  if (first === "ssh" || first === "telnet" || first === "serial") {
    return parseWithProtocol(first as ConnectionProtocol, parts.slice(1));
  }

  // No protocol prefix — default to SSH
  return parseWithProtocol("ssh", parts);
}

/**
 * Parses the remaining parts after the protocol keyword.
 */
function parseWithProtocol(
  protocol: ConnectionProtocol,
  parts: string[],
): ParsedConnection | null {
  if (parts.length === 0) return null;

  if (protocol === "serial") {
    // Serial: just the port path
    return {
      protocol: "serial",
      host: parts[0],
    };
  }

  const target = parts[0];
  let extraPort: number | undefined;

  // Check for port as second argument: `telnet 10.0.0.1 23`
  if (parts.length >= 2) {
    const parsed = parseInt(parts[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      extraPort = parsed;
    }
  }

  // Parse user@host:port
  const { username, host, port } = parseTarget(target);

  if (!host) return null;

  return {
    protocol,
    host,
    port: port ?? extraPort,
    username: username || undefined,
  };
}

/**
 * Parses a target string in the format `[user@]host[:port]`.
 */
function parseTarget(target: string): {
  username: string | null;
  host: string;
  port: number | null;
} {
  let username: string | null = null;
  let remaining = target;

  // Extract username: user@...
  const atIndex = remaining.indexOf("@");
  if (atIndex > 0) {
    username = remaining.slice(0, atIndex);
    remaining = remaining.slice(atIndex + 1);
  }

  // Extract port: ...:port (but NOT IPv6 addresses)
  let port: number | null = null;
  // Simple heuristic: if there's a colon and the part after is numeric, treat as port
  const lastColon = remaining.lastIndexOf(":");
  if (lastColon > 0) {
    const portPart = remaining.slice(lastColon + 1);
    const parsed = parseInt(portPart, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      port = parsed;
      remaining = remaining.slice(0, lastColon);
    }
  }

  return { username, host: remaining, port };
}
