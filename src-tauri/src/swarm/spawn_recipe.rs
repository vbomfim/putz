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
//!       "command": "gh",
//!       "args": ["copilot", "--mode", "review"],
//!       "cwd": "./packages/api",
//!       "env": { "REVIEW": "1" },
//!       "initial_prompt": "Review the latest commit"
//!     }
//!   ]
//! }
//! ```
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

/// Maximum chars in a recipe `command` (the executable path or name).
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

/// One quick-spawn recipe.
///
/// `deny_unknown_fields` keeps the wire schema tight — a typo in a
/// recipe is a hard error, not a silent ignore.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpawnRecipe {
    /// Display name shown in the palette. Required.
    pub name: String,
    /// Executable to spawn. Required.
    pub command: String,
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

/// Result of loading the recipes file. Always returns a value — even
/// errors are surfaced as a UI-renderable shape, not a thrown error.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LoadResult {
    /// Valid recipes, empty if file missing.
    pub recipes: Vec<SpawnRecipe>,
    /// One-line user-facing error message if the file existed but was
    /// invalid. `None` when the file is missing or valid.
    pub error: Option<String>,
}

impl LoadResult {
    fn missing() -> Self {
        Self {
            recipes: vec![],
            error: None,
        }
    }

    fn error(msg: impl Into<String>) -> Self {
        Self {
            recipes: vec![],
            error: Some(msg.into()),
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
        Err(e) => return Err(format!("read .putz/spawn.json: {e}")),
    };
    if bytes.len() > MAX_RECIPE_FILE_BYTES {
        return Ok(LoadResult::error(format!(
            "Recipes file too large ({} bytes; max {})",
            bytes.len(),
            MAX_RECIPE_FILE_BYTES
        )));
    }
    let s = match std::str::from_utf8(&bytes) {
        Ok(s) => s,
        Err(_) => return Ok(LoadResult::error("Recipes file is not valid UTF-8")),
    };
    let parsed: RecipeFile = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(e) => return Ok(LoadResult::error(format!("JSON parse error: {e}"))),
    };
    if parsed.recipes.len() > MAX_RECIPES {
        return Ok(LoadResult::error(format!(
            "Too many recipes ({}; max {})",
            parsed.recipes.len(),
            MAX_RECIPES
        )));
    }
    for recipe in &parsed.recipes {
        if let Err(msg) = validate(recipe) {
            return Ok(LoadResult::error(format!(
                "Recipe '{}': {}",
                truncate_for_msg(&recipe.name, 40),
                msg
            )));
        }
    }
    Ok(LoadResult {
        recipes: parsed.recipes,
        error: None,
    })
}

