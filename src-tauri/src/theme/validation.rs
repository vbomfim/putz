/// Input validation for theme operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Name: 1–200 chars, no path separators
/// - Colors: valid 3/6/8-digit hex format (#RGB, #RRGGBB, or #RRGGBBAA)
use super::error::ThemeError;

/// Maximum length for theme names.
const MAX_NAME_LENGTH: usize = 200;

/// Validates a theme name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
pub fn validate_name(name: &str) -> Result<(), ThemeError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ThemeError::InvalidInput("Name cannot be empty".into()));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(ThemeError::InvalidInput(format!(
            "Name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(ThemeError::InvalidInput(
            "Name cannot contain path separators (/ or \\)".into(),
        ));
    }
    Ok(())
}

/// Validates a hex color string.
///
/// Accepts:
/// - 3-digit hex: `#RGB`
/// - 6-digit hex: `#RRGGBB`
/// - 8-digit hex: `#RRGGBBAA` (with alpha for selections)
/// - Empty string (for optional/transparent colors)
pub fn validate_hex_color(color: &str, field_name: &str) -> Result<(), ThemeError> {
    if color.is_empty() {
        return Ok(());
    }
    if !color.starts_with('#') {
        return Err(ThemeError::InvalidInput(format!(
            "{field_name}: color must start with '#': {color}"
        )));
    }
    let hex = &color[1..];
    if hex.len() != 3 && hex.len() != 6 && hex.len() != 8 {
        return Err(ThemeError::InvalidInput(format!(
            "{field_name}: color must be #RGB, #RRGGBB, or #RRGGBBAA format: {color}"
        )));
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ThemeError::InvalidInput(format!(
            "{field_name}: color contains invalid hex characters: {color}"
        )));
    }
    Ok(())
}

/// Validates all 22 colors in a ThemeColors struct.
pub fn validate_all_colors(colors: &super::models::ThemeColors) -> Result<(), ThemeError> {
    validate_hex_color(&colors.foreground, "foreground")?;
    validate_hex_color(&colors.background, "background")?;
    validate_hex_color(&colors.cursor, "cursor")?;
    validate_hex_color(&colors.cursor_accent, "cursorAccent")?;
    validate_hex_color(&colors.selection_background, "selectionBackground")?;
    validate_hex_color(&colors.selection_foreground, "selectionForeground")?;
    validate_hex_color(&colors.black, "black")?;
    validate_hex_color(&colors.red, "red")?;
    validate_hex_color(&colors.green, "green")?;
    validate_hex_color(&colors.yellow, "yellow")?;
    validate_hex_color(&colors.blue, "blue")?;
    validate_hex_color(&colors.magenta, "magenta")?;
    validate_hex_color(&colors.cyan, "cyan")?;
    validate_hex_color(&colors.white, "white")?;
    validate_hex_color(&colors.bright_black, "brightBlack")?;
    validate_hex_color(&colors.bright_red, "brightRed")?;
    validate_hex_color(&colors.bright_green, "brightGreen")?;
    validate_hex_color(&colors.bright_yellow, "brightYellow")?;
    validate_hex_color(&colors.bright_blue, "brightBlue")?;
    validate_hex_color(&colors.bright_magenta, "brightMagenta")?;
    validate_hex_color(&colors.bright_cyan, "brightCyan")?;
    validate_hex_color(&colors.bright_white, "brightWhite")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::models::ThemeColors;

    // ─── Name validation ───────────────────────────────────────

    #[test]
    fn valid_name() {
        assert!(validate_name("Solarized Dark").is_ok());
    }

    #[test]
    fn valid_name_with_special_chars() {
        assert!(validate_name("My Theme (v2) — custom").is_ok());
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
        assert!(validate_name("theme/dark").is_err());
    }

    #[test]
    fn name_with_backslash_rejected() {
        assert!(validate_name("theme\\dark").is_err());
    }

    // ─── Hex color validation ──────────────────────────────────

    #[test]
    fn valid_hex_6_digit() {
        assert!(validate_hex_color("#FF5555", "test").is_ok());
    }

    #[test]
    fn valid_hex_3_digit() {
        assert!(validate_hex_color("#F00", "test").is_ok());
    }

    #[test]
    fn valid_hex_8_digit_alpha() {
        assert!(validate_hex_color("#0f346080", "test").is_ok());
    }

    #[test]
    fn valid_hex_lowercase() {
        assert!(validate_hex_color("#ff5555", "test").is_ok());
    }

    #[test]
    fn empty_color_accepted() {
        assert!(validate_hex_color("", "test").is_ok());
    }

    #[test]
    fn color_missing_hash_rejected() {
        assert!(validate_hex_color("FF5555", "test").is_err());
    }

    #[test]
    fn color_wrong_length_rejected() {
        assert!(validate_hex_color("#FF55", "test").is_err());
        assert!(validate_hex_color("#FF55550", "test").is_err());
    }

    #[test]
    fn color_invalid_hex_chars_rejected() {
        assert!(validate_hex_color("#GGGGGG", "test").is_err());
        assert!(validate_hex_color("#XY1234", "test").is_err());
    }

    #[test]
    fn color_error_includes_field_name() {
        let result = validate_hex_color("bad", "foreground");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("foreground"));
    }

    // ─── All-colors validation ────────────────────────────────

    #[test]
    fn valid_colors_pass() {
        let colors = ThemeColors {
            foreground: "#e0e0e0".into(),
            background: "#1a1a2e".into(),
            cursor: "#e0e0e0".into(),
            cursor_accent: "#1a1a2e".into(),
            selection_background: "#0f346080".into(),
            selection_foreground: String::new(),
            black: "#1a1a2e".into(),
            red: "#ff5555".into(),
            green: "#50fa7b".into(),
            yellow: "#f1fa8c".into(),
            blue: "#6272a4".into(),
            magenta: "#ff79c6".into(),
            cyan: "#8be9fd".into(),
            white: "#e0e0e0".into(),
            bright_black: "#6272a4".into(),
            bright_red: "#ff6e6e".into(),
            bright_green: "#69ff94".into(),
            bright_yellow: "#ffffa5".into(),
            bright_blue: "#d6acff".into(),
            bright_magenta: "#ff92df".into(),
            bright_cyan: "#a4ffff".into(),
            bright_white: "#ffffff".into(),
        };
        assert!(validate_all_colors(&colors).is_ok());
    }

    #[test]
    fn invalid_foreground_caught() {
        let mut colors = ThemeColors {
            foreground: "bad".into(),
            background: "#000".into(),
            cursor: "#fff".into(),
            cursor_accent: "#000".into(),
            selection_background: "#333".into(),
            selection_foreground: String::new(),
            black: "#000".into(),
            red: "#f00".into(),
            green: "#0f0".into(),
            yellow: "#ff0".into(),
            blue: "#00f".into(),
            magenta: "#f0f".into(),
            cyan: "#0ff".into(),
            white: "#fff".into(),
            bright_black: "#888".into(),
            bright_red: "#f88".into(),
            bright_green: "#8f8".into(),
            bright_yellow: "#ff8".into(),
            bright_blue: "#88f".into(),
            bright_magenta: "#f8f".into(),
            bright_cyan: "#8ff".into(),
            bright_white: "#fff".into(),
        };
        let result = validate_all_colors(&colors);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("foreground"));

        // Fix foreground, break a later field
        colors.foreground = "#fff".into();
        colors.bright_cyan = "nope".into();
        let result2 = validate_all_colors(&colors);
        assert!(result2.is_err());
        assert!(result2.unwrap_err().to_string().contains("brightCyan"));
    }
}
