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
pub async fn git_status(cwd: String) -> Result<RepoStatus, String> {
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
pub async fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    let owned: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(owned);
    run(&cwd, &args).map(|_| ())
}

#[tauri::command]
pub async fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["restore", "--staged", "--"];
    let owned: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(owned);
    run(&cwd, &args).map(|_| ())
}

#[tauri::command]
pub async fn git_commit(cwd: String, message: String) -> Result<String, String> {
    run(&cwd, &["commit", "-m", &message])
}

#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    let out = run(&cwd, &["branch", "--format=%(refname:short)"])?;
    Ok(out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

#[tauri::command]
pub async fn git_checkout(cwd: String, branch: String) -> Result<String, String> {
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
pub async fn git_log(cwd: String, limit: u32) -> Result<Vec<Commit>, String> {
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
pub async fn git_repo_root(cwd: String) -> Result<String, String> {
    Ok(run(&cwd, &["rev-parse", "--show-toplevel"])?.trim().to_string())
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<String, String> {
    run(&cwd, &["init"])
}

// ---------------------------------------------------------------------------
// Checkpoints: a snapshot of the entire working tree written into git's object
// store via a throwaway index. Nothing about HEAD, the real index, or the user's
// stash is touched, and the objects survive so we can diff or restore later.
// ---------------------------------------------------------------------------

/// Plain helper: the command below and `checkpoint_changes` both need this, and
/// a Tauri command is not callable from another command once it is async.
pub fn write_tree(cwd: &str) -> Result<String, String> {
    // A unique index per call. These commands run concurrently on the async
    // runtime, and a shared per-process index meant one call could delete the
    // index another was mid-way through building — yielding an empty tree id.
    let idx = std::env::temp_dir().join(format!(
        "claude-ide-index-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let idx_str = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_str.as_str())];

    let staged = run_env(cwd, &["add", "-A", "."], &env);
    let tree = staged.and_then(|_| run_env(cwd, &["write-tree"], &env));
    let _ = std::fs::remove_file(&idx);

    let tree = tree?.trim().to_string();
    // Never hand back an empty id: downstream it is falsy and silently disables
    // the whole Changes workspace instead of reporting a failure.
    if tree.len() != 40 || !tree.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("git write-tree returned an unusable id: {tree:?}"));
    }
    // `git write-tree` on an index that failed to populate returns the *empty
    // tree*, which is valid hex and passes every shape check. Accepting it as a
    // baseline would report every file in the repo as newly added, and rejecting
    // that "change" would delete the repo. Refuse it unless the repo is genuinely
    // empty.
    if tree == EMPTY_TREE && !run(cwd, &["ls-files"]).unwrap_or_default().trim().is_empty() {
        return Err("checkpoint captured an empty tree for a non-empty repository".into());
    }
    Ok(tree)
}

/// git's hash for a tree with no entries.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as Cmd;

    fn tmp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("claude-ide-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            Cmd::new("git").current_dir(&dir).args(args).output().unwrap();
        }
        dir
    }

    #[test]
    fn captures_a_real_tree_and_sees_edits() {
        let dir = tmp_repo("real");
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let path = dir.to_string_lossy().to_string();

        let base = write_tree(&path).expect("baseline");
        assert_eq!(base.len(), 40);
        assert_ne!(base, EMPTY_TREE, "a repo with a file must not hash to the empty tree");

        // Same content twice must be stable, or every refresh looks like a change.
        assert_eq!(base, write_tree(&path).unwrap());

        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        let after = write_tree(&path).unwrap();
        assert_ne!(base, after, "an edit must change the tree id");

        let diff = run(&path, &["diff", "--name-only", &base, &after]).unwrap();
        assert!(diff.contains("a.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_snapshots_all_agree() {
        let dir = tmp_repo("concurrent");
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let path = dir.to_string_lossy().to_string();

        // Commands run on the async runtime, so this happens for real.
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let p = path.clone();
                std::thread::spawn(move || write_tree(&p))
            })
            .collect();
        let trees: Vec<String> = handles.into_iter().map(|h| h.join().unwrap().unwrap()).collect();

        assert!(trees.iter().all(|t| *t == trees[0]), "shared index race: {trees:?}");
        assert_ne!(trees[0], EMPTY_TREE);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tauri::command]
pub async fn checkpoint_create(cwd: String) -> Result<String, String> {
    write_tree(&cwd)
}

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

/// Files that differ between a checkpoint tree and the working tree right now.
#[tauri::command]
pub async fn checkpoint_changes(cwd: String, tree: String) -> Result<Vec<ChangedFile>, String> {
    let now = write_tree(&cwd)?;
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
pub async fn file_at_tree(cwd: String, tree: String, path: String) -> Result<String, String> {
    match run(&cwd, &["show", &format!("{tree}:{path}")]) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

/// Unified diff of a single file against HEAD, for the Git panel.
#[tauri::command]
pub async fn git_file_diff(cwd: String, path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(&path);
    run(&cwd, &args)
}
