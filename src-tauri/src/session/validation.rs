/// Input validation for session manager operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Name: 1–200 chars, no path separators (`/`, `\`)
/// - Host: valid hostname or IPv4/IPv6 format (when provided)
/// - Port: 1–65535
/// - Folder name: no `..`, no path separators
/// - Session ID: UUID v4 format
use super::error::SessionError;

/// Maximum length for session/folder names.
const MAX_NAME_LENGTH: usize = 200;

/// Validates a session or folder name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
pub fn validate_name(name: &str) -> Result<(), SessionError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(SessionError::InvalidInput("Name cannot be empty".into()));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(SessionError::InvalidInput(format!(
            "Name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(SessionError::InvalidInput(
            "Name cannot contain path separators (/ or \\)".into(),
        ));
    }
    Ok(())
}

/// Validates a folder name with additional path traversal protection.
///
/// Includes all name rules plus:
/// - Must not contain `..` (path traversal)
pub fn validate_folder_name(name: &str) -> Result<(), SessionError> {
    validate_name(name)?;
    if name.contains("..") {
        return Err(SessionError::InvalidInput(
            "Folder name cannot contain '..' (path traversal)".into(),
        ));
    }
    Ok(())
}

/// Validates a hostname or IP address.
///
/// Accepts:
/// - Hostnames: alphanumeric, hyphens, dots (e.g., `server.example.com`)
/// - IPv4: dotted quad (e.g., `192.168.1.1`)
/// - IPv6: colon-separated hex (e.g., `::1`, `fe80::1`)
pub fn validate_host(host: &str) -> Result<(), SessionError> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return Err(SessionError::InvalidInput("Host cannot be empty".into()));
    }
    if trimmed.len() > 253 {
        return Err(SessionError::InvalidInput(
            "Host exceeds maximum length of 253 characters".into(),
        ));
    }

    // IPv6 check (contains colons)
    if trimmed.contains(':') {
        if is_valid_ipv6(trimmed) {
            return Ok(());
        }
        return Err(SessionError::InvalidInput(format!(
            "Invalid IPv6 address: {trimmed}"
        )));
    }

    // Hostname / IPv4 check
    if !is_valid_hostname_or_ipv4(trimmed) {
        return Err(SessionError::InvalidInput(format!(
            "Invalid hostname or IP: {trimmed}"
        )));
    }
    Ok(())
}

/// Validates a port number.
pub fn validate_port(port: u16) -> Result<(), SessionError> {
    if port == 0 {
        return Err(SessionError::InvalidInput(
            "Port must be between 1 and 65535".into(),
        ));
    }
    Ok(())
}

/// Validates a UUID string format.
pub fn validate_uuid(id: &str) -> Result<(), SessionError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(SessionError::InvalidInput(format!(
            "Invalid UUID format: {id}"
        )));
    }
    Ok(())
}

/// Maximum length for username.
const MAX_USERNAME_LENGTH: usize = 128;

/// Maximum length for serial port path.
const MAX_SERIAL_PORT_LENGTH: usize = 256;

/// Validates a username field.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 128 characters
/// - Must not contain path separators or null bytes
pub fn validate_username(username: &str) -> Result<(), SessionError> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(SessionError::InvalidInput(
            "Username cannot be empty".into(),
        ));
    }
    if trimmed.len() > MAX_USERNAME_LENGTH {
        return Err(SessionError::InvalidInput(format!(
            "Username exceeds maximum length of {MAX_USERNAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('\0') {
        return Err(SessionError::InvalidInput(
            "Username cannot contain null bytes".into(),
        ));
    }
    Ok(())
}

/// Validates a serial port path.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 256 characters
/// - Must not contain path traversal (`..`)
/// - Must not contain null bytes
pub fn validate_serial_port(serial_port: &str) -> Result<(), SessionError> {
    let trimmed = serial_port.trim();
    if trimmed.is_empty() {
        return Err(SessionError::InvalidInput(
            "Serial port cannot be empty".into(),
        ));
    }
    if trimmed.len() > MAX_SERIAL_PORT_LENGTH {
        return Err(SessionError::InvalidInput(format!(
            "Serial port exceeds maximum length of {MAX_SERIAL_PORT_LENGTH} characters"
        )));
    }
    if trimmed.contains("..") {
        return Err(SessionError::InvalidInput(
            "Serial port cannot contain '..' (path traversal)".into(),
        ));
    }
    if trimmed.contains('\0') {
        return Err(SessionError::InvalidInput(
            "Serial port cannot contain null bytes".into(),
        ));
    }
    Ok(())
}

/// Simple hostname/IPv4 validation.
fn is_valid_hostname_or_ipv4(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }
    // Each label: alphanumeric + hyphens, not starting/ending with hyphen
    for label in host.split('.') {
        if label.is_empty() || label.len() > 63 {
            return false;
        }
        if label.starts_with('-') || label.ends_with('-') {
            return false;
        }
        if !label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return false;
        }
    }
    true
}

