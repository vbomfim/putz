//! Workspace `.putz/spawn.json` recipe loader (T4 / FR-019).
//!
//! Reads a small JSON file from `<workspace>/.putz/spawn.json` defining
//! named "spawn recipes" — quick-spawn presets surfaced by the Cmd+K
//! palette. The schema is intentionally tiny:
//!
//! ```json
//! {
//!   "recipes": [
//!     {
//!       "name": "review",
//!       "cmd": "gh",
//!       "args": ["copilot", "--mode", "review"],
//!       "cwd": "./packages/api",
//!       "env": { "REVIEW": "1" },
//!       "initial_prompt": "Review the latest commit"
//!     }
//!   ]
//! }
//! ```
//!
//! The legacy field name `command` is accepted as an alias for backwards
//! compatibility with any in-flight recipes authored before the rename
//! to match spec FR-019.
//!
//! ## Trust model
//!
//! Recipes execute commands at the user's privilege level inside Putz.
//! That is the **same** trust assumption as the existing terminal: if
//! you opened a workspace, you trust its files. We surface recipes
//! without prompting (open question in spec Risk Surface — see
//! `Open Questions` §17 of ticket #143). Defense in depth applied:
//!
//! - `serde(deny_unknown_fields)` blocks silent semantic drift.
//! - Recipe name + command are length-capped to bound UI memory.
//! - Bidi-control characters are rejected to prevent display-spoofing
//!   (homoglyph/right-to-left-override) on the palette.
//! - The loader **never** invokes commands; it only parses.
//!
//! ## Privacy
//!
//! `initial_prompt` is **@privacy Tier-2** PII (PRI-001/002). The loader
//! returns it verbatim; downstream callers (the spawn command path)
//! treat it like any other prompt — never log, never persist beyond
//! the current spawn.
//!
//! ## Error policy
//!
//! - Missing file → `Ok(LoadResult::missing())`. Empty palette is a
//!   normal first-run state, not an error.
//! - Malformed JSON / unknown fields / bidi in identifiers →
//!   `Ok(LoadResult::error(...))` so the palette can show a single
//!   non-selectable "Recipes file invalid" entry instead of throwing.
//! - I/O failure other than NotFound → `Err(String)`. (Permission
//!   denied is a real condition the operator should see.)
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Maximum bytes of `.putz/spawn.json` we will read. Defends against a
/// pathological multi-megabyte file blocking the UI thread on parse.
/// 64 KiB fits ~hundreds of realistic recipes.
const MAX_RECIPE_FILE_BYTES: usize = 64 * 1024;

/// Maximum recipes per workspace. The Cmd+K list becomes unusable past
/// a few dozen; cap defensively.
const MAX_RECIPES: usize = 100;

/// Maximum chars in a recipe name (palette display).
const MAX_NAME_LEN: usize = 80;

/// Maximum chars in a recipe `cmd` (the executable path or name).
const MAX_COMMAND_LEN: usize = 512;

/// Maximum number of args per recipe (bound UI + spawn payload size).
const MAX_ARGS: usize = 64;

/// Maximum chars in a single arg.
const MAX_ARG_LEN: usize = 1024;

/// Maximum chars in `cwd` / each env value.
const MAX_PATH_LEN: usize = 4096;

/// Maximum chars in `initial_prompt`.
///
/// @privacy Tier-2 — the prompt is user-authored content. We cap the
/// length to bound memory but never inspect contents.
const MAX_PROMPT_LEN: usize = 4096;

/// Maximum chars in an env var key. Defends against pathological keys
/// (single-key DoS via long strings; the OS limit is much higher).
const MAX_ENV_KEY_LEN: usize = 256;

/// One quick-spawn recipe.
///
/// `deny_unknown_fields` keeps the wire schema tight — a typo in a
/// recipe is a hard error, not a silent ignore.
///
/// The `cmd` field matches spec FR-019 wording. The legacy alias
/// `command` is accepted on input for back-compat with recipes
/// authored against the prior schema; both names parse to the same
/// in-memory shape and the canonical wire shape uses `cmd`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpawnRecipe {
    /// Display name shown in the palette. Required.
    pub name: String,
    /// Executable to spawn. Required.
    #[serde(rename = "cmd", alias = "command")]
    pub cmd: String,
    /// Optional args. Defaults to empty.
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional working directory. May be relative to the workspace root
    /// — the spawn command resolves it.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Optional environment overrides. Putz's own env vars
    /// (`PUTZ_SWARM_PATH`, `PUTZ_TAB_ID`, …) are merged on top per
    /// FR-020 — the recipe cannot override Putz's identity vars.
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    /// Optional initial prompt sent to the spawned process.
    ///
    /// @privacy Tier-2 — see module doc.
    #[serde(default)]
    pub initial_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct RecipeFile {
    recipes: Vec<SpawnRecipe>,
}

