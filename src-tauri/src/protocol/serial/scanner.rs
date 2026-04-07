/// Serial port scanner — discovers available serial ports.
///
/// Uses the `serialport` crate to enumerate system serial ports.
/// Returns structured info including port type (USB/PCI/Bluetooth)
/// and manufacturer details when available.
use serde::{Deserialize, Serialize};

/// Information about an available serial port.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    /// System port name (e.g., "/dev/ttyUSB0", "COM3").
    pub name: String,
    /// Human-readable description of the port.
    pub description: String,
    /// Manufacturer name (USB devices only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    /// Device serial number (USB devices only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    /// Port type: "USB", "PCI", "Bluetooth", or "Unknown".
    pub port_type: String,
}

/// Lists all available serial ports on the system.
///
/// Returns an empty vec if no ports are found or if enumeration fails.
pub fn list_serial_ports() -> Vec<SerialPortInfo> {
    match serialport::available_ports() {
        Ok(ports) => ports.into_iter().map(map_port_info).collect(),
        Err(_) => Vec::new(),
    }
}

/// Maps a `serialport::SerialPortInfo` to our `SerialPortInfo`.
fn map_port_info(port: serialport::SerialPortInfo) -> SerialPortInfo {
    match &port.port_type {
        serialport::SerialPortType::UsbPort(usb) => SerialPortInfo {
            name: port.port_name,
            description: usb
                .product
                .clone()
                .unwrap_or_else(|| "USB Serial Device".into()),
            manufacturer: usb.manufacturer.clone(),
            serial_number: usb.serial_number.clone(),
            port_type: "USB".into(),
        },
        serialport::SerialPortType::PciPort => SerialPortInfo {
            name: port.port_name,
            description: "PCI Serial Port".into(),
            manufacturer: None,
            serial_number: None,
            port_type: "PCI".into(),
        },
        serialport::SerialPortType::BluetoothPort => SerialPortInfo {
            name: port.port_name,
            description: "Bluetooth Serial Port".into(),
            manufacturer: None,
            serial_number: None,
            port_type: "Bluetooth".into(),
        },
        serialport::SerialPortType::Unknown => SerialPortInfo {
            name: port.port_name,
            description: "Serial Port".into(),
            manufacturer: None,
            serial_number: None,
            port_type: "Unknown".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // SerialPortInfo serialization tests
    // ====================================================================

    #[test]
    fn port_info_serializes_camel_case() {
        let info = SerialPortInfo {
            name: "/dev/ttyUSB0".into(),
            description: "USB Serial Adapter".into(),
            manufacturer: Some("FTDI".into()),
            serial_number: Some("A12345".into()),
            port_type: "USB".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("portType"));
        assert!(json.contains("serialNumber"));
    }

    #[test]
    fn port_info_omits_none_fields() {
        let info = SerialPortInfo {
            name: "COM1".into(),
            description: "PCI Serial Port".into(),
            manufacturer: None,
            serial_number: None,
            port_type: "PCI".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("manufacturer"));
        assert!(!json.contains("serialNumber"));
    }

    #[test]
    fn port_info_roundtrip() {
        let info = SerialPortInfo {
            name: "/dev/ttyUSB0".into(),
            description: "CP2102 USB to UART Bridge".into(),
            manufacturer: Some("Silicon Labs".into()),
            serial_number: Some("0001".into()),
            port_type: "USB".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let restored: SerialPortInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info, restored);
    }

    // ====================================================================
    // Port mapping tests
    // ====================================================================

    #[test]
    fn map_usb_port_extracts_metadata() {
        let port = serialport::SerialPortInfo {
            port_name: "/dev/ttyUSB0".into(),
            port_type: serialport::SerialPortType::UsbPort(
                serialport::UsbPortInfo {
                    vid: 0x0403,
                    pid: 0x6001,
                    serial_number: Some("A12345".into()),
                    manufacturer: Some("FTDI".into()),
                    product: Some("FT232R".into()),
                    #[cfg(feature = "usbportinfo-interface")]
                    interface: None,
                },
            ),
        };
        let info = map_port_info(port);
        assert_eq!(info.name, "/dev/ttyUSB0");
        assert_eq!(info.description, "FT232R");
        assert_eq!(info.manufacturer, Some("FTDI".into()));
        assert_eq!(info.serial_number, Some("A12345".into()));
        assert_eq!(info.port_type, "USB");
    }

    #[test]
    fn map_usb_port_without_product_uses_default() {
        let port = serialport::SerialPortInfo {
            port_name: "COM3".into(),
            port_type: serialport::SerialPortType::UsbPort(
                serialport::UsbPortInfo {
                    vid: 0x10C4,
                    pid: 0xEA60,
                    serial_number: None,
                    manufacturer: None,
                    product: None,
                    #[cfg(feature = "usbportinfo-interface")]
                    interface: None,
                },
            ),
        };
        let info = map_port_info(port);
        assert_eq!(info.description, "USB Serial Device");
    }

    #[test]
    fn map_pci_port() {
        let port = serialport::SerialPortInfo {
            port_name: "COM1".into(),
            port_type: serialport::SerialPortType::PciPort,
        };
        let info = map_port_info(port);
        assert_eq!(info.name, "COM1");
        assert_eq!(info.port_type, "PCI");
        assert!(info.manufacturer.is_none());
    }

    #[test]
    fn map_bluetooth_port() {
        let port = serialport::SerialPortInfo {
            port_name: "/dev/rfcomm0".into(),
            port_type: serialport::SerialPortType::BluetoothPort,
        };
        let info = map_port_info(port);
        assert_eq!(info.port_type, "Bluetooth");
    }

    #[test]
    fn map_unknown_port() {
        let port = serialport::SerialPortInfo {
            port_name: "/dev/ttyS0".into(),
            port_type: serialport::SerialPortType::Unknown,
        };
        let info = map_port_info(port);
        assert_eq!(info.port_type, "Unknown");
        assert_eq!(info.description, "Serial Port");
    }

    // ====================================================================
    // list_serial_ports integration test
    // ====================================================================

    #[test]
    fn list_serial_ports_returns_vec() {
        // This test just verifies the function runs without panicking.
        // On CI, there are typically no serial ports, so an empty vec is OK.
        let ports = list_serial_ports();
        // We can't assert specific ports, but we can verify the return type
        assert!(ports.len() <= 256, "Suspiciously many ports");
    }
}
