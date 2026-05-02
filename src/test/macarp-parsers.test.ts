/**
 * Unit tests for the MAC/ARP table parsers and OUI vendor lookup.
 *
 * Tags: [TDD], [UNIT]
 */
import { describe, it, expect } from "vitest";

import {
  parseMacTable,
  parseArpTable,
  detectTableMode,
} from "../components/MacArpViewer/parsers";
import {
  lookupVendor,
  normalizeMac,
} from "../components/MacArpViewer/ouiVendors";

describe("MAC/ARP parsers", () => {
  // ─── detectTableMode ───────────────────────────────────────

  describe("detectTableMode", () => {
    it("detects MAC table", () => {
      const output = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
   1    0100.0ccc.cccc    STATIC      CPU`;
      expect(detectTableMode(output)).toBe("mac");
    });

    it("detects ARP table", () => {
      const output = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   0050.7966.6800  ARPA   GigabitEthernet0/0`;
      expect(detectTableMode(output)).toBe("arp");
    });

    it("returns null for unknown output", () => {
      expect(detectTableMode("some random text")).toBe(null);
    });
  });

  // ─── parseMacTable ─────────────────────────────────────────

  describe("parseMacTable", () => {
    const MAC_OUTPUT = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
   1    0100.0ccc.cccc    STATIC      CPU
  10    0050.7966.6800    DYNAMIC     Gi0/1
  20    aabb.cc00.0100    DYNAMIC     Gi0/2
  30    000c.29ab.cdef    DYNAMIC     Gi0/3
 All    0100.0ccc.cccd    STATIC      CPU`;

    it("parses all MAC entries", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      expect(entries).toHaveLength(5);
    });

    it("parses VLAN correctly", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      expect(entries[0].vlan).toBe("1");
      expect(entries[1].vlan).toBe("10");
      expect(entries[4].vlan).toBe("All");
    });

    it("parses MAC address format", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      expect(entries[1].mac).toBe("0050.7966.6800");
    });

    it("parses interface/port", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      expect(entries[1].interface).toBe("Gi0/1");
      expect(entries[0].interface).toBe("CPU");
    });

    it("parses entry type", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      expect(entries[0].type).toBe("STATIC");
      expect(entries[1].type).toBe("DYNAMIC");
    });

    it("performs OUI vendor lookup", () => {
      const entries = parseMacTable(MAC_OUTPUT);
      // 000C29 is VMware
      const vmwareEntry = entries.find((e) => e.mac === "000c.29ab.cdef");
      expect(vmwareEntry?.vendor).toBe("VMware");
    });

    it("handles empty input", () => {
      expect(parseMacTable("")).toHaveLength(0);
    });
  });

  // ─── parseArpTable ─────────────────────────────────────────

  describe("parseArpTable", () => {
    const ARP_OUTPUT = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   0050.7966.6800  ARPA   GigabitEthernet0/0
Internet  192.168.1.10           15   000c.29ab.cdef  ARPA   GigabitEthernet0/0
Internet  10.0.0.1                5   0000.0c07.ac01  ARPA   GigabitEthernet0/1`;

    it("parses all ARP entries", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      expect(entries).toHaveLength(3);
    });

    it("parses IP address", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      expect(entries[0].ip).toBe("192.168.1.1");
      expect(entries[2].ip).toBe("10.0.0.1");
    });

    it("parses MAC address", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      expect(entries[0].mac).toBe("0050.7966.6800");
    });

    it("parses age", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      expect(entries[0].age).toBe("-");
      expect(entries[1].age).toBe("15");
    });

    it("parses interface", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      expect(entries[0].interface).toBe("GigabitEthernet0/0");
    });

    it("performs OUI vendor lookup", () => {
      const entries = parseArpTable(ARP_OUTPUT);
      const vmwareEntry = entries.find((e) => e.ip === "192.168.1.10");
      expect(vmwareEntry?.vendor).toBe("VMware");
    });

    it("handles empty input", () => {
      expect(parseArpTable("")).toHaveLength(0);
    });
  });
});

// ─── OUI Vendor Lookup ───────────────────────────────────────

describe("OUI vendor lookup", () => {
  describe("normalizeMac", () => {
    it("removes colons", () => {
      expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("AABBCCDDEEFF");
    });

    it("removes hyphens", () => {
      expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AABBCCDDEEFF");
    });

    it("removes dots", () => {
      expect(normalizeMac("aabb.ccdd.eeff")).toBe("AABBCCDDEEFF");
    });

    it("uppercases", () => {
      expect(normalizeMac("aabbccddeeff")).toBe("AABBCCDDEEFF");
    });

    it("handles already normalized", () => {
      expect(normalizeMac("AABBCCDDEEFF")).toBe("AABBCCDDEEFF");
    });
  });

  describe("lookupVendor", () => {
    it("identifies Cisco", () => {
      expect(lookupVendor("00:0D:29:ab:cd:ef")).toBe("Cisco");
    });

    it("identifies VMware", () => {
      expect(lookupVendor("00:0C:29:ab:cd:ef")).toBe("VMware");
    });

    it("identifies Apple", () => {
      expect(lookupVendor("00:0A:95:ab:cd:ef")).toBe("Apple");
    });

    it("returns Unknown for unrecognized OUI", () => {
      expect(lookupVendor("FF:FF:FF:FF:FF:FF")).toBe("Unknown");
    });

    it("returns Unknown for too short MAC", () => {
      expect(lookupVendor("AABB")).toBe("Unknown");
    });

    it("handles dot format", () => {
      expect(lookupVendor("000c.29ab.cdef")).toBe("VMware");
    });
  });
});
