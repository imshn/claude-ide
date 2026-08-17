//! Git via the `git` binary rather than libgit2: no native build, and it always
//! behaves exactly like the git the user already has configured.

use crate::shellenv;
use serde::Serialize;
use std::process::Command;

pub fn run(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    shellenv::with_path(&mut cmd);
    cmd.current_dir(cwd).args(args);
    let out = cmd.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn run_env(cwd: &str, args: &[&str], env: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    shellenv::with_path(&mut cmd);
    cmd.current_dir(cwd).args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[derive(Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub index: String,
    pub worktree: String,
}

#[derive(Serialize)]
pub struct RepoStatus {
    pub is_repo: bool,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<StatusEntry>,
}

#[tauri::command]
pub fn git_status(cwd: String) -> Result<RepoStatus, String> {
    if run(&cwd, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(RepoStatus {
            is_repo: false,
            branch: String::new(),
            ahead: 0,
            behind: 0,
            entries: vec![],
        });
    }
    let branch = run(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();

    let (mut ahead, mut behind) = (0, 0);
    if let Ok(counts) = run(&cwd, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
        let nums: Vec<u32> = counts
            .split_whitespace()
            .filter_map(|n| n.parse().ok())
            .collect();
        if nums.len() == 2 {
            behind = nums[0];
            ahead = nums[1];
        }
    }

    let raw = run(&cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let mut entries = Vec::new();
    let mut chunks = raw.split('\0').filter(|s| !s.is_empty()).peekable();
    while let Some(chunk) = chunks.next() {
        if chunk.len() < 3 {
            continue;
        }
        let bytes: Vec<char> = chunk.chars().collect();
        let index = bytes[0].to_string();
        let worktree = bytes[1].to_string();
        let path: String = chunk[3..].to_string();
        // Renames carry a second NUL-separated path; consume it.
        if index == "R" || index == "C" {
            chunks.next();
        }
        entries.push(StatusEntry {
            path,
            index,
            worktree,
        });
    }

    Ok(RepoStatus {
        is_repo: true,
        branch,
        ahead,
        behind,
        entries,
    })
}

#[tauri::command]
pub fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    let owned: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(owned);
    run(&cwd, &args).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["restore", "--staged", "--"];
    let owned: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(owned);
    run(&cwd, &args).map(|_| ())
}

#[tauri::command]
pub fn git_commit(cwd: String, message: String) -> Result<String, String> {
    run(&cwd, &["commit", "-m", &message])
}

#[tauri::command]
pub fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    let out = run(&cwd, &["branch", "--format=%(refname:short)"])?;
    Ok(out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

#[tauri::command]
pub fn git_checkout(cwd: String, branch: String) -> Result<String, String> {
    run(&cwd, &["checkout", &branch])
}

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[tauri::command]
pub fn git_log(cwd: String, limit: u32) -> Result<Vec<Commit>, String> {
    let fmt = "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s";
    let n = format!("-{limit}");
    let out = run(&cwd, &["log", &n, fmt])?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\u{1f}').collect();
            (f.len() == 5).then(|| Commit {
                hash: f[0].into(),
                short: f[1].into(),
                author: f[2].into(),
                date: f[3].into(),
                subject: f[4].into(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_repo_root(cwd: String) -> Result<String, String> {
    Ok(run(&cwd, &["rev-parse", "--show-toplevel"])?.trim().to_string())
}

#[tauri::command]
pub fn git_init(cwd: String) -> Result<String, String> {
    run(&cwd, &["init"])
}

// ---------------------------------------------------------------------------
// Checkpoints: a snapshot of the entire working tree written into git's object
// store via a throwaway index. Nothing about HEAD, the real index, or the user's
// stash is touched, and the objects survive so we can diff or restore later.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn checkpoint_create(cwd: String) -> Result<String, String> {
    let idx = std::env::temp_dir().join(format!("claude-ide-index-{}", std::process::id()));
    let idx_str = idx.to_string_lossy().to_string();
    let _ = std::fs::remove_file(&idx);
    let env = [("GIT_INDEX_FILE", idx_str.as_str())];
    run_env(&cwd, &["add", "-A", "."], &env)?;
    let tree = run_env(&cwd, &["write-tree"], &env)?;
    let _ = std::fs::remove_file(&idx);
    Ok(tree.trim().to_string())
}

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

/// Files that differ between a checkpoint tree and the working tree right now.
#[tauri::command]
pub fn checkpoint_changes(cwd: String, tree: String) -> Result<Vec<ChangedFile>, String> {
    let now = checkpoint_create(cwd.clone())?;
    let out = run(&cwd, &["diff", "--name-status", "-z", &tree, &now])?;
    let mut files = Vec::new();
    let mut it = out.split('\0').filter(|s| !s.is_empty());
    while let (Some(status), Some(path)) = (it.next(), it.next()) {
        // Rename entries are status, old, new — take the new path.
        let path = if status.starts_with('R') || status.starts_with('C') {
            it.next().unwrap_or(path)
        } else {
            path
        };
        files.push(ChangedFile {
            path: path.to_string(),
            status: status.chars().next().unwrap_or('M').to_string(),
        });
    }
    Ok(files)
}

/// File contents as of a checkpoint. Empty string when the file did not exist.
#[tauri::command]
pub fn file_at_tree(cwd: String, tree: String, path: String) -> Result<String, String> {
    match run(&cwd, &["show", &format!("{tree}:{path}")]) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

/// Unified diff of a single file against HEAD, for the Git panel.
#[tauri::command]
pub fn git_file_diff(cwd: String, path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(&path);
    run(&cwd, &args)
}
