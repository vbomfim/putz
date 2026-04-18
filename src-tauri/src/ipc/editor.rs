//! File read/write/search IPC commands for the editor.

use serde::Serialize;

/// A single entry returned by `dir_list`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List directory entries (files + subdirectories), sorted dirs-first then alphabetical.
#[tauri::command]
pub fn dir_list(path: String) -> Result<Vec<DirEntry>, String> {
    let entries =
        std::fs::read_dir(&path).map_err(|e| format!("Failed to read dir {}: {}", path, e))?;
    let mut result: Vec<DirEntry> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files/dirs
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry
            .file_type()
            .map(|ft| ft.is_dir())
            .unwrap_or(false);
        result.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

/// Read a file's content as UTF-8 text.
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Get the modification timestamp of a file (ms since epoch).
#[tauri::command]
pub fn file_mtime(path: String) -> Result<u64, String> {
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get mtime {}: {}", path, e))?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?;
    Ok(duration.as_millis() as u64)
}

/// Write content to a file (creates or overwrites).
#[tauri::command]
pub fn file_write(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// A single match in a file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

/// Search results for a single file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub matches: Vec<FileMatch>,
}

/// Search for a pattern across files in a directory.
#[tauri::command]
pub fn file_search(
    directory: String,
    pattern: String,
    file_glob: Option<String>,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
    max_results: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    let dir = std::path::Path::new(&directory);
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", directory));
    }

    let case_sensitive = case_sensitive.unwrap_or(false);
    let use_regex = use_regex.unwrap_or(false);
    let max_results = max_results.unwrap_or(1000);
    let glob_pattern = file_glob.unwrap_or_else(|| "*".to_string());

    // Build regex or literal matcher
    let regex = if use_regex {
        let flags = if case_sensitive { "" } else { "(?i)" };
        regex::Regex::new(&format!("{}{}", flags, pattern))
            .map_err(|e| format!("Invalid regex: {}", e))?
    } else {
        let escaped = regex::escape(&pattern);
        let flags = if case_sensitive { "" } else { "(?i)" };
        regex::Regex::new(&format!("{}{}", flags, escaped))
            .map_err(|e| format!("Regex error: {}", e))?
    };

    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total_matches = 0;

    // Walk directory
    for entry in walkdir::WalkDir::new(dir)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        if total_matches >= max_results {
            break;
        }

        let path = entry.path();
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Simple glob matching (supports * and ?)
        if glob_pattern != "*" && !glob_match(&glob_pattern, filename) {
            continue;
        }

        // Skip binary files (check first 512 bytes)
        if let Ok(mut f) = std::fs::File::open(path) {
            use std::io::Read;
            let mut buf = [0u8; 512];
            if let Ok(n) = f.read(&mut buf) {
                if buf[..n].contains(&0) {
                    continue; // Binary file
                }
            }
        }

        // Read and search
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue, // Skip unreadable files
        };

        let mut file_matches: Vec<FileMatch> = Vec::new();
        for (line_idx, line) in content.lines().enumerate() {
            if total_matches >= max_results {
                break;
            }
            for m in regex.find_iter(line) {
                file_matches.push(FileMatch {
                    line_number: line_idx + 1,
                    line_content: line.to_string(),
                    match_start: m.start(),
                    match_end: m.end(),
                });
                total_matches += 1;
                if total_matches >= max_results {
                    break;
                }
            }
        }

        if !file_matches.is_empty() {
            results.push(FileSearchResult {
                path: path.to_string_lossy().to_string(),
                matches: file_matches,
            });
        }
    }

    Ok(results)
}

/// Replace a pattern in a single file.
#[tauri::command]
pub fn file_replace(
    path: String,
    pattern: String,
    replacement: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<usize, String> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let use_regex = use_regex.unwrap_or(false);

    let regex = if use_regex {
        let flags = if case_sensitive { "" } else { "(?i)" };
        regex::Regex::new(&format!("{}{}", flags, pattern))
            .map_err(|e| format!("Invalid regex: {}", e))?
    } else {
        let escaped = regex::escape(&pattern);
        let flags = if case_sensitive { "" } else { "(?i)" };
        regex::Regex::new(&format!("{}{}", flags, escaped))
            .map_err(|e| format!("Regex error: {}", e))?
    };

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let count = regex.find_iter(&content).count();
    if count == 0 {
        return Ok(0);
    }

    let replaced = regex
        .replace_all(&content, replacement.as_str())
        .to_string();
    std::fs::write(&path, &replaced).map_err(|e| format!("Failed to write {}: {}", path, e))?;

    Ok(count)
}

/// Replace a pattern across all files in a directory.
#[tauri::command]
pub fn file_replace_all(
    directory: String,
    pattern: String,
    replacement: String,
    file_glob: Option<String>,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<usize, String> {
    // First search to find matching files
    let results = file_search(
        directory,
        pattern.clone(),
        file_glob,
        case_sensitive,
        use_regex,
        Some(10000),
    )?;

    let mut total = 0;
    for result in &results {
        let count = file_replace(
            result.path.clone(),
            pattern.clone(),
            replacement.clone(),
            case_sensitive,
            use_regex,
        )?;
        total += count;
    }

    Ok(total)
}

/// Simple glob matching (supports * and ? only).
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern = if pattern.contains('.') {
        pattern.to_string()
    } else {
        format!("{}*", pattern)
    };
    let regex_pattern = pattern
        .replace('.', "\\.")
        .replace('*', ".*")
        .replace('?', ".");
    regex::Regex::new(&format!("(?i)^{}$", regex_pattern))
        .map(|r| r.is_match(text))
        .unwrap_or(false)
}