/// Categories of recipe-loader failure surfaced to the frontend.
///
/// Frontends branch on `kind` for tailored error UI (e.g., "Open editor"
/// for `MalformedJson`, "Open settings" for `PermissionDenied`); the
/// `message` field carries a short user-facing string for display.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// `.putz/spawn.json` does not exist.
    MissingFile,
    /// File is malformed JSON, contains unknown fields, or is not UTF-8.
    MalformedJson,
    /// File exceeds [`MAX_RECIPE_FILE_BYTES`].
    OversizedFile,
    /// I/O failure other than NotFound (typically permission denied).
    PermissionDenied,
    /// A recipe failed structural validation (empty name/cmd, oversize, …).
    InvalidRecipe,
    /// A displayable identifier contained bidi-control characters
    /// (Trojan-Source class). See [`has_bidi_control`].
    BidiControlRejected,
    /// File contained more than [`MAX_RECIPES`] entries.
    TooManyRecipes,
}

/// Typed error surfaced as part of [`LoadResult`]. The `message` is a
/// short user-facing string (no PII, no full paths beyond the
/// caller-supplied workspace root).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LoadRecipeError {
    pub kind: ErrorKind,
    pub message: String,
}

impl LoadRecipeError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Result of loading the recipes file. Always returns a value — even
/// errors are surfaced as a UI-renderable shape, not a thrown error.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LoadResult {
    /// Valid recipes, empty if file missing.
    pub recipes: Vec<SpawnRecipe>,
    /// Typed error if the file existed but was invalid. `None` when
    /// the file is missing or valid.
    pub error: Option<LoadRecipeError>,
}

impl LoadResult {
    fn missing() -> Self {
        Self {
            recipes: vec![],
            error: None,
        }
    }

    fn error(kind: ErrorKind, msg: impl Into<String>) -> Self {
        Self {
            recipes: vec![],
            error: Some(LoadRecipeError::new(kind, msg)),
        }
    }
}

/// Load and validate `.putz/spawn.json` under `workspace_root`.
///
/// Pure function — no Tauri runtime dependencies, fully unit-testable
/// against any temp directory.
pub fn load_workspace_recipes(workspace_root: &Path) -> Result<LoadResult, String> {
    let path = workspace_root.join(".putz").join("spawn.json");
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(LoadResult::missing()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Ok(LoadResult::error(
                ErrorKind::PermissionDenied,
                format!("Cannot read .putz/spawn.json: {e}"),
            ));
        }
        Err(e) => return Err(format!("read .putz/spawn.json: {e}")),
    };
    if bytes.len() > MAX_RECIPE_FILE_BYTES {
        return Ok(LoadResult::error(
            ErrorKind::OversizedFile,
            format!(
                "Recipes file too large ({} bytes; max {})",
                bytes.len(),
                MAX_RECIPE_FILE_BYTES
            ),
        ));
    }
    let s = match std::str::from_utf8(&bytes) {
        Ok(s) => s,
        Err(_) => {
            return Ok(LoadResult::error(
                ErrorKind::MalformedJson,
                "Recipes file is not valid UTF-8",
            ))
        }
    };
    let parsed: RecipeFile = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(e) => {
            return Ok(LoadResult::error(
                ErrorKind::MalformedJson,
                format!("JSON parse error: {e}"),
            ))
        }
    };
    if parsed.recipes.len() > MAX_RECIPES {
        return Ok(LoadResult::error(
            ErrorKind::TooManyRecipes,
            format!(
                "Too many recipes ({}; max {})",
                parsed.recipes.len(),
                MAX_RECIPES
            ),
        ));
    }
    for recipe in &parsed.recipes {
        if let Err((kind, msg)) = validate(recipe) {
            return Ok(LoadResult::error(
                kind,
                format!("Recipe '{}': {}", truncate_for_msg(&recipe.name, 40), msg),
            ));
        }
    }
    Ok(LoadResult {
        recipes: parsed.recipes,
        error: None,
    })
}

