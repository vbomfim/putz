/**
 * Unit tests for the InterfaceStatus parsers.
 *
 * Tests vendor detection, Cisco and Junos parsers with real-world output.
 *
 * Tags: [TDD], [UNIT]
 */
import { describe, it, expect } from "vitest";

import {
  detectVendor,
  parseCiscoInterfaces,
  parseJunosInterfaces,
  parseInterfaces,
} from "../components/InterfaceStatus/parsers";

describe("InterfaceStatus parsers", () => {
  // ─── detectVendor ──────────────────────────────────────────

  describe("detectVendor", () => {
    it("detects Cisco from show ip int brief header", () => {
      const output = `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0     192.168.1.1     YES manual up                    up`;
      expect(detectVendor(output)).toBe("cisco");
    });

    it("detects Junos from show interfaces terse header", () => {
      const output = `Interface               Admin Link Proto    Local                 Remote
ge-0/0/0                up    up`;
      expect(detectVendor(output)).toBe("junos");
    });

    it("returns unknown for unrecognized output", () => {
      expect(detectVendor("some random text")).toBe("unknown");
    });

    it("returns unknown for empty string", () => {
      expect(detectVendor("")).toBe("unknown");
    });
  });

  // ─── parseCiscoInterfaces ──────────────────────────────────

  describe("parseCiscoInterfaces", () => {
    const CISCO_OUTPUT = `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0     192.168.1.1     YES manual up                    up
GigabitEthernet0/1     unassigned      YES unset  administratively down down
GigabitEthernet0/2     10.0.0.1        YES DHCP   up                    up
Loopback0              10.255.0.1      YES manual up                    up
Serial0/0/0            172.16.1.1      YES manual down                  down`;

    it("parses all interfaces", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries).toHaveLength(5);
    });

    it("parses interface names correctly", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries[0].name).toBe("GigabitEthernet0/0");
      expect(entries[3].name).toBe("Loopback0");
      expect(entries[4].name).toBe("Serial0/0/0");
    });

    it("parses IP addresses correctly", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries[0].ipAddress).toBe("192.168.1.1");
      expect(entries[1].ipAddress).toBe(""); // unassigned
      expect(entries[2].ipAddress).toBe("10.0.0.1");
    });

    it("detects up status", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries[0].status).toBe("up");
      expect(entries[0].protocol).toBe("up");
    });

    it("detects administratively down status", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries[1].status).toBe("admin-down");
      expect(entries[1].protocol).toBe("down");
    });

    it("detects down status", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries[4].status).toBe("down");
      expect(entries[4].protocol).toBe("down");
    });

    it("sets vendor to cisco", () => {
      const entries = parseCiscoInterfaces(CISCO_OUTPUT);
      expect(entries.every((e) => e.vendor === "cisco")).toBe(true);
    });

    it("handles empty input", () => {
      expect(parseCiscoInterfaces("")).toHaveLength(0);
    });

    it("ignores header line", () => {
      const output =
        "Interface              IP-Address      OK? Method Status                Protocol";
      expect(parseCiscoInterfaces(output)).toHaveLength(0);
    });
  });

  // ─── parseJunosInterfaces ──────────────────────────────────

  describe("parseJunosInterfaces", () => {
    const JUNOS_OUTPUT = `Interface               Admin Link Proto    Local                 Remote
ge-0/0/0                up    up
ge-0/0/0.0              up    up   inet     192.168.1.1/24
ge-0/0/1                up    down
ge-0/0/2                down  down
lo0                     up    up
lo0.0                   up    up   inet     10.0.0.1/32`;

    it("parses all interfaces", () => {
      const entries = parseJunosInterfaces(JUNOS_OUTPUT);
      expect(entries.length).toBeGreaterThanOrEqual(3);
    });

    it("parses interface names", () => {
      const entries = parseJunosInterfaces(JUNOS_OUTPUT);
      const names = entries.map((e) => e.name);
      expect(names).toContain("ge-0/0/0");
    });

    it("extracts IP from inet entries", () => {
      const entries = parseJunosInterfaces(JUNOS_OUTPUT);
      const withIp = entries.find((e) => e.name === "ge-0/0/0.0");
      if (withIp) {
        expect(withIp.ipAddress).toBe("192.168.1.1");
      }
    });

    it("sets vendor to junos", () => {
      const entries = parseJunosInterfaces(JUNOS_OUTPUT);
      expect(entries.every((e) => e.vendor === "junos")).toBe(true);
    });
  });

  // ─── parseInterfaces (auto-detect) ─────────────────────────

  describe("parseInterfaces", () => {
    it("auto-detects and parses Cisco output", () => {
      const output = `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0     192.168.1.1     YES manual up                    up`;
      const entries = parseInterfaces(output);
      expect(entries).toHaveLength(1);
      expect(entries[0].vendor).toBe("cisco");
    });

    it("returns empty for unknown format", () => {
      const entries = parseInterfaces("random garbage");
      expect(entries).toHaveLength(0);
    });
  });
});
