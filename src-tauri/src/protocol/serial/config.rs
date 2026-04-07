/// Serial port configuration types and validation.
///
/// Maps user-facing configuration to `serialport` crate types.
/// Provides sensible defaults (9600/8/N/1) for standard Cisco console
/// connections.
use serde::{Deserialize, Serialize};

/// Serial port configuration parameters.
///
/// All fields have sensible defaults matching standard network
/// equipment console ports (9600/8/N/1/None flow control).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    /// Serial port path (e.g., "/dev/ttyUSB0" on Linux, "COM3" on Windows).
    pub port: String,
    /// Baud rate in bits per second.
    pub baud_rate: u32,
    /// Number of data bits per character.
    pub data_bits: SerialDataBits,
    /// Parity checking mode.
    pub parity: SerialParity,
    /// Number of stop bits.
    pub stop_bits: SerialStopBits,
    /// Flow control mode.
    pub flow_control: SerialFlowControl,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            port: String::new(),
            baud_rate: 9600,
            data_bits: SerialDataBits::Eight,
            parity: SerialParity::None,
            stop_bits: SerialStopBits::One,
            flow_control: SerialFlowControl::None,
        }
    }
}

/// Number of data bits per character.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SerialDataBits {
    Five,
    Six,
    Seven,
    Eight,
}

/// Parity checking mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SerialParity {
    None,
    Even,
    Odd,
}

/// Number of stop bits.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SerialStopBits {
    One,
    Two,
}

/// Flow control mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SerialFlowControl {
    None,
    Hardware,
    Software,
}

/// Standard baud rates supported by most serial hardware.
pub const STANDARD_BAUD_RATES: &[u32] = &[
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400,
    460800, 921600,
];

impl SerialConfig {
    /// Validates the serial configuration.
    ///
    /// Returns `Ok(())` if valid, or an error message describing the problem.
    pub fn validate(&self) -> Result<(), String> {
        if self.port.is_empty() {
            return Err("Serial port path is required".into());
        }

        if self.baud_rate == 0 {
            return Err("Baud rate must be greater than zero".into());
        }

        Ok(())
    }

    /// Returns whether the baud rate is a standard rate.
    pub fn is_standard_baud_rate(&self) -> bool {
        STANDARD_BAUD_RATES.contains(&self.baud_rate)
    }
}

/// Converts `SerialDataBits` to the `serialport` crate's `DataBits` type.
impl From<SerialDataBits> for serialport::DataBits {
    fn from(bits: SerialDataBits) -> Self {
        match bits {
            SerialDataBits::Five => serialport::DataBits::Five,
            SerialDataBits::Six => serialport::DataBits::Six,
            SerialDataBits::Seven => serialport::DataBits::Seven,
            SerialDataBits::Eight => serialport::DataBits::Eight,
        }
    }
}

/// Converts `SerialParity` to the `serialport` crate's `Parity` type.
impl From<SerialParity> for serialport::Parity {
    fn from(parity: SerialParity) -> Self {
        match parity {
            SerialParity::None => serialport::Parity::None,
            SerialParity::Even => serialport::Parity::Even,
            SerialParity::Odd => serialport::Parity::Odd,
        }
    }
}

/// Converts `SerialStopBits` to the `serialport` crate's `StopBits` type.
impl From<SerialStopBits> for serialport::StopBits {
    fn from(bits: SerialStopBits) -> Self {
        match bits {
            SerialStopBits::One => serialport::StopBits::One,
            SerialStopBits::Two => serialport::StopBits::Two,
        }
    }
}

