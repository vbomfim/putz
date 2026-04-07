/**
 * Contract tests for serial connection IPC types.
 *
 * Verifies that the TypeScript type definitions for serial connections
 * match the expected structure of the Rust backend's IPC commands.
 *
 * Tags: [CONTRACT], [AC-1], [AC-3]
 */
import { describe, it, expect } from "vitest";
import type {
  ConnectionOpenInput,
  SerialDataBits,
  SerialParity,
  SerialStopBits,
  SerialFlowControl,
  SerialPortInfo,
} from "../components/Terminal/connectionTypes";

describe("Serial Connection Type Contracts", () => {
  describe("ConnectionOpenInput with serial fields", () => {
    it("accepts full serial configuration", () => {
      const input: ConnectionOpenInput = {
        host: "/dev/ttyUSB0",
        protocol: "serial",
        cols: 80,
        rows: 24,
        baudRate: 115200,
        dataBits: "seven",
        parity: "even",
        stopBits: "two",
        flowControl: "hardware",
      };
      expect(input.host).toBe("/dev/ttyUSB0");
      expect(input.protocol).toBe("serial");
      expect(input.baudRate).toBe(115200);
      expect(input.dataBits).toBe("seven");
      expect(input.parity).toBe("even");
      expect(input.stopBits).toBe("two");
      expect(input.flowControl).toBe("hardware");
    });

    it("accepts serial with defaults (no serial-specific fields)", () => {
      const input: ConnectionOpenInput = {
        host: "COM3",
        protocol: "serial",
        cols: 80,
        rows: 24,
      };
      expect(input.baudRate).toBeUndefined();
      expect(input.dataBits).toBeUndefined();
      expect(input.parity).toBeUndefined();
      expect(input.stopBits).toBeUndefined();
      expect(input.flowControl).toBeUndefined();
    });

    it("serial fields are optional for non-serial protocols", () => {
      const input: ConnectionOpenInput = {
        host: "192.168.1.1",
        port: 23,
        protocol: "telnet",
        cols: 80,
        rows: 24,
      };
      expect(input.baudRate).toBeUndefined();
    });
  });

  describe("SerialDataBits", () => {
    it("accepts all valid values", () => {
      const values: SerialDataBits[] = ["five", "six", "seven", "eight"];
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });
  });

  describe("SerialParity", () => {
    it("accepts all valid values", () => {
      const values: SerialParity[] = ["none", "even", "odd"];
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });
  });

  describe("SerialStopBits", () => {
    it("accepts all valid values", () => {
      const values: SerialStopBits[] = ["one", "two"];
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });
  });

  describe("SerialFlowControl", () => {
    it("accepts all valid values", () => {
      const values: SerialFlowControl[] = ["none", "hardware", "software"];
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });
  });

  describe("SerialPortInfo", () => {
    it("accepts full port info with all fields", () => {
      const info: SerialPortInfo = {
        name: "/dev/ttyUSB0",
        description: "FT232R USB UART",
        manufacturer: "FTDI",
        serialNumber: "A12345",
        portType: "USB",
      };
      expect(info.name).toBe("/dev/ttyUSB0");
      expect(info.description).toBe("FT232R USB UART");
      expect(info.manufacturer).toBe("FTDI");
      expect(info.serialNumber).toBe("A12345");
      expect(info.portType).toBe("USB");
    });

    it("accepts minimal port info without optional fields", () => {
      const info: SerialPortInfo = {
        name: "COM1",
        description: "PCI Serial Port",
        portType: "PCI",
      };
      expect(info.manufacturer).toBeUndefined();
      expect(info.serialNumber).toBeUndefined();
    });

    it("accepts all port types", () => {
      const types = ["USB", "PCI", "Bluetooth", "Unknown"];
      for (const t of types) {
        const info: SerialPortInfo = {
          name: "test",
          description: "test",
          portType: t,
        };
        expect(info.portType).toBe(t);
      }
    });
  });
});