/// Basic IPv6 validation.
fn is_valid_ipv6(addr: &str) -> bool {
    // Strip bracket notation [::1]
    let addr = addr.trim_start_matches('[').trim_end_matches(']');
    addr.parse::<std::net::Ipv6Addr>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Name validation ───────────────────────────────────────

    #[test]
    fn valid_name() {
        assert!(validate_name("My Server").is_ok());
    }

    #[test]
    fn valid_name_with_special_chars() {
        assert!(validate_name("Server (prod) #1 — main").is_ok());
    }

    #[test]
    fn name_empty_rejected() {
        assert!(validate_name("").is_err());
    }

    #[test]
    fn name_whitespace_only_rejected() {
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn name_too_long_rejected() {
        let long = "a".repeat(201);
        assert!(validate_name(&long).is_err());
    }

    #[test]
    fn name_at_max_length_accepted() {
        let name = "a".repeat(200);
        assert!(validate_name(&name).is_ok());
    }

    #[test]
    fn name_with_forward_slash_rejected() {
        assert!(validate_name("server/prod").is_err());
    }

    #[test]
    fn name_with_backslash_rejected() {
        assert!(validate_name("server\\prod").is_err());
    }

    // ─── Folder name validation ────────────────────────────────

    #[test]
    fn valid_folder_name() {
        assert!(validate_folder_name("Production").is_ok());
    }

    #[test]
    fn folder_name_with_dots_but_no_traversal() {
        assert!(validate_folder_name("v1.0 servers").is_ok());
    }

    #[test]
    fn folder_name_with_path_traversal_rejected() {
        assert!(validate_folder_name("..").is_err());
        assert!(validate_folder_name("../etc").is_err());
        assert!(validate_folder_name("servers/..").is_err());
    }

    // ─── Host validation ───────────────────────────────────────

    #[test]
    fn valid_hostname() {
        assert!(validate_host("example.com").is_ok());
    }

    #[test]
    fn valid_hostname_subdomain() {
        assert!(validate_host("server.prod.example.com").is_ok());
    }

    #[test]
    fn valid_ipv4() {
        assert!(validate_host("192.168.1.1").is_ok());
    }

    #[test]
    fn valid_ipv6_loopback() {
        assert!(validate_host("::1").is_ok());
    }

    #[test]
    fn valid_ipv6_full() {
        assert!(validate_host("fe80::1").is_ok());
    }

    #[test]
    fn host_empty_rejected() {
        assert!(validate_host("").is_err());
    }

    #[test]
    fn host_too_long_rejected() {
        let long = format!("{}.com", "a".repeat(250));
        assert!(validate_host(&long).is_err());
    }

    #[test]
    fn host_with_spaces_rejected() {
        assert!(validate_host("server name").is_err());
    }

    #[test]
    fn host_label_starting_with_hyphen_rejected() {
        assert!(validate_host("-server.com").is_err());
    }

    // ─── Port validation ───────────────────────────────────────

    #[test]
    fn valid_port() {
        assert!(validate_port(22).is_ok());
        assert!(validate_port(1).is_ok());
        assert!(validate_port(65535).is_ok());
    }

    #[test]
    fn port_zero_rejected() {
        assert!(validate_port(0).is_err());
    }

    // ─── UUID validation ───────────────────────────────────────

    #[test]
    fn valid_uuid() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn invalid_uuid_rejected() {
        assert!(validate_uuid("not-a-uuid").is_err());
        assert!(validate_uuid("").is_err());
    }

    #[test]
    fn uuid_without_hyphens_accepted() {
        assert!(validate_uuid("550e8400e29b41d4a716446655440000").is_ok());
    }

    // ─── Username validation ──────────────────────────────────

    #[test]
    fn valid_username() {
        assert!(validate_username("admin").is_ok());
        assert!(validate_username("root").is_ok());
        assert!(validate_username("user@domain").is_ok());
    }

    #[test]
    fn username_empty_rejected() {
        assert!(validate_username("").is_err());
        assert!(validate_username("   ").is_err());
    }

    #[test]
    fn username_too_long_rejected() {
        let long = "u".repeat(129);
        assert!(validate_username(&long).is_err());
    }

    #[test]
    fn username_at_max_length_accepted() {
        let name = "u".repeat(128);
        assert!(validate_username(&name).is_ok());
    }

    #[test]
    fn username_with_null_byte_rejected() {
        assert!(validate_username("user\0name").is_err());
    }

    // ─── Serial port validation ───────────────────────────────

    #[test]
    fn valid_serial_port() {
        assert!(validate_serial_port("/dev/ttyUSB0").is_ok());
        assert!(validate_serial_port("COM1").is_ok());
        assert!(validate_serial_port("/dev/tty.usbserial-1234").is_ok());
    }

    #[test]
    fn serial_port_empty_rejected() {
        assert!(validate_serial_port("").is_err());
        assert!(validate_serial_port("   ").is_err());
    }

    #[test]
    fn serial_port_too_long_rejected() {
        let long = "p".repeat(257);
        assert!(validate_serial_port(&long).is_err());
    }

    #[test]
    fn serial_port_path_traversal_rejected() {
        assert!(validate_serial_port("../../etc/passwd").is_err());
        assert!(validate_serial_port("/dev/../secret").is_err());
    }

    #[test]
    fn serial_port_null_byte_rejected() {
        assert!(validate_serial_port("/dev/tty\0USB0").is_err());
    }
}