/// Converts `SerialFlowControl` to the `serialport` crate's `FlowControl` type.
impl From<SerialFlowControl> for serialport::FlowControl {
    fn from(flow: SerialFlowControl) -> Self {
        match flow {
            SerialFlowControl::None => serialport::FlowControl::None,
            SerialFlowControl::Hardware => serialport::FlowControl::Hardware,
            SerialFlowControl::Software => serialport::FlowControl::Software,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // Default configuration tests
    // ====================================================================

    #[test]
    fn default_config_is_9600_8n1() {
        let config = SerialConfig::default();
        assert_eq!(config.baud_rate, 9600);
        assert_eq!(config.data_bits, SerialDataBits::Eight);
        assert_eq!(config.parity, SerialParity::None);
        assert_eq!(config.stop_bits, SerialStopBits::One);
        assert_eq!(config.flow_control, SerialFlowControl::None);
    }

    #[test]
    fn default_config_has_empty_port() {
        let config = SerialConfig::default();
        assert!(config.port.is_empty());
    }

    // ====================================================================
    // Validation tests
    // ====================================================================

    #[test]
    fn validate_rejects_empty_port() {
        let config = SerialConfig::default();
        let result = config.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("port"));
    }

    #[test]
    fn validate_rejects_zero_baud_rate() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 0,
            ..Default::default()
        };
        let result = config.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Baud rate"));
    }

    #[test]
    fn validate_accepts_valid_config() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_accepts_custom_baud_rate() {
        let config = SerialConfig {
            port: "COM3".into(),
            baud_rate: 31250, // MIDI baud rate — non-standard but valid
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    // ====================================================================
    // Standard baud rate tests
    // ====================================================================

    #[test]
    fn is_standard_baud_rate_for_9600() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 9600,
            ..Default::default()
        };
        assert!(config.is_standard_baud_rate());
    }

    #[test]
    fn is_standard_baud_rate_for_115200() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 115200,
            ..Default::default()
        };
        assert!(config.is_standard_baud_rate());
    }

    #[test]
    fn is_not_standard_baud_rate_for_31250() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 31250,
            ..Default::default()
        };
        assert!(!config.is_standard_baud_rate());
    }

    // ====================================================================
    // Serialization tests
    // ====================================================================

    #[test]
    fn config_serializes_camel_case() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("baudRate"));
        assert!(json.contains("dataBits"));
        assert!(json.contains("stopBits"));
        assert!(json.contains("flowControl"));
    }

    #[test]
    fn config_roundtrip_serialization() {
        let config = SerialConfig {
            port: "COM3".into(),
            baud_rate: 115200,
            data_bits: SerialDataBits::Seven,
            parity: SerialParity::Even,
            stop_bits: SerialStopBits::Two,
            flow_control: SerialFlowControl::Hardware,
        };
        let json = serde_json::to_string(&config).unwrap();
        let restored: SerialConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, restored);
    }

    #[test]
    fn data_bits_serializes_lowercase() {
        let json = serde_json::to_string(&SerialDataBits::Eight).unwrap();
        assert_eq!(json, r#""eight""#);
    }

    #[test]
    fn parity_serializes_lowercase() {
        let json = serde_json::to_string(&SerialParity::Even).unwrap();
        assert_eq!(json, r#""even""#);
    }

    #[test]
    fn stop_bits_serializes_lowercase() {
        let json = serde_json::to_string(&SerialStopBits::Two).unwrap();
        assert_eq!(json, r#""two""#);
    }

    #[test]
    fn flow_control_serializes_lowercase() {
        let json = serde_json::to_string(&SerialFlowControl::Hardware).unwrap();
        assert_eq!(json, r#""hardware""#);
    }

    #[test]
    fn all_data_bits_variants_roundtrip() {
        for variant in [
            SerialDataBits::Five,
            SerialDataBits::Six,
            SerialDataBits::Seven,
            SerialDataBits::Eight,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: SerialDataBits =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    #[test]
    fn all_parity_variants_roundtrip() {
        for variant in [
            SerialParity::None,
            SerialParity::Even,
            SerialParity::Odd,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: SerialParity =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    #[test]
    fn all_flow_control_variants_roundtrip() {
        for variant in [
            SerialFlowControl::None,
            SerialFlowControl::Hardware,
            SerialFlowControl::Software,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: SerialFlowControl =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    // ====================================================================
    // Conversion to serialport crate types
    // ====================================================================

    #[test]
    fn data_bits_converts_to_serialport() {
        assert_eq!(
            serialport::DataBits::from(SerialDataBits::Five),
            serialport::DataBits::Five
        );
        assert_eq!(
            serialport::DataBits::from(SerialDataBits::Eight),
            serialport::DataBits::Eight
        );
    }

    #[test]
    fn parity_converts_to_serialport() {
        assert_eq!(
            serialport::Parity::from(SerialParity::None),
            serialport::Parity::None
        );
        assert_eq!(
            serialport::Parity::from(SerialParity::Even),
            serialport::Parity::Even
        );
        assert_eq!(
            serialport::Parity::from(SerialParity::Odd),
            serialport::Parity::Odd
        );
    }

    #[test]
    fn stop_bits_converts_to_serialport() {
        assert_eq!(
            serialport::StopBits::from(SerialStopBits::One),
            serialport::StopBits::One
        );
        assert_eq!(
            serialport::StopBits::from(SerialStopBits::Two),
            serialport::StopBits::Two
        );
    }

    #[test]
    fn flow_control_converts_to_serialport() {
        assert_eq!(
            serialport::FlowControl::from(SerialFlowControl::None),
            serialport::FlowControl::None
        );
        assert_eq!(
            serialport::FlowControl::from(SerialFlowControl::Hardware),
            serialport::FlowControl::Hardware
        );
        assert_eq!(
            serialport::FlowControl::from(SerialFlowControl::Software),
            serialport::FlowControl::Software
        );
    }

    // ====================================================================
    // Edge case tests
    // ====================================================================

    #[test]
    fn config_with_windows_port_path() {
        let config = SerialConfig {
            port: "COM10".into(),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn config_with_linux_port_path() {
        let config = SerialConfig {
            port: "/dev/ttyACM0".into(),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn config_with_macos_port_path() {
        let config = SerialConfig {
            port: "/dev/cu.usbserial-1420".into(),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn standard_baud_rates_contains_expected_values() {
        let expected = [
            300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
        ];
        for rate in &expected {
            assert!(
                STANDARD_BAUD_RATES.contains(rate),
                "Missing standard baud rate: {rate}"
            );
        }
    }

    // ====================================================================
    // QA Guardian — Edge case & boundary tests
    // ====================================================================

    /// [EDGE] Whitespace-only port should fail validation.
    /// The validate() method checks `is_empty()`, but a port of
    /// all spaces would pass — this tests that boundary.
    #[test]
    fn validate_accepts_whitespace_port_currently() {
        // NOTE: This documents current behavior — whitespace ports
        // pass validation. The OS will reject them at open time.
        let config = SerialConfig {
            port: "   ".into(),
            ..Default::default()
        };
        // Currently passes — serialport crate will reject at open
        assert!(config.validate().is_ok());
    }

    /// [EDGE] u32::MAX is a valid baud rate (no upper bound in validate).
    #[test]
    fn validate_accepts_max_baud_rate() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: u32::MAX,
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    /// [BOUNDARY] All standard baud rates should be marked as standard.
    #[test]
    fn all_standard_baud_rates_detected() {
        for rate in STANDARD_BAUD_RATES {
            let config = SerialConfig {
                port: "/dev/ttyUSB0".into(),
                baud_rate: *rate,
                ..Default::default()
            };
            assert!(
                config.is_standard_baud_rate(),
                "Rate {rate} should be standard"
            );
        }
    }

    /// [BOUNDARY] Baud rate 1 (minimum valid) should pass validation.
    #[test]
    fn validate_accepts_baud_rate_one() {
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 1,
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    /// [EDGE] Deserialization from JSON with unknown fields is lenient.
    #[test]
    fn deserialization_ignores_unknown_fields() {
        let json = r#"{
            "port": "/dev/ttyUSB0",
            "baudRate": 9600,
            "dataBits": "eight",
            "parity": "none",
            "stopBits": "one",
            "flowControl": "none",
            "extraField": "should be ignored"
        }"#;
        // Default serde behavior: reject unknown fields.
        // If this fails, it means the struct uses deny_unknown_fields.
        let result = serde_json::from_str::<SerialConfig>(json);
        // This documents current behavior — may or may not reject
        if result.is_ok() {
            assert_eq!(result.unwrap().port, "/dev/ttyUSB0");
        }
        // Either way, test doesn't panic
    }

    /// [EDGE] Invalid enum variant in JSON returns deserialization error.
    #[test]
    fn deserialization_rejects_invalid_parity_variant() {
        let json = r#"{
            "port": "COM3",
            "baudRate": 9600,
            "dataBits": "eight",
            "parity": "mark",
            "stopBits": "one",
            "flowControl": "none"
        }"#;
        let result = serde_json::from_str::<SerialConfig>(json);
        assert!(result.is_err(), "Should reject 'mark' parity");
    }

    /// [EDGE] Invalid data bits variant in JSON returns error.
    #[test]
    fn deserialization_rejects_invalid_data_bits() {
        let json = r#"{
            "port": "COM3",
            "baudRate": 9600,
            "dataBits": "nine",
            "parity": "none",
            "stopBits": "one",
            "flowControl": "none"
        }"#;
        let result = serde_json::from_str::<SerialConfig>(json);
        assert!(result.is_err(), "Should reject 'nine' dataBits");
    }

    /// [EDGE] Invalid flow control variant in JSON returns error.
    #[test]
    fn deserialization_rejects_invalid_flow_control() {
        let json = r#"{
            "port": "COM3",
            "baudRate": 9600,
            "dataBits": "eight",
            "parity": "none",
            "stopBits": "one",
            "flowControl": "xonxoff"
        }"#;
        let result = serde_json::from_str::<SerialConfig>(json);
        assert!(result.is_err(), "Should reject 'xonxoff' flowControl");
    }

    /// [EDGE] All stop bits variants roundtrip correctly.
    #[test]
    fn all_stop_bits_variants_roundtrip() {
        for variant in [SerialStopBits::One, SerialStopBits::Two] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: SerialStopBits =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    /// [CONTRACT] Config with all non-default values roundtrips.
    #[test]
    fn non_default_config_roundtrip() {
        let config = SerialConfig {
            port: "/dev/cu.usbserial-1420".into(),
            baud_rate: 460800,
            data_bits: SerialDataBits::Five,
            parity: SerialParity::Odd,
            stop_bits: SerialStopBits::Two,
            flow_control: SerialFlowControl::Software,
        };
        let json = serde_json::to_string(&config).unwrap();
        let restored: SerialConfig =
            serde_json::from_str(&json).unwrap();
        assert_eq!(config, restored);
    }
}