/// Return `Ok(())` if the recipe is structurally valid; else a
/// `(kind, message)` pair where `kind` is the failure category and
/// `message` is a short user-facing reason. Validation is an
/// allow-list:
///   * required strings non-empty + length-capped;
///   * no bidi control / control chars in displayable identifiers;
///   * arg count + per-arg length capped;
///   * env keys + values capped, no control chars in either;
///   * cwd capped, no control chars.
fn validate(recipe: &SpawnRecipe) -> Result<(), (ErrorKind, String)> {
    if recipe.name.trim().is_empty() {
        return Err((ErrorKind::InvalidRecipe, "name is empty".into()));
    }
    if recipe.name.chars().count() > MAX_NAME_LEN {
        return Err((
            ErrorKind::InvalidRecipe,
            format!("name too long (max {MAX_NAME_LEN} chars)"),
        ));
    }
    if has_bidi_control(&recipe.name) {
        return Err((
            ErrorKind::BidiControlRejected,
            "name contains disallowed control characters".into(),
        ));
    }
    if recipe.cmd.trim().is_empty() {
        return Err((ErrorKind::InvalidRecipe, "cmd is empty".into()));
    }
    if recipe.cmd.chars().count() > MAX_COMMAND_LEN {
        return Err((
            ErrorKind::InvalidRecipe,
            format!("cmd too long (max {MAX_COMMAND_LEN} chars)"),
        ));
    }
    if has_bidi_control(&recipe.cmd) {
        return Err((
            ErrorKind::BidiControlRejected,
            "cmd contains disallowed control characters".into(),
        ));
    }
    if recipe.args.len() > MAX_ARGS {
        return Err((
            ErrorKind::InvalidRecipe,
            format!("too many args (max {MAX_ARGS})"),
        ));
    }
    for (i, arg) in recipe.args.iter().enumerate() {
        if arg.chars().count() > MAX_ARG_LEN {
            return Err((
                ErrorKind::InvalidRecipe,
                format!("arg #{i} too long (max {MAX_ARG_LEN} chars)"),
            ));
        }
        if has_bidi_control(arg) {
            return Err((
                ErrorKind::BidiControlRejected,
                format!("arg #{i} contains disallowed bidi-control characters"),
            ));
        }
        if has_control_chars(arg) {
            return Err((
                ErrorKind::InvalidRecipe,
                format!("arg #{i} contains disallowed control characters"),
            ));
        }
    }
    if let Some(cwd) = &recipe.cwd {
        if cwd.chars().count() > MAX_PATH_LEN {
            return Err((
                ErrorKind::InvalidRecipe,
                format!("cwd too long (max {MAX_PATH_LEN} chars)"),
            ));
        }
        if has_bidi_control(cwd) {
            return Err((
                ErrorKind::BidiControlRejected,
                "cwd contains disallowed bidi-control characters".into(),
            ));
        }
        if has_control_chars(cwd) {
            return Err((
                ErrorKind::InvalidRecipe,
                "cwd contains disallowed control characters".into(),
            ));
        }
    }
    for (k, v) in &recipe.env {
        if k.is_empty() {
            return Err((ErrorKind::InvalidRecipe, "env key is empty".into()));
        }
        if k.chars().count() > MAX_ENV_KEY_LEN {
            return Err((
                ErrorKind::InvalidRecipe,
                format!(
                    "env key '{}' too long (max {MAX_ENV_KEY_LEN} chars)",
                    truncate_for_msg(k, 32)
                ),
            ));
        }
        if has_bidi_control(k) || has_control_chars(k) {
            return Err((
                ErrorKind::BidiControlRejected,
                "env key contains disallowed control characters".into(),
            ));
        }
        if v.chars().count() > MAX_PATH_LEN {
            return Err((
                ErrorKind::InvalidRecipe,
                format!("env value for '{}' too long", truncate_for_msg(k, 32)),
            ));
        }
        if has_bidi_control(v) {
            return Err((
                ErrorKind::BidiControlRejected,
                format!(
                    "env value for '{}' contains disallowed bidi-control characters",
                    truncate_for_msg(k, 32)
                ),
            ));
        }
        if has_control_chars(v) {
            return Err((
                ErrorKind::InvalidRecipe,
                format!(
                    "env value for '{}' contains disallowed control characters",
                    truncate_for_msg(k, 32)
                ),
            ));
        }
    }
    if let Some(p) = &recipe.initial_prompt {
        if p.chars().count() > MAX_PROMPT_LEN {
            return Err((
                ErrorKind::InvalidRecipe,
                format!("initial_prompt too long (max {MAX_PROMPT_LEN} chars)"),
            ));
        }
    }
    Ok(())
}

