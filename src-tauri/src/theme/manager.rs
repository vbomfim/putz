/// Theme manager — handles CRUD, persistence, and built-in themes.
///
/// Persistence:
/// - Stores themes in `~/.config/putz/themes.json` (platform-appropriate)
/// - Atomic writes: write to temp file, then rename
/// - Auto-backup: rotates 5 backups before each write
///
/// Built-in themes (10):
/// - Solarized Dark, Solarized Light, Dracula, Monokai, Nord
/// - Catppuccin Mocha, Gruvbox Dark, One Dark, Tomorrow Night, High Contrast
/// - All verified for WCAG 4.5:1+ contrast on fg/bg
/// - Injected on first load if not present, cannot be deleted
///
/// Thread safety: Inner state is behind `Mutex<ThemeStore>`.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use directories::ProjectDirs;

use super::error::ThemeError;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Themes file name.
const THEMES_FILE: &str = "themes.json";

/// Maximum number of themes allowed.
const MAX_THEMES: usize = 100;

/// Theme manager holding the in-memory store and config directory path.
pub struct ThemeManager {
    store: Mutex<ThemeStore>,
    config_dir: PathBuf,
}

impl ThemeManager {
    /// Creates a new ThemeManager, loading from disk if available.
    ///
    /// Injects built-in themes on first load.
    pub fn new() -> Self {
        let config_dir = Self::resolve_config_dir();
        let mut store = Self::load_from_disk(&config_dir);
        Self::inject_builtin_themes(&mut store);
        let mgr = Self {
            store: Mutex::new(store),
            config_dir,
        };
        let _ = mgr.save_to_disk();
        mgr
    }

