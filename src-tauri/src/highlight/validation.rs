/// Input validation for highlight manager operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Name: 1–200 chars, no path separators
/// - Colors: valid 3/6-digit hex format (#RGB or #RRGGBB)
/// - Pattern: non-empty, valid regex if match type is Regex
/// - Priority: 0–999
use super::error::HighlightError;
use super::models::MatchType;

/// Maximum length for highlight set/rule names.
const MAX_NAME_LENGTH: usize = 200;

/// Maximum length for a pattern string.
const MAX_PATTERN_LENGTH: usize = 1000;

/// Maximum priority value.
const MAX_PRIORITY: u16 = 999;

/// Maximum number of rules per highlight set.
const MAX_RULES_PER_SET: usize = 100;

/// Validates a highlight set name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
pub fn validate_name(name: &str) -> Result<(), HighlightError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(HighlightError::InvalidInput("Name cannot be empty".into()));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(HighlightError::InvalidInput(format!(
            "Name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(HighlightError::InvalidInput(
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
/// - Empty string (for transparent/no color)
pub fn validate_hex_color(color: &str) -> Result<(), HighlightError> {
    if color.is_empty() {
        return Ok(());
    }
    if !color.starts_with('#') {
        return Err(HighlightError::InvalidInput(format!(
            "Color must start with '#': {color}"
        )));
    }
    let hex = &color[1..];
    if hex.len() != 3 && hex.len() != 6 {
        return Err(HighlightError::InvalidInput(format!(
            "Color must be #RGB or #RRGGBB format: {color}"
        )));
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(HighlightError::InvalidInput(format!(
            "Color contains invalid hex characters: {color}"
        )));
    }
    Ok(())
}

/// Validates a highlight pattern string.
///
/// Rules:
/// - Must not be empty
/// - Must not exceed 1000 characters
/// - If match_type is Regex, must compile as a valid regex
pub fn validate_pattern(pattern: &str, match_type: &MatchType) -> Result<(), HighlightError> {
    if pattern.is_empty() {
        return Err(HighlightError::InvalidInput(
            "Pattern cannot be empty".into(),
        ));
    }
    if pattern.len() > MAX_PATTERN_LENGTH {
        return Err(HighlightError::InvalidInput(format!(
            "Pattern exceeds maximum length of {MAX_PATTERN_LENGTH} characters"
        )));
    }
    if *match_type == MatchType::Regex {
        // Validate regex compiles successfully
        if let Err(e) = regex::Regex::new(pattern) {
            return Err(HighlightError::InvalidInput(format!(
                "Invalid regex pattern: {e}"
            )));
        }
    }
    Ok(())
}

/// Validates a priority value.
pub fn validate_priority(priority: u16) -> Result<(), HighlightError> {
    if priority > MAX_PRIORITY {
        return Err(HighlightError::InvalidInput(format!(
            "Priority must be between 0 and {MAX_PRIORITY}"
        )));
    }
    Ok(())
}

/// Validates the number of rules in a set.
pub fn validate_rules_count(count: usize) -> Result<(), HighlightError> {
    if count > MAX_RULES_PER_SET {
        return Err(HighlightError::InvalidInput(format!(
            "Too many rules: maximum is {MAX_RULES_PER_SET} per set"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Name validation ───────────────────────────────────────

    #[test]
    fn valid_name() {
        assert!(validate_name("Cisco IOS").is_ok());
    }

    #[test]
    fn valid_name_with_special_chars() {
        assert!(validate_name("My Rules (v2) — production").is_ok());
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
        assert!(validate_name("rules/prod").is_err());
    }

    #[test]
    fn name_with_backslash_rejected() {
        assert!(validate_name("rules\\prod").is_err());
    }

    // ─── Hex color validation ──────────────────────────────────

    #[test]
    fn valid_hex_6_digit() {
        assert!(validate_hex_color("#FF5555").is_ok());
    }

    #[test]
    fn valid_hex_3_digit() {
        assert!(validate_hex_color("#F00").is_ok());
    }

    #[test]
    fn valid_hex_lowercase() {
        assert!(validate_hex_color("#ff5555").is_ok());
    }

    #[test]
    fn empty_color_accepted() {
        assert!(validate_hex_color("").is_ok());
    }

    #[test]
    fn color_missing_hash_rejected() {
        assert!(validate_hex_color("FF5555").is_err());
    }

    #[test]
    fn color_wrong_length_rejected() {
        assert!(validate_hex_color("#FF55").is_err());
        assert!(validate_hex_color("#FF555500").is_err());
    }

    #[test]
    fn color_invalid_hex_chars_rejected() {
        assert!(validate_hex_color("#GGGGGG").is_err());
        assert!(validate_hex_color("#XY1234").is_err());
    }

    // ─── Pattern validation ────────────────────────────────────

    #[test]
    fn valid_exact_pattern() {
        assert!(validate_pattern("ERROR", &MatchType::Exact).is_ok());
    }

    #[test]
    fn valid_regex_pattern() {
        assert!(validate_pattern(r"\d+\.\d+\.\d+\.\d+", &MatchType::Regex).is_ok());
    }

    #[test]
    fn valid_wildcard_pattern() {
        assert!(validate_pattern("*error*", &MatchType::Wildcard).is_ok());
    }

    #[test]
    fn pattern_empty_rejected() {
        assert!(validate_pattern("", &MatchType::Exact).is_err());
    }

    #[test]
    fn pattern_too_long_rejected() {
        let long = "a".repeat(1001);
        assert!(validate_pattern(&long, &MatchType::Exact).is_err());
    }

    #[test]
    fn pattern_at_max_length_accepted() {
        let pat = "a".repeat(1000);
        assert!(validate_pattern(&pat, &MatchType::Exact).is_ok());
    }

    #[test]
    fn invalid_regex_rejected() {
        assert!(validate_pattern("[invalid", &MatchType::Regex).is_err());
    }

    #[test]
    fn invalid_regex_pattern_not_checked_for_exact() {
        // "[invalid" is a bad regex but fine as exact match
        assert!(validate_pattern("[invalid", &MatchType::Exact).is_ok());
    }

    #[test]
    fn invalid_regex_pattern_not_checked_for_wildcard() {
        assert!(validate_pattern("[invalid", &MatchType::Wildcard).is_ok());
    }

    // ─── Priority validation ───────────────────────────────────

    #[test]
    fn valid_priority() {
        assert!(validate_priority(0).is_ok());
        assert!(validate_priority(500).is_ok());
        assert!(validate_priority(999).is_ok());
    }

    #[test]
    fn priority_too_high_rejected() {
        assert!(validate_priority(1000).is_err());
    }

    // ─── Rules count validation ────────────────────────────────

    #[test]
    fn valid_rules_count() {
        assert!(validate_rules_count(0).is_ok());
        assert!(validate_rules_count(50).is_ok());
        assert!(validate_rules_count(100).is_ok());
    }

    #[test]
    fn too_many_rules_rejected() {
        assert!(validate_rules_count(101).is_err());
    }
}
