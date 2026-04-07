/// Theme data models for terminal color scheme configuration.
///
/// These types are serialized to/from JSON for persistence (themes.json)
/// and cross the IPC boundary to the React frontend.
use serde::{Deserialize, Serialize};

/// The 22 terminal colors that compose a theme.
///
/// Matches xterm.js `ITheme` interface:
/// - 16 ANSI colors (black through brightWhite)
/// - foreground, background, cursor, cursorAccent
/// - selectionBackground, selectionForeground
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
    /// Terminal foreground text color.
    pub foreground: String,
    /// Terminal background color.
    pub background: String,
    /// Cursor color.
    pub cursor: String,
    /// Cursor accent (text under cursor).
    pub cursor_accent: String,
    /// Selection background color (supports alpha via #RRGGBBAA).
    pub selection_background: String,
    /// Selection foreground color (empty = auto).
    #[serde(default)]
    pub selection_foreground: String,
    /// ANSI color 0 — Black.
    pub black: String,
    /// ANSI color 1 — Red.
    pub red: String,
    /// ANSI color 2 — Green.
    pub green: String,
    /// ANSI color 3 — Yellow.
    pub yellow: String,
    /// ANSI color 4 — Blue.
    pub blue: String,
    /// ANSI color 5 — Magenta.
    pub magenta: String,
    /// ANSI color 6 — Cyan.
    pub cyan: String,
    /// ANSI color 7 — White.
    pub white: String,
    /// ANSI color 8 — Bright Black.
    pub bright_black: String,
    /// ANSI color 9 — Bright Red.
    pub bright_red: String,
    /// ANSI color 10 — Bright Green.
    pub bright_green: String,
    /// ANSI color 11 — Bright Yellow.
    pub bright_yellow: String,
    /// ANSI color 12 — Bright Blue.
    pub bright_blue: String,
    /// ANSI color 13 — Bright Magenta.
    pub bright_magenta: String,
    /// ANSI color 14 — Bright Cyan.
    pub bright_cyan: String,
    /// ANSI color 15 — Bright White.
    pub bright_white: String,
}

/// A named terminal color theme.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    /// Unique theme identifier (UUID v4 or builtin-* for built-ins).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// The 22 terminal colors.
    pub colors: ThemeColors,
    /// Whether this is a built-in theme (cannot be deleted or renamed).
    #[serde(default)]
    pub is_builtin: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-modified timestamp.
    pub updated_at: String,
}

/// Top-level store serialized to themes.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeStore {
    pub version: u32,
    pub themes: Vec<Theme>,
}

impl Default for ThemeStore {
    fn default() -> Self {
        Self {
            version: 1,
            themes: Vec::new(),
        }
    }
}

/// Input DTO for creating a new theme (no id, timestamps auto-generated).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThemeInput {
    pub name: String,
    pub colors: ThemeColors,
}

/// Input DTO for updating an existing theme (partial — only non-None fields apply).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThemeInput {
    pub name: Option<String>,
    pub colors: Option<ThemeColors>,
}

/// DTO for importing a theme from JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeExport {
    /// Export format version.
    pub version: u32,
    /// Theme name.
    pub name: String,
    /// The 22 terminal colors.
    pub colors: ThemeColors,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_colors() -> ThemeColors {
        ThemeColors {
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
        }
    }

    #[test]
    fn theme_colors_serializes_camel_case() {
        let colors = sample_colors();
        let json = serde_json::to_string(&colors).unwrap();
        assert!(json.contains("cursorAccent"));
        assert!(json.contains("selectionBackground"));
        assert!(json.contains("selectionForeground"));
        assert!(json.contains("brightBlack"));
        assert!(json.contains("brightWhite"));
    }

    #[test]
    fn theme_colors_roundtrip() {
        let colors = sample_colors();
        let json = serde_json::to_string(&colors).unwrap();
        let restored: ThemeColors = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, colors);
    }

    #[test]
    fn theme_colors_selection_foreground_defaults_empty() {
        let json = r##"{
            "foreground":"#fff","background":"#000","cursor":"#fff",
            "cursorAccent":"#000","selectionBackground":"#333",
            "black":"#000","red":"#f00","green":"#0f0","yellow":"#ff0",
            "blue":"#00f","magenta":"#f0f","cyan":"#0ff","white":"#fff",
            "brightBlack":"#888","brightRed":"#f88","brightGreen":"#8f8",
            "brightYellow":"#ff8","brightBlue":"#88f","brightMagenta":"#f8f",
            "brightCyan":"#8ff","brightWhite":"#fff"
        }"##;
        let colors: ThemeColors = serde_json::from_str(json).unwrap();
        assert_eq!(colors.selection_foreground, "");
    }

    #[test]
    fn theme_serializes_camel_case() {
        let theme = Theme {
            id: "theme-1".into(),
            name: "Test Theme".into(),
            colors: sample_colors(),
            is_builtin: true,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&theme).unwrap();
        assert!(json.contains("isBuiltin"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
    }

    #[test]
    fn theme_roundtrip() {
        let theme = Theme {
            id: "theme-1".into(),
            name: "Roundtrip Theme".into(),
            colors: sample_colors(),
            is_builtin: false,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&theme).unwrap();
        let restored: Theme = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "theme-1");
        assert_eq!(restored.name, "Roundtrip Theme");
        assert_eq!(restored.colors, theme.colors);
        assert!(!restored.is_builtin);
    }

    #[test]
    fn theme_store_default_is_empty() {
        let store = ThemeStore::default();
        assert_eq!(store.version, 1);
        assert!(store.themes.is_empty());
    }

    #[test]
    fn theme_store_roundtrip() {
        let store = ThemeStore {
            version: 1,
            themes: vec![Theme {
                id: "t1".into(),
                name: "Test".into(),
                colors: sample_colors(),
                is_builtin: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            }],
        };
        let json = serde_json::to_string_pretty(&store).unwrap();
        let restored: ThemeStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.themes.len(), 1);
    }

    #[test]
    fn create_theme_input_deserializes() {
        let json = r##"{
            "name": "My Theme",
            "colors": {
                "foreground":"#fff","background":"#000","cursor":"#fff",
                "cursorAccent":"#000","selectionBackground":"#333",
                "black":"#000","red":"#f00","green":"#0f0","yellow":"#ff0",
                "blue":"#00f","magenta":"#f0f","cyan":"#0ff","white":"#fff",
                "brightBlack":"#888","brightRed":"#f88","brightGreen":"#8f8",
                "brightYellow":"#ff8","brightBlue":"#88f","brightMagenta":"#f8f",
                "brightCyan":"#8ff","brightWhite":"#fff"
            }
        }"##;
        let input: CreateThemeInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "My Theme");
        assert_eq!(input.colors.foreground, "#fff");
    }

    #[test]
    fn update_theme_input_partial() {
        let json = r#"{"name": "Updated Name"}"#;
        let input: UpdateThemeInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, Some("Updated Name".into()));
        assert!(input.colors.is_none());
    }

    #[test]
    fn theme_export_roundtrip() {
        let export = ThemeExport {
            version: 1,
            name: "Exported".into(),
            colors: sample_colors(),
        };
        let json = serde_json::to_string(&export).unwrap();
        let restored: ThemeExport = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.name, "Exported");
        assert_eq!(restored.colors, export.colors);
    }
}