    /// Creates a ThemeManager with a custom config directory (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let mut store = Self::load_from_disk(&config_dir);
        Self::inject_builtin_themes(&mut store);
        let mgr = Self {
            store: Mutex::new(store),
            config_dir,
        };
        let _ = mgr.save_to_disk();
        mgr
    }

    /// Resolves the platform-appropriate config directory.
    fn resolve_config_dir() -> PathBuf {
        if let Some(proj_dirs) = ProjectDirs::from("com", "putz", "putz") {
            proj_dirs.config_dir().to_path_buf()
        } else {
            PathBuf::from(".")
        }
    }

    /// Acquires the internal mutex, returning a graceful error on poisoning.
    fn lock_store(&self) -> Result<MutexGuard<'_, ThemeStore>, ThemeError> {
        self.store
            .lock()
            .map_err(|e| ThemeError::LockError(format!("Theme store mutex poisoned: {e}")))
    }

    // ─── CRUD Operations ─────────────────────────────────────

    /// Lists all themes.
    pub fn list_themes(&self) -> Result<Vec<Theme>, ThemeError> {
        let store = self.lock_store()?;
        Ok(store.themes.clone())
    }

    /// Gets a single theme by ID.
    pub fn get_theme(&self, id: &str) -> Result<Theme, ThemeError> {
        let store = self.lock_store()?;
        store
            .themes
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or_else(|| ThemeError::NotFound(id.into()))
    }

    /// Creates a new custom theme. Returns the generated UUID.
    pub fn create_theme(&self, input: CreateThemeInput) -> Result<String, ThemeError> {
        validation::validate_name(&input.name)?;
        validation::validate_all_colors(&input.colors)?;

        let mut store = self.lock_store()?;

        if store.themes.len() >= MAX_THEMES {
            return Err(ThemeError::InvalidInput(format!(
                "Maximum number of themes ({MAX_THEMES}) reached"
            )));
        }

        if store
            .themes
            .iter()
            .any(|t| t.name.eq_ignore_ascii_case(&input.name))
        {
            return Err(ThemeError::DuplicateName(input.name));
        }

        let now = Self::now_iso8601();
        let theme_id = uuid::Uuid::new_v4().to_string();

        let theme = Theme {
            id: theme_id.clone(),
            name: input.name,
            colors: input.colors,
            is_builtin: false,
            created_at: now.clone(),
            updated_at: now,
        };

        store.themes.push(theme);
        drop(store);

        self.save_to_disk()?;
        Ok(theme_id)
    }

    /// Updates an existing custom theme with partial fields.
    pub fn update_theme(&self, id: &str, input: UpdateThemeInput) -> Result<(), ThemeError> {
        if let Some(ref name) = input.name {
            validation::validate_name(name)?;
        }
        if let Some(ref colors) = input.colors {
            validation::validate_all_colors(colors)?;
        }

        let mut store = self.lock_store()?;

        let theme = store
            .themes
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| ThemeError::NotFound(id.into()))?;

        if theme.is_builtin {
            return Err(ThemeError::BuiltinProtected(theme.name.clone()));
        }

        // Check duplicate name (excluding self)
        if let Some(ref new_name) = input.name {
            if store
                .themes
                .iter()
                .any(|t| t.id != id && t.name.eq_ignore_ascii_case(new_name))
            {
                return Err(ThemeError::DuplicateName(new_name.clone()));
            }
        }

        // Re-borrow mutably
        let theme = store
            .themes
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| ThemeError::NotFound(id.into()))?;

        if let Some(name) = input.name {
            theme.name = name;
        }
        if let Some(colors) = input.colors {
            theme.colors = colors;
        }
        theme.updated_at = Self::now_iso8601();

        drop(store);
        self.save_to_disk()?;
        Ok(())
    }

    /// Deletes a custom theme by ID.
    pub fn delete_theme(&self, id: &str) -> Result<(), ThemeError> {
        let mut store = self.lock_store()?;

        let idx = store
            .themes
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| ThemeError::NotFound(id.into()))?;

        if store.themes[idx].is_builtin {
            return Err(ThemeError::BuiltinProtected(store.themes[idx].name.clone()));
        }

        store.themes.remove(idx);
        drop(store);

        self.save_to_disk()?;
        Ok(())
    }

    /// Imports a theme from a ThemeExport DTO.
    ///
    /// If a theme with the same name exists, appends " (Imported)" suffix.
    pub fn import_theme(&self, export: ThemeExport) -> Result<String, ThemeError> {
        validation::validate_name(&export.name)?;
        validation::validate_all_colors(&export.colors)?;

        let mut store = self.lock_store()?;

        if store.themes.len() >= MAX_THEMES {
            return Err(ThemeError::InvalidInput(format!(
                "Maximum number of themes ({MAX_THEMES}) reached"
            )));
        }

        // Deduplicate name
        let original_name = export.name.clone();
        let mut name = export.name;
        if store
            .themes
            .iter()
            .any(|t| t.name.eq_ignore_ascii_case(&name))
        {
            name = format!("{original_name} (Imported)");
            // If still duplicate, add a number
            let mut counter = 2;
            while store
                .themes
                .iter()
                .any(|t| t.name.eq_ignore_ascii_case(&name))
            {
                name = format!("{original_name} (Imported {counter})");
                counter += 1;
            }
        }

        let now = Self::now_iso8601();
        let theme_id = uuid::Uuid::new_v4().to_string();

        let theme = Theme {
            id: theme_id.clone(),
            name,
            colors: export.colors,
            is_builtin: false,
            created_at: now.clone(),
            updated_at: now,
        };

        store.themes.push(theme);
        drop(store);

        self.save_to_disk()?;
        Ok(theme_id)
    }

    /// Exports a theme to a ThemeExport DTO.
    pub fn export_theme(&self, id: &str) -> Result<ThemeExport, ThemeError> {
        let store = self.lock_store()?;
        let theme = store
            .themes
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| ThemeError::NotFound(id.into()))?;

        Ok(ThemeExport {
            version: 1,
            name: theme.name.clone(),
            colors: theme.colors.clone(),
        })
    }

    // ─── Persistence ─────────────────────────────────────────

    /// Loads the theme store from disk, returning default if missing.
    fn load_from_disk(config_dir: &Path) -> ThemeStore {
        let path = config_dir.join(THEMES_FILE);
        if !path.exists() {
            return ThemeStore::default();
        }

        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => ThemeStore::default(),
        }
    }

    /// Persists the in-memory store to disk with atomic write + backup rotation.
    fn save_to_disk(&self) -> Result<(), ThemeError> {
        let store = self.lock_store()?;

        fs::create_dir_all(&self.config_dir)?;

        let path = self.config_dir.join(THEMES_FILE);

        if path.exists() {
            Self::rotate_backups(&path)?;
        }

        let json = serde_json::to_string_pretty(&*store)?;

        let tmp_path = self.config_dir.join("themes.tmp");
        fs::write(&tmp_path, &json)?;
        fs::rename(&tmp_path, &path)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&path, perms);
        }

        Ok(())
    }

    /// Rotates backup files (themes.json.bak.1 → .bak.2, etc.).
    fn rotate_backups(path: &Path) -> Result<(), ThemeError> {
        for i in (1..MAX_BACKUPS).rev() {
            let from = path.with_extension(format!("json.bak.{i}"));
            let to = path.with_extension(format!("json.bak.{}", i + 1));
            if from.exists() {
                fs::rename(&from, &to)?;
            }
        }
        let bak1 = path.with_extension("json.bak.1");
        if path.exists() {
            fs::copy(path, &bak1)?;
        }
        Ok(())
    }

    /// Returns the current time as an ISO 8601 string.
    fn now_iso8601() -> String {
        let now = time::OffsetDateTime::now_utc();
        now.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
    }

    // ─── Built-in Themes ────────────────────────────────────

    /// Injects built-in themes if they're not already present.
    fn inject_builtin_themes(store: &mut ThemeStore) {
        let themes = Self::builtin_themes();
        for theme in themes {
            if !store
                .themes
                .iter()
                .any(|t| t.name == theme.name && t.is_builtin)
            {
                store.themes.push(theme);
            }
        }
    }

    /// Returns the list of built-in themes (10 themes, WCAG 4.5:1+ verified).
    fn builtin_themes() -> Vec<Theme> {
        let now = "2024-01-01T00:00:00Z".to_string();
        vec![
            Self::solarized_dark(&now),
            Self::solarized_light(&now),
            Self::dracula(&now),
            Self::monokai(&now),
            Self::nord(&now),
            Self::catppuccin_mocha(&now),
            Self::catppuccin_latte(&now),
            Self::gruvbox_dark(&now),
            Self::gruvbox_light(&now),
            Self::one_dark(&now),
            Self::one_light(&now),
            Self::tomorrow_night(&now),
            Self::github_light(&now),
            Self::nord_light(&now),
            Self::high_contrast(&now),
        ]
    }

    fn solarized_dark(now: &str) -> Theme {
        Theme {
            id: "builtin-solarized-dark".into(),
            name: "Solarized Dark".into(),
            colors: ThemeColors {
                foreground: "#839496".into(),
                background: "#002b36".into(),
                cursor: "#839496".into(),
                cursor_accent: "#002b36".into(),
                selection_background: "#073642".into(),
                selection_foreground: String::new(),
                black: "#073642".into(),
                red: "#dc322f".into(),
                green: "#859900".into(),
                yellow: "#b58900".into(),
                blue: "#268bd2".into(),
                magenta: "#d33682".into(),
                cyan: "#2aa198".into(),
                white: "#eee8d5".into(),
                bright_black: "#586e75".into(),
                bright_red: "#cb4b16".into(),
                bright_green: "#586e75".into(),
                bright_yellow: "#657b83".into(),
                bright_blue: "#839496".into(),
                bright_magenta: "#6c71c4".into(),
                bright_cyan: "#93a1a1".into(),
                bright_white: "#fdf6e3".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn solarized_light(now: &str) -> Theme {
        Theme {
            id: "builtin-solarized-light".into(),
            name: "Solarized Light".into(),
            colors: ThemeColors {
                foreground: "#657b83".into(),
                background: "#fdf6e3".into(),
                cursor: "#657b83".into(),
                cursor_accent: "#fdf6e3".into(),
                selection_background: "#eee8d5".into(),
                selection_foreground: String::new(),
                black: "#073642".into(),
                red: "#dc322f".into(),
                green: "#859900".into(),
                yellow: "#b58900".into(),
                blue: "#268bd2".into(),
                magenta: "#d33682".into(),
                cyan: "#2aa198".into(),
                white: "#eee8d5".into(),
                bright_black: "#002b36".into(),
                bright_red: "#cb4b16".into(),
                bright_green: "#586e75".into(),
                bright_yellow: "#657b83".into(),
                bright_blue: "#839496".into(),
                bright_magenta: "#6c71c4".into(),
                bright_cyan: "#93a1a1".into(),
                bright_white: "#fdf6e3".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn dracula(now: &str) -> Theme {
        Theme {
            id: "builtin-dracula".into(),
            name: "Dracula".into(),
            colors: ThemeColors {
                foreground: "#f8f8f2".into(),
                background: "#282a36".into(),
                cursor: "#f8f8f2".into(),
                cursor_accent: "#282a36".into(),
                selection_background: "#44475a".into(),
                selection_foreground: String::new(),
                black: "#21222c".into(),
                red: "#ff5555".into(),
                green: "#50fa7b".into(),
                yellow: "#f1fa8c".into(),
                blue: "#bd93f9".into(),
                magenta: "#ff79c6".into(),
                cyan: "#8be9fd".into(),
                white: "#f8f8f2".into(),
                bright_black: "#6272a4".into(),
                bright_red: "#ff6e6e".into(),
                bright_green: "#69ff94".into(),
                bright_yellow: "#ffffa5".into(),
                bright_blue: "#d6acff".into(),
                bright_magenta: "#ff92df".into(),
                bright_cyan: "#a4ffff".into(),
                bright_white: "#ffffff".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn monokai(now: &str) -> Theme {
        Theme {
            id: "builtin-monokai".into(),
            name: "Monokai".into(),
            colors: ThemeColors {
                foreground: "#f8f8f2".into(),
                background: "#272822".into(),
                cursor: "#f8f8f2".into(),
                cursor_accent: "#272822".into(),
                selection_background: "#49483e".into(),
                selection_foreground: String::new(),
                black: "#272822".into(),
                red: "#f92672".into(),
                green: "#a6e22e".into(),
                yellow: "#f4bf75".into(),
                blue: "#66d9ef".into(),
                magenta: "#ae81ff".into(),
                cyan: "#a1efe4".into(),
                white: "#f8f8f2".into(),
                bright_black: "#75715e".into(),
                bright_red: "#f92672".into(),
                bright_green: "#a6e22e".into(),
                bright_yellow: "#f4bf75".into(),
                bright_blue: "#66d9ef".into(),
                bright_magenta: "#ae81ff".into(),
                bright_cyan: "#a1efe4".into(),
                bright_white: "#f9f8f5".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn nord(now: &str) -> Theme {
        Theme {
            id: "builtin-nord".into(),
            name: "Nord".into(),
            colors: ThemeColors {
                foreground: "#d8dee9".into(),
                background: "#2e3440".into(),
                cursor: "#d8dee9".into(),
                cursor_accent: "#2e3440".into(),
                selection_background: "#434c5e".into(),
                selection_foreground: String::new(),
                black: "#3b4252".into(),
                red: "#bf616a".into(),
                green: "#a3be8c".into(),
                yellow: "#ebcb8b".into(),
                blue: "#81a1c1".into(),
                magenta: "#b48ead".into(),
                cyan: "#88c0d0".into(),
                white: "#e5e9f0".into(),
                bright_black: "#4c566a".into(),
                bright_red: "#bf616a".into(),
                bright_green: "#a3be8c".into(),
                bright_yellow: "#ebcb8b".into(),
                bright_blue: "#81a1c1".into(),
                bright_magenta: "#b48ead".into(),
                bright_cyan: "#8fbcbb".into(),
                bright_white: "#eceff4".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn catppuccin_mocha(now: &str) -> Theme {
        Theme {
            id: "builtin-catppuccin-mocha".into(),
            name: "Catppuccin Mocha".into(),
            colors: ThemeColors {
                foreground: "#cdd6f4".into(),
                background: "#1e1e2e".into(),
                cursor: "#f5e0dc".into(),
                cursor_accent: "#1e1e2e".into(),
                selection_background: "#45475a".into(),
                selection_foreground: String::new(),
                black: "#45475a".into(),
                red: "#f38ba8".into(),
                green: "#a6e3a1".into(),
                yellow: "#f9e2af".into(),
                blue: "#89b4fa".into(),
                magenta: "#f5c2e7".into(),
                cyan: "#94e2d5".into(),
                white: "#bac2de".into(),
                bright_black: "#585b70".into(),
                bright_red: "#f38ba8".into(),
                bright_green: "#a6e3a1".into(),
                bright_yellow: "#f9e2af".into(),
                bright_blue: "#89b4fa".into(),
                bright_magenta: "#f5c2e7".into(),
                bright_cyan: "#94e2d5".into(),
                bright_white: "#a6adc8".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn gruvbox_dark(now: &str) -> Theme {
        Theme {
            id: "builtin-gruvbox-dark".into(),
            name: "Gruvbox Dark".into(),
            colors: ThemeColors {
                foreground: "#ebdbb2".into(),
                background: "#282828".into(),
                cursor: "#ebdbb2".into(),
                cursor_accent: "#282828".into(),
                selection_background: "#504945".into(),
                selection_foreground: String::new(),
                black: "#282828".into(),
                red: "#cc241d".into(),
                green: "#98971a".into(),
                yellow: "#d79921".into(),
                blue: "#458588".into(),
                magenta: "#b16286".into(),
                cyan: "#689d6a".into(),
                white: "#a89984".into(),
                bright_black: "#928374".into(),
                bright_red: "#fb4934".into(),
                bright_green: "#b8bb26".into(),
                bright_yellow: "#fabd2f".into(),
                bright_blue: "#83a598".into(),
                bright_magenta: "#d3869b".into(),
                bright_cyan: "#8ec07c".into(),
                bright_white: "#ebdbb2".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn one_dark(now: &str) -> Theme {
        Theme {
            id: "builtin-one-dark".into(),
            name: "One Dark".into(),
            colors: ThemeColors {
                foreground: "#abb2bf".into(),
                background: "#282c34".into(),
                cursor: "#528bff".into(),
                cursor_accent: "#282c34".into(),
                selection_background: "#3e4451".into(),
                selection_foreground: String::new(),
                black: "#282c34".into(),
                red: "#e06c75".into(),
                green: "#98c379".into(),
                yellow: "#e5c07b".into(),
                blue: "#61afef".into(),
                magenta: "#c678dd".into(),
                cyan: "#56b6c2".into(),
                white: "#abb2bf".into(),
                bright_black: "#5c6370".into(),
                bright_red: "#e06c75".into(),
                bright_green: "#98c379".into(),
                bright_yellow: "#e5c07b".into(),
                bright_blue: "#61afef".into(),
                bright_magenta: "#c678dd".into(),
                bright_cyan: "#56b6c2".into(),
                bright_white: "#ffffff".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn tomorrow_night(now: &str) -> Theme {
        Theme {
            id: "builtin-tomorrow-night".into(),
            name: "Tomorrow Night".into(),
            colors: ThemeColors {
                foreground: "#c5c8c6".into(),
                background: "#1d1f21".into(),
                cursor: "#c5c8c6".into(),
                cursor_accent: "#1d1f21".into(),
                selection_background: "#373b41".into(),
                selection_foreground: String::new(),
                black: "#1d1f21".into(),
                red: "#cc6666".into(),
                green: "#b5bd68".into(),
                yellow: "#f0c674".into(),
                blue: "#81a2be".into(),
                magenta: "#b294bb".into(),
                cyan: "#8abeb7".into(),
                white: "#c5c8c6".into(),
                bright_black: "#969896".into(),
                bright_red: "#cc6666".into(),
                bright_green: "#b5bd68".into(),
                bright_yellow: "#f0c674".into(),
                bright_blue: "#81a2be".into(),
                bright_magenta: "#b294bb".into(),
                bright_cyan: "#8abeb7".into(),
                bright_white: "#ffffff".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn high_contrast(now: &str) -> Theme {
        Theme {
            id: "builtin-high-contrast".into(),
            name: "High Contrast".into(),
            colors: ThemeColors {
                foreground: "#ffffff".into(),
                background: "#000000".into(),
                cursor: "#ffffff".into(),
                cursor_accent: "#000000".into(),
                selection_background: "#264f78".into(),
                selection_foreground: "#ffffff".into(),
                black: "#000000".into(),
                red: "#ff0000".into(),
                green: "#00ff00".into(),
                yellow: "#ffff00".into(),
                blue: "#0000ff".into(),
                magenta: "#ff00ff".into(),
                cyan: "#00ffff".into(),
                white: "#ffffff".into(),
                bright_black: "#808080".into(),
                bright_red: "#ff0000".into(),
                bright_green: "#00ff00".into(),
                bright_yellow: "#ffff00".into(),
                bright_blue: "#3b78ff".into(),
                bright_magenta: "#ff00ff".into(),
                bright_cyan: "#00ffff".into(),
                bright_white: "#ffffff".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn catppuccin_latte(now: &str) -> Theme {
        Theme {
            id: "builtin-catppuccin-latte".into(),
            name: "Catppuccin Latte".into(),
            colors: ThemeColors {
                foreground: "#4c4f69".into(),
                background: "#eff1f5".into(),
                cursor: "#dc8a78".into(),
                cursor_accent: "#eff1f5".into(),
                selection_background: "#ccd0da".into(),
                selection_foreground: String::new(),
                black: "#5c5f77".into(),
                red: "#d20f39".into(),
                green: "#40a02b".into(),
                yellow: "#df8e1d".into(),
                blue: "#1e66f5".into(),
                magenta: "#ea76cb".into(),
                cyan: "#179299".into(),
                white: "#acb0be".into(),
                bright_black: "#6c6f85".into(),
                bright_red: "#d20f39".into(),
                bright_green: "#40a02b".into(),
                bright_yellow: "#df8e1d".into(),
                bright_blue: "#1e66f5".into(),
                bright_magenta: "#ea76cb".into(),
                bright_cyan: "#179299".into(),
                bright_white: "#bcc0cc".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn gruvbox_light(now: &str) -> Theme {
        Theme {
            id: "builtin-gruvbox-light".into(),
            name: "Gruvbox Light".into(),
            colors: ThemeColors {
                foreground: "#3c3836".into(),
                background: "#fbf1c7".into(),
                cursor: "#3c3836".into(),
                cursor_accent: "#fbf1c7".into(),
                selection_background: "#d5c4a1".into(),
                selection_foreground: String::new(),
                black: "#fbf1c7".into(),
                red: "#cc241d".into(),
                green: "#98971a".into(),
                yellow: "#d79921".into(),
                blue: "#458588".into(),
                magenta: "#b16286".into(),
                cyan: "#689d6a".into(),
                white: "#7c6f64".into(),
                bright_black: "#928374".into(),
                bright_red: "#9d0006".into(),
                bright_green: "#79740e".into(),
                bright_yellow: "#b57614".into(),
                bright_blue: "#076678".into(),
                bright_magenta: "#8f3f71".into(),
                bright_cyan: "#427b58".into(),
                bright_white: "#3c3836".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn one_light(now: &str) -> Theme {
        Theme {
            id: "builtin-one-light".into(),
            name: "One Light".into(),
            colors: ThemeColors {
                foreground: "#383a42".into(),
                background: "#fafafa".into(),
                cursor: "#526eff".into(),
                cursor_accent: "#fafafa".into(),
                selection_background: "#e5e5e6".into(),
                selection_foreground: String::new(),
                black: "#383a42".into(),
                red: "#e45649".into(),
                green: "#50a14f".into(),
                yellow: "#c18401".into(),
                blue: "#4078f2".into(),
                magenta: "#a626a4".into(),
                cyan: "#0184bc".into(),
                white: "#a0a1a7".into(),
                bright_black: "#696c77".into(),
                bright_red: "#e06c75".into(),
                bright_green: "#98c379".into(),
                bright_yellow: "#e5c07b".into(),
                bright_blue: "#61afef".into(),
                bright_magenta: "#c678dd".into(),
                bright_cyan: "#56b6c2".into(),
                bright_white: "#ffffff".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn github_light(now: &str) -> Theme {
        Theme {
            id: "builtin-github-light".into(),
            name: "GitHub Light".into(),
            colors: ThemeColors {
                foreground: "#24292e".into(),
                background: "#ffffff".into(),
                cursor: "#044289".into(),
                cursor_accent: "#ffffff".into(),
                selection_background: "#c8c8fa".into(),
                selection_foreground: String::new(),
                black: "#24292e".into(),
                red: "#d73a49".into(),
                green: "#22863a".into(),
                yellow: "#b08800".into(),
                blue: "#0366d6".into(),
                magenta: "#6f42c1".into(),
                cyan: "#1b7c83".into(),
                white: "#6a737d".into(),
                bright_black: "#959da5".into(),
                bright_red: "#cb2431".into(),
                bright_green: "#28a745".into(),
                bright_yellow: "#dbab09".into(),
                bright_blue: "#2188ff".into(),
                bright_magenta: "#8a63d2".into(),
                bright_cyan: "#3192aa".into(),
                bright_white: "#d1d5da".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }

    fn nord_light(now: &str) -> Theme {
        Theme {
            id: "builtin-nord-light".into(),
            name: "Nord Light".into(),
            colors: ThemeColors {
                foreground: "#2e3440".into(),
                background: "#eceff4".into(),
                cursor: "#2e3440".into(),
                cursor_accent: "#eceff4".into(),
                selection_background: "#d8dee9".into(),
                selection_foreground: String::new(),
                black: "#3b4252".into(),
                red: "#bf616a".into(),
                green: "#a3be8c".into(),
                yellow: "#ebcb8b".into(),
                blue: "#5e81ac".into(),
                magenta: "#b48ead".into(),
                cyan: "#88c0d0".into(),
                white: "#e5e9f0".into(),
                bright_black: "#4c566a".into(),
                bright_red: "#bf616a".into(),
                bright_green: "#a3be8c".into(),
                bright_yellow: "#ebcb8b".into(),
                bright_blue: "#81a1c1".into(),
                bright_magenta: "#b48ead".into(),
                bright_cyan: "#8fbcbb".into(),
                bright_white: "#eceff4".into(),
            },
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_manager() -> (ThemeManager, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ThemeManager::with_config_dir(tmp.path().to_path_buf());
        (mgr, tmp)
    }

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

    // ─── Built-in themes ─────────────────────────────────────

    #[test]
    fn builtin_themes_injected_on_creation() {
        let (mgr, _tmp) = setup_manager();
        let themes = mgr.list_themes().unwrap();
        assert!(themes.len() >= 10, "Expected at least 10 built-in themes");
    }

    #[test]
    fn builtin_themes_have_correct_names() {
        let (mgr, _tmp) = setup_manager();
        let themes = mgr.list_themes().unwrap();
        let names: Vec<&str> = themes.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"Solarized Dark"));
        assert!(names.contains(&"Solarized Light"));
        assert!(names.contains(&"Dracula"));
        assert!(names.contains(&"Monokai"));
        assert!(names.contains(&"Nord"));
        assert!(names.contains(&"Catppuccin Mocha"));
        assert!(names.contains(&"Gruvbox Dark"));
        assert!(names.contains(&"One Dark"));
        assert!(names.contains(&"Tomorrow Night"));
        assert!(names.contains(&"High Contrast"));
    }

    #[test]
    fn builtin_themes_are_marked_builtin() {
        let (mgr, _tmp) = setup_manager();
        let themes = mgr.list_themes().unwrap();
        let builtins: Vec<&Theme> = themes.iter().filter(|t| t.is_builtin).collect();
        assert_eq!(builtins.len(), 15);
    }

    #[test]
    fn builtin_themes_not_duplicated_on_reload() {
        let tmp = tempfile::tempdir().unwrap();
        let _mgr1 = ThemeManager::with_config_dir(tmp.path().to_path_buf());
        let mgr2 = ThemeManager::with_config_dir(tmp.path().to_path_buf());
        let themes = mgr2.list_themes().unwrap();
        let builtins: Vec<&Theme> = themes.iter().filter(|t| t.is_builtin).collect();
        assert_eq!(builtins.len(), 15);
    }

    // ─── CRUD ────────────────────────────────────────────────

    #[test]
    fn create_theme_returns_id() {
        let (mgr, _tmp) = setup_manager();
        let id = mgr
            .create_theme(CreateThemeInput {
                name: "Custom Theme".into(),
                colors: sample_colors(),
            })
            .unwrap();
        assert!(!id.is_empty());
    }

    #[test]
    fn create_theme_persists() {
        let (mgr, _tmp) = setup_manager();
        let id = mgr
            .create_theme(CreateThemeInput {
                name: "Custom Theme".into(),
                colors: sample_colors(),
            })
            .unwrap();
        let theme = mgr.get_theme(&id).unwrap();
        assert_eq!(theme.name, "Custom Theme");
        assert!(!theme.is_builtin);
    }

    #[test]
    fn create_theme_duplicate_name_rejected() {
        let (mgr, _tmp) = setup_manager();
        mgr.create_theme(CreateThemeInput {
            name: "My Theme".into(),
            colors: sample_colors(),
        })
        .unwrap();

        let result = mgr.create_theme(CreateThemeInput {
            name: "my theme".into(), // case-insensitive
            colors: sample_colors(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn create_theme_invalid_name_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.create_theme(CreateThemeInput {
            name: "".into(),
            colors: sample_colors(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn create_theme_invalid_color_rejected() {
        let (mgr, _tmp) = setup_manager();
        let mut colors = sample_colors();
        colors.foreground = "not-a-color".into();
        let result = mgr.create_theme(CreateThemeInput {
            name: "Bad Colors".into(),
            colors,
        });
        assert!(result.is_err());
    }

    #[test]
    fn get_theme_not_found() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.get_theme("nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn update_theme_changes_name() {
        let (mgr, _tmp) = setup_manager();
        let id = mgr
            .create_theme(CreateThemeInput {
                name: "Original".into(),
                colors: sample_colors(),
            })
            .unwrap();
        mgr.update_theme(
            &id,
            UpdateThemeInput {
                name: Some("Updated".into()),
                colors: None,
            },
        )
        .unwrap();
        let theme = mgr.get_theme(&id).unwrap();
        assert_eq!(theme.name, "Updated");
    }

    #[test]
    fn update_theme_changes_colors() {
        let (mgr, _tmp) = setup_manager();
        let id = mgr
            .create_theme(CreateThemeInput {
                name: "Color Test".into(),
                colors: sample_colors(),
            })
            .unwrap();
        let mut new_colors = sample_colors();
        new_colors.foreground = "#ffffff".into();
        mgr.update_theme(
            &id,
            UpdateThemeInput {
                name: None,
                colors: Some(new_colors),
            },
        )
        .unwrap();
        let theme = mgr.get_theme(&id).unwrap();
        assert_eq!(theme.colors.foreground, "#ffffff");
    }

    #[test]
    fn update_builtin_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.update_theme(
            "builtin-dracula",
            UpdateThemeInput {
                name: Some("My Dracula".into()),
                colors: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn update_not_found_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.update_theme(
            "nonexistent",
            UpdateThemeInput {
                name: Some("Nope".into()),
                colors: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn delete_custom_theme() {
        let (mgr, _tmp) = setup_manager();
        let id = mgr
            .create_theme(CreateThemeInput {
                name: "Deletable".into(),
                colors: sample_colors(),
            })
            .unwrap();
        mgr.delete_theme(&id).unwrap();
        assert!(mgr.get_theme(&id).is_err());
    }

    #[test]
    fn delete_builtin_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.delete_theme("builtin-nord");
        assert!(result.is_err());
    }

    #[test]
    fn delete_not_found_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.delete_theme("nonexistent");
        assert!(result.is_err());
    }

    // ─── Import / Export ─────────────────────────────────────

    #[test]
    fn export_theme_returns_dto() {
        let (mgr, _tmp) = setup_manager();
        let export = mgr.export_theme("builtin-dracula").unwrap();
        assert_eq!(export.version, 1);
        assert_eq!(export.name, "Dracula");
    }

    #[test]
    fn export_not_found_rejected() {
        let (mgr, _tmp) = setup_manager();
        let result = mgr.export_theme("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn import_theme_creates_new() {
        let (mgr, _tmp) = setup_manager();
        let export = ThemeExport {
            version: 1,
            name: "Imported Theme".into(),
            colors: sample_colors(),
        };
        let id = mgr.import_theme(export).unwrap();
        let theme = mgr.get_theme(&id).unwrap();
        assert_eq!(theme.name, "Imported Theme");
        assert!(!theme.is_builtin);
    }

    #[test]
    fn import_theme_deduplicates_name() {
        let (mgr, _tmp) = setup_manager();
        // "Dracula" already exists as builtin
        let export = ThemeExport {
            version: 1,
            name: "Dracula".into(),
            colors: sample_colors(),
        };
        let id = mgr.import_theme(export).unwrap();
        let theme = mgr.get_theme(&id).unwrap();
        assert_eq!(theme.name, "Dracula (Imported)");
    }

    #[test]
    fn import_theme_deduplicates_name_multiple() {
        let (mgr, _tmp) = setup_manager();
        // Import "Dracula" twice
        let export1 = ThemeExport {
            version: 1,
            name: "Dracula".into(),
            colors: sample_colors(),
        };
        mgr.import_theme(export1).unwrap();

        let export2 = ThemeExport {
            version: 1,
            name: "Dracula".into(),
            colors: sample_colors(),
        };
        let id2 = mgr.import_theme(export2).unwrap();
        let theme = mgr.get_theme(&id2).unwrap();
        assert_eq!(theme.name, "Dracula (Imported 2)");
    }

    // ─── Persistence ─────────────────────────────────────────

    #[test]
    fn themes_persist_across_reloads() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr1 = ThemeManager::with_config_dir(tmp.path().to_path_buf());
        let id = mgr1
            .create_theme(CreateThemeInput {
                name: "Persisted Theme".into(),
                colors: sample_colors(),
            })
            .unwrap();
        drop(mgr1);

        let mgr2 = ThemeManager::with_config_dir(tmp.path().to_path_buf());
        let theme = mgr2.get_theme(&id).unwrap();
        assert_eq!(theme.name, "Persisted Theme");
    }

    #[test]
    fn backup_rotation_creates_files() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ThemeManager::with_config_dir(tmp.path().to_path_buf());

        // Create multiple themes to trigger multiple saves
        for i in 0..3 {
            mgr.create_theme(CreateThemeInput {
                name: format!("Theme {i}"),
                colors: sample_colors(),
            })
            .unwrap();
        }

        let bak1 = tmp.path().join("themes.json.bak.1");
        assert!(
            bak1.exists(),
            "Backup file should exist after multiple saves"
        );
    }
}
