/**
 * QuickConnect parseConnection tests — validates connection string parsing.
 *
 * Tests all supported input formats:
 * - SSH with user@host:port
 * - Telnet with host and port
 * - Serial with device path
 * - Plain hostname (defaults to SSH)
 * - Edge cases (empty input, IPv6-like, invalid ports)
 *
 * Tags: [TDD], [UNIT]
 */
import { describe, it, expect } from "vitest";
import { parseConnection } from "../components/QuickConnect/parseConnection";

describe("parseConnection", () => {
  describe("SSH connections", () => {
    it("parses ssh user@host", () => {
      const result = parseConnection("ssh admin@10.0.0.1");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: undefined,
      });
    });

    it("parses ssh user@host:port", () => {
      const result = parseConnection("ssh admin@10.0.0.1:2222");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: 2222,
      });
    });

    it("parses ssh host (no user)", () => {
      const result = parseConnection("ssh 192.168.1.1");
      expect(result).toEqual({
        protocol: "ssh",
        host: "192.168.1.1",
        username: undefined,
        port: undefined,
      });
    });

    it("parses ssh hostname", () => {
      const result = parseConnection("ssh router1.lab.local");
      expect(result).toEqual({
        protocol: "ssh",
        host: "router1.lab.local",
        username: undefined,
        port: undefined,
      });
    });

    it("parses SSH (case-insensitive protocol)", () => {
      const result = parseConnection("SSH admin@10.0.0.1");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: undefined,
      });
    });
  });

  describe("Telnet connections", () => {
    it("parses telnet host", () => {
      const result = parseConnection("telnet 10.0.0.1");
      expect(result).toEqual({
        protocol: "telnet",
        host: "10.0.0.1",
        username: undefined,
        port: undefined,
      });
    });

    it("parses telnet host port", () => {
      const result = parseConnection("telnet 10.0.0.1 23");
      expect(result).toEqual({
        protocol: "telnet",
        host: "10.0.0.1",
        username: undefined,
        port: 23,
      });
    });

    it("parses telnet with non-standard port", () => {
      const result = parseConnection("telnet switch1.lab 4001");
      expect(result).toEqual({
        protocol: "telnet",
        host: "switch1.lab",
        username: undefined,
        port: 4001,
      });
    });
  });

  describe("Serial connections", () => {
    it("parses serial device path", () => {
      const result = parseConnection("serial /dev/ttyUSB0");
      expect(result).toEqual({
        protocol: "serial",
        host: "/dev/ttyUSB0",
      });
    });

    it("parses serial COM port (Windows)", () => {
      const result = parseConnection("serial COM3");
      expect(result).toEqual({
        protocol: "serial",
        host: "COM3",
      });
    });
  });

  describe("Default protocol (SSH)", () => {
    it("plain IP defaults to SSH", () => {
      const result = parseConnection("10.0.0.1");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: undefined,
        port: undefined,
      });
    });

    it("plain hostname defaults to SSH", () => {
      const result = parseConnection("router1.example.com");
      expect(result).toEqual({
        protocol: "ssh",
        host: "router1.example.com",
        username: undefined,
        port: undefined,
      });
    });

    it("user@host defaults to SSH", () => {
      const result = parseConnection("admin@10.0.0.1");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: undefined,
      });
    });

    it("user@host:port defaults to SSH", () => {
      const result = parseConnection("admin@10.0.0.1:2222");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: 2222,
      });
    });
  });

  describe("Edge cases", () => {
    it("returns null for empty input", () => {
      expect(parseConnection("")).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      expect(parseConnection("   ")).toBeNull();
    });

    it("returns null for protocol with no target", () => {
      expect(parseConnection("ssh")).toBeNull();
    });

    it("trims whitespace", () => {
      const result = parseConnection("  ssh admin@10.0.0.1  ");
      expect(result).toEqual({
        protocol: "ssh",
        host: "10.0.0.1",
        username: "admin",
        port: undefined,
      });
    });

    it("ignores invalid port values", () => {
      const result = parseConnection("telnet 10.0.0.1 abc");
      expect(result).toEqual({
        protocol: "telnet",
        host: "10.0.0.1",
        username: undefined,
        port: undefined,
      });
    });

    it("rejects port 0", () => {
      const result = parseConnection("telnet 10.0.0.1 0");
      expect(result).toEqual({
        protocol: "telnet",
        host: "10.0.0.1",
        username: undefined,
        port: undefined,
      });
    });

    it("rejects port > 65535", () => {
      const result = parseConnection("telnet 10.0.0.1 99999");
      expect(result).toEqual({
        protocol: "telnet",
        host: "10.0.0.1",
        username: undefined,
        port: undefined,
      });
    });
  });
});
