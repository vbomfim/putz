//! Git IPC commands — run git CLI and return raw output to the frontend.
//!
//! The frontend parses the raw text using its own gitParser module.
//! This avoids duplicating parsing logic in Rust.

use std::process::Command;

/// Run a git command in a given directory and return stdout.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git error: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_log(
    repo_path: String,
    max_count: Option<u32>,
    file_path: Option<String>,
) -> Result<String, String> {
    let format_str = format!(
        "--format=\x1e%H\x1f%h\x1f%s\x1f%b\x1f%aN\x1f%aE\x1f%aI\x1f%P\x1f%D"
    );
    let count_str = max_count.unwrap_or(500).to_string();
    let max_count_arg = format!("--max-count={}", count_str);
    let mut args: Vec<&str> = vec!["log", &format_str, &max_count_arg, "--all"];
    if let Some(ref fp) = file_path {
        args.push("--");
        args.push(fp);
    }
    run_git(&repo_path, &args)
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["branch", "-a"])
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["status", "--porcelain=v1"])
}

#[tauri::command]
pub fn git_show(repo_path: String, hash: String) -> Result<String, String> {
    let format_str = format!(
        "--format=\x1e%H\x1f%h\x1f%s\x1f%b\x1f%aN\x1f%aE\x1f%aI\x1f%P\x1f%D"
    );
    run_git(
        &repo_path,
        &["show", &format_str, "--name-status", &hash, "--"],
    )
}

#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["stash", "list"])
}

#[tauri::command]
pub fn git_remotes(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["remote"])
}

#[tauri::command]
pub fn git_rev_parse_head(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["rev-parse", "HEAD"]).map(|s| s.trim().to_string())
}

/// Returns the git repository root path, or an error if not in a repo.
#[tauri::command]
pub fn git_repo_root(path: String) -> Result<String, String> {
    run_git(&path, &["rev-parse", "--show-toplevel"]).map(|s| s.trim().to_string())
}

/// Get file content at a specific commit (or empty string if the file didn't exist).
#[tauri::command]
pub fn git_file_at_commit(repo_path: String, hash: String, file_path: String) -> Result<String, String> {
    let spec = format!("{}:{}", hash, file_path);
    match run_git(&repo_path, &["show", &spec]) {
        Ok(content) => Ok(content),
        Err(_) => Ok(String::new()), // file didn't exist at this commit
    }
}
