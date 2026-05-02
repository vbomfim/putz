//! Git IPC commands — run git CLI and return raw output to the frontend.
//!
//! The frontend parses the raw text using its own gitParser module.
//! This avoids duplicating parsing logic in Rust.

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: suppress the flash of the `git.exe` console window when spawning.
/// Without this flag, every git call briefly pops a black console on top of
/// putz and interrupts focus.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Run a git command in a given directory and return stdout.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let t0 = std::time::Instant::now();
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(repo_path);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    let us = t0.elapsed().as_micros();
    if us > 20_000 {
        crate::perf::log(&format!(
            "git {} cwd={} took_us={}",
            args.first().copied().unwrap_or(""),
            repo_path,
            us
        ));
    }
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
    let format_str = "--format=\x1e%H\x1f%h\x1f%s\x1f%b\x1f%aN\x1f%aE\x1f%aI\x1f%P\x1f%D".to_string();
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
    let format_str = "--format=\x1e%H\x1f%h\x1f%s\x1f%b\x1f%aN\x1f%aE\x1f%aI\x1f%P\x1f%D".to_string();
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

/// List all worktrees.
#[tauri::command]
pub fn git_worktree_list(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["worktree", "list", "--porcelain"])
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

/// Get a compact status summary: branch, ahead, behind, dirty count.
/// Returns "branch\nahead\nbehind\ndirty" (e.g. "main\n2\n0\n3").
#[tauri::command]
pub fn git_status_summary(path: String) -> Result<String, String> {
    let status_raw = run_git(&path, &["status", "--porcelain=v2", "--branch"])?;
    let mut branch = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut dirty = 0u32;

    for line in status_raw.lines() {
        if line.starts_with("# branch.head ") {
            branch = line.strip_prefix("# branch.head ").unwrap_or("").to_string();
        } else if line.starts_with("# branch.ab ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                ahead = parts[2].trim_start_matches('+').parse().unwrap_or(0);
                behind = parts[3].trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            dirty += 1;
        }
    }

    Ok(format!("{}\n{}\n{}\n{}", branch, ahead, behind, dirty))
}

/// Checkout a branch.
#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<String, String> {
    run_git(&repo_path, &["checkout", &branch])
}

/// Push to remote.
#[tauri::command]
pub fn git_push(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["push"])
}

/// Pull from remote.
#[tauri::command]
pub fn git_pull(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["pull"])
}

/// List all tags.
#[tauri::command]
pub fn git_tags(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["tag", "-l", "--sort=-version:refname"])
}