/// True if `s` contains any character classified by Rust as control
/// (other than the regular-text whitespace `\t`). Used as a defense
/// against embedded escape sequences in env/args/cwd that could
/// confuse downstream loggers, sub-shells, or terminal display.
///
/// Allows `\t` (tab) because some legitimate paths/values may contain
/// it; rejects newlines, NULs, BEL, escape, etc.
fn has_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control() && c != '\t')
}

/// True if `s` contains any unicode bidi-control / right-to-left-override
/// character. Defends against the "Trojan Source" class of display
/// spoofing where a malicious recipe name appears different in the
/// palette than the underlying command bytes (CVE-2021-42574).
fn has_bidi_control(s: &str) -> bool {
    s.chars().any(|c| {
        matches!(
            c,
            '\u{202A}' // LRE
            | '\u{202B}' // RLE
            | '\u{202C}' // PDF
            | '\u{202D}' // LRO
            | '\u{202E}' // RLO
            | '\u{2066}' // LRI
            | '\u{2067}' // RLI
            | '\u{2068}' // FSI
            | '\u{2069}' // PDI
        )
    })
}

fn truncate_for_msg(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

/// Locate the workspace root for recipe loading. T4 keeps this trivial
/// — caller (the Tauri command layer) supplies the absolute path; this
/// function exists for symmetry with future callers that may infer it
/// from the active tab's cwd.
pub fn resolve_workspace_root(workspace_root: PathBuf) -> PathBuf {
    workspace_root
}

/// Public re-export of the per-recipe validator for the spawn-from-recipe
/// command — same allow-list applied to recipes loaded from disk.
///
/// Returns `Err(LoadRecipeError)` so callers can surface the typed
/// error kind to the frontend (see [`ErrorKind`]).
pub fn validate_for_spawn(recipe: &SpawnRecipe) -> Result<(), LoadRecipeError> {
    validate(recipe).map_err(|(kind, msg)| LoadRecipeError::new(kind, msg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_recipes(dir: &Path, contents: &str) {
        let putz = dir.join(".putz");
        fs::create_dir_all(&putz).unwrap();
        let mut f = fs::File::create(putz.join("spawn.json")).unwrap();
        f.write_all(contents.as_bytes()).unwrap();
    }

    #[test]
    fn missing_file_returns_empty_no_error() {
        let dir = temp_dir();
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert_eq!(result, LoadResult::missing());
    }

    #[test]
    fn parses_minimal_valid_recipe() {
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"review","cmd":"gh"}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_none());
        assert_eq!(result.recipes.len(), 1);
        assert_eq!(result.recipes[0].name, "review");
        assert_eq!(result.recipes[0].cmd, "gh");
        assert!(result.recipes[0].args.is_empty());
    }

    #[test]
    fn parses_spec_example_with_cmd_field() {
        // Verbatim from spec.md FR-019 acceptance criterion.
        let dir = temp_dir();
        write_recipes(
            dir.path(),
            r#"{"recipes":[{"name":"review","cmd":"gh","args":["copilot"]}]}"#,
        );
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_none(), "got {:?}", result.error);
        assert_eq!(result.recipes[0].cmd, "gh");
        assert_eq!(result.recipes[0].args, vec!["copilot"]);
    }

    #[test]
    fn legacy_command_alias_still_parses() {
        // Back-compat for recipes authored before the rename.
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"x","command":"gh"}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_none());
        assert_eq!(result.recipes[0].cmd, "gh");
    }

    #[test]
    fn parses_full_recipe_with_args_env_cwd_prompt() {
        let dir = temp_dir();
        write_recipes(
            dir.path(),
            r#"{
              "recipes": [{
                "name": "review",
                "cmd": "gh",
                "args": ["copilot", "--mode", "review"],
                "cwd": "./api",
                "env": {"REVIEW": "1"},
                "initial_prompt": "Review HEAD"
              }]
            }"#,
        );
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_none(), "got error: {:?}", result.error);
        let r = &result.recipes[0];
        assert_eq!(r.args, vec!["copilot", "--mode", "review"]);
        assert_eq!(r.cwd.as_deref(), Some("./api"));
        assert_eq!(r.env.get("REVIEW").map(String::as_str), Some("1"));
        assert_eq!(r.initial_prompt.as_deref(), Some("Review HEAD"));
    }

    #[test]
    fn malformed_json_returns_error_in_result_not_thrown() {
        let dir = temp_dir();
        write_recipes(dir.path(), "not json at all");
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::MalformedJson);
        assert!(result.recipes.is_empty());
    }

    #[test]
    fn unknown_fields_rejected() {
        let dir = temp_dir();
        write_recipes(
            dir.path(),
            r#"{"recipes":[{"name":"x","cmd":"y","unknown_field":1}]}"#,
        );
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::MalformedJson);
    }

    #[test]
    fn empty_name_rejected() {
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"   ","cmd":"gh"}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
        assert!(err.message.contains("name is empty"));
    }

    #[test]
    fn empty_cmd_rejected() {
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"x","cmd":""}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
        assert!(err.message.contains("cmd is empty"));
    }

    #[test]
    fn bidi_control_in_name_rejected() {
        // RLO between "ev" and "iew" — Trojan Source class attack.
        let dir = temp_dir();
        let payload = r#"{"recipes":[{"name":"rev\u202Eiew","cmd":"gh"}]}"#;
        write_recipes(dir.path(), payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::BidiControlRejected);
    }

    #[test]
    fn bidi_control_in_env_value_rejected() {
        let dir = temp_dir();
        let payload = r#"{"recipes":[{"name":"x","cmd":"y","env":{"K":"v\u202Eal"}}]}"#;
        write_recipes(dir.path(), payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::BidiControlRejected);
    }

    #[test]
    fn control_char_in_arg_rejected() {
        // \x07 (BEL) embedded in an arg.
        let dir = temp_dir();
        let payload = r#"{"recipes":[{"name":"x","cmd":"y","args":["abc\u0007def"]}]}"#;
        write_recipes(dir.path(), payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
    }

    #[test]
    fn newline_in_cwd_rejected() {
        let dir = temp_dir();
        let payload = r#"{"recipes":[{"name":"x","cmd":"y","cwd":"./a\nb"}]}"#;
        write_recipes(dir.path(), payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
    }

    #[test]
    fn long_env_key_rejected() {
        let dir = temp_dir();
        let big_key: String = "K".repeat(MAX_ENV_KEY_LEN + 1);
        let payload =
            format!(r#"{{"recipes":[{{"name":"x","cmd":"y","env":{{"{big_key}":"v"}}}}]}}"#);
        write_recipes(dir.path(), &payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
    }

    #[test]
    fn oversized_file_rejected() {
        let dir = temp_dir();
        let big = "x".repeat(MAX_RECIPE_FILE_BYTES + 1);
        write_recipes(dir.path(), &big);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::OversizedFile);
    }

    #[test]
    fn too_many_recipes_rejected() {
        let dir = temp_dir();
        let mut recipes = String::from(r#"{"recipes":["#);
        for i in 0..(MAX_RECIPES + 1) {
            if i > 0 {
                recipes.push(',');
            }
            recipes.push_str(&format!(r#"{{"name":"r{i}","cmd":"x"}}"#));
        }
        recipes.push_str("]}");
        write_recipes(dir.path(), &recipes);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::TooManyRecipes);
    }

    #[test]
    fn long_name_rejected() {
        let dir = temp_dir();
        let long = "n".repeat(MAX_NAME_LEN + 1);
        let payload = format!(r#"{{"recipes":[{{"name":"{long}","cmd":"gh"}}]}}"#);
        write_recipes(dir.path(), &payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        let err = result.error.expect("expected error");
        assert_eq!(err.kind, ErrorKind::InvalidRecipe);
        assert!(err.message.contains("name too long"));
    }
}