/// Return `Ok(())` if the recipe is structurally valid; else a
/// short user-facing reason. Validation is an allow-list:
///   * required strings non-empty + length-capped;
///   * no bidi control chars in displayable identifiers;
///   * arg count + per-arg length capped.
fn validate(recipe: &SpawnRecipe) -> Result<(), String> {
    if recipe.name.trim().is_empty() {
        return Err("name is empty".into());
    }
    if recipe.name.chars().count() > MAX_NAME_LEN {
        return Err(format!("name too long (max {MAX_NAME_LEN} chars)"));
    }
    if has_bidi_control(&recipe.name) {
        return Err("name contains disallowed control characters".into());
    }
    if recipe.command.trim().is_empty() {
        return Err("command is empty".into());
    }
    if recipe.command.chars().count() > MAX_COMMAND_LEN {
        return Err(format!("command too long (max {MAX_COMMAND_LEN} chars)"));
    }
    if has_bidi_control(&recipe.command) {
        return Err("command contains disallowed control characters".into());
    }
    if recipe.args.len() > MAX_ARGS {
        return Err(format!("too many args (max {MAX_ARGS})"));
    }
    for (i, arg) in recipe.args.iter().enumerate() {
        if arg.chars().count() > MAX_ARG_LEN {
            return Err(format!("arg #{i} too long (max {MAX_ARG_LEN} chars)"));
        }
    }
    if let Some(cwd) = &recipe.cwd {
        if cwd.chars().count() > MAX_PATH_LEN {
            return Err(format!("cwd too long (max {MAX_PATH_LEN} chars)"));
        }
    }
    for (k, v) in &recipe.env {
        if k.is_empty() {
            return Err("env key is empty".into());
        }
        if v.chars().count() > MAX_PATH_LEN {
            return Err(format!("env value for '{k}' too long"));
        }
    }
    if let Some(p) = &recipe.initial_prompt {
        if p.chars().count() > MAX_PROMPT_LEN {
            return Err(format!(
                "initial_prompt too long (max {MAX_PROMPT_LEN} chars)"
            ));
        }
    }
    Ok(())
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
pub fn validate_for_spawn(recipe: &SpawnRecipe) -> Result<(), String> {
    validate(recipe)
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
        write_recipes(
            dir.path(),
            r#"{"recipes":[{"name":"review","command":"gh"}]}"#,
        );
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_none());
        assert_eq!(result.recipes.len(), 1);
        assert_eq!(result.recipes[0].name, "review");
        assert_eq!(result.recipes[0].command, "gh");
        assert!(result.recipes[0].args.is_empty());
    }

    #[test]
    fn parses_full_recipe_with_args_env_cwd_prompt() {
        let dir = temp_dir();
        write_recipes(
            dir.path(),
            r#"{
              "recipes": [{
                "name": "review",
                "command": "gh",
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
        assert!(result.error.is_some());
        assert!(result.recipes.is_empty());
    }

    #[test]
    fn unknown_fields_rejected() {
        let dir = temp_dir();
        write_recipes(
            dir.path(),
            r#"{"recipes":[{"name":"x","command":"y","unknown_field":1}]}"#,
        );
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.is_some());
    }

    #[test]
    fn empty_name_rejected() {
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"   ","command":"gh"}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.as_ref().unwrap().contains("name is empty"));
    }

    #[test]
    fn empty_command_rejected() {
        let dir = temp_dir();
        write_recipes(dir.path(), r#"{"recipes":[{"name":"x","command":""}]}"#);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.as_ref().unwrap().contains("command is empty"));
    }

    #[test]
    fn bidi_control_in_name_rejected() {
        // RLO between "ev" and "iew" — Trojan Source class attack.
        let dir = temp_dir();
        let payload = r#"{"recipes":[{"name":"rev\u202Eiew","command":"gh"}]}"#;
        write_recipes(dir.path(), payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(
            result.error.as_ref().unwrap().contains("control"),
            "got: {:?}",
            result.error
        );
    }

    #[test]
    fn oversized_file_rejected() {
        let dir = temp_dir();
        let big = "x".repeat(MAX_RECIPE_FILE_BYTES + 1);
        write_recipes(dir.path(), &big);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.as_ref().unwrap().contains("too large"));
    }

    #[test]
    fn too_many_recipes_rejected() {
        let dir = temp_dir();
        let mut recipes = String::from(r#"{"recipes":["#);
        for i in 0..(MAX_RECIPES + 1) {
            if i > 0 {
                recipes.push(',');
            }
            recipes.push_str(&format!(r#"{{"name":"r{i}","command":"x"}}"#));
        }
        recipes.push_str("]}");
        write_recipes(dir.path(), &recipes);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.as_ref().unwrap().contains("Too many"));
    }

    #[test]
    fn long_name_rejected() {
        let dir = temp_dir();
        let long = "n".repeat(MAX_NAME_LEN + 1);
        let payload = format!(r#"{{"recipes":[{{"name":"{long}","command":"gh"}}]}}"#);
        write_recipes(dir.path(), &payload);
        let result = load_workspace_recipes(dir.path()).unwrap();
        assert!(result.error.as_ref().unwrap().contains("name too long"));
    }
}
