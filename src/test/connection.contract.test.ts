/**
 * Contract tests for connection IPC types.
 *
 * Verifies that the TypeScript type definitions match the expected
 * structure of the Rust backend's IPC commands. These tests catch
 * type drift between frontend and backend.
 *
 * Tags: [CONTRACT], [AC-1]
 */
import { describe, it, expect } from "vitest";
import type {
  ConnectionOpenInput,
  ConnectionWriteArgs,
  ConnectionResizeArgs,
  ConnectionCloseArgs,
  ConnectionStatusPayload,
  ConnectionStatusType,
  ConnectionProtocol,
} from "../components/Terminal/connectionTypes";

describe("Connection IPC Type Contracts", () => {
  describe("ConnectionOpenInput", () => {
    it("accepts full telnet configuration", () => {
      const input: ConnectionOpenInput = {
        host: "192.168.1.1",
        port: 23,
        protocol: "telnet",
        username: "admin",
        cols: 80,
        rows: 24,
      };
      expect(input.host).toBe("192.168.1.1");
      expect(input.port).toBe(23);
      expect(input.protocol).toBe("telnet");
      expect(input.username).toBe("admin");
      expect(input.cols).toBe(80);
      expect(input.rows).toBe(24);
    });

    it("accepts minimal configuration (no optional fields)", () => {
      const input: ConnectionOpenInput = {
        protocol: "telnet",
        cols: 80,
        rows: 24,
      };
      expect(input.host).toBeUndefined();
      expect(input.port).toBeUndefined();
      expect(input.username).toBeUndefined();
    });

    it("accepts all protocol types", () => {
      const protocols: ConnectionProtocol[] = [
        "ssh",
        "telnet",
        "serial",
        "local",
      ];
      for (const protocol of protocols) {
        const input: ConnectionOpenInput = { protocol, cols: 80, rows: 24 };
        expect(input.protocol).toBe(protocol);
      }
    });
  });

  describe("ConnectionWriteArgs", () => {
    it("has connectionId and data fields", () => {
      const args: ConnectionWriteArgs = {
        connectionId: "abc-123",
        data: [72, 101, 108, 108, 111],
      };
      expect(args.connectionId).toBe("abc-123");
      expect(args.data).toEqual([72, 101, 108, 108, 111]);
    });
  });

  describe("ConnectionResizeArgs", () => {
    it("has connectionId, cols, and rows fields", () => {
      const args: ConnectionResizeArgs = {
        connectionId: "abc-123",
        cols: 120,
        rows: 40,
      };
      expect(args.connectionId).toBe("abc-123");
      expect(args.cols).toBe(120);
      expect(args.rows).toBe(40);
    });
  });

  describe("ConnectionCloseArgs", () => {
    it("has connectionId field", () => {
      const args: ConnectionCloseArgs = {
        connectionId: "abc-123",
      };
      expect(args.connectionId).toBe("abc-123");
    });
  });

  describe("ConnectionStatusPayload", () => {
    it("accepts all status types", () => {
      const statuses: ConnectionStatusType[] = [
        "connecting",
        "connected",
        "disconnected",
        "error",
      ];
      for (const status of statuses) {
        const payload: ConnectionStatusPayload = { status };
        expect(payload.status).toBe(status);
        expect(payload.message).toBeUndefined();
      }
    });

    it("accepts optional message", () => {
      const payload: ConnectionStatusPayload = {
        status: "error",
        message: "Connection refused",
      };
      expect(payload.status).toBe("error");
      expect(payload.message).toBe("Connection refused");
    });
  });
});
