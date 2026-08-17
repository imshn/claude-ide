//! A GUI .app launched from Finder inherits a bare PATH (/usr/bin:/bin:...), so
//! `claude`, `git` from Homebrew, node, etc. are invisible. Resolve the user's real
//! PATH once from a login shell — the same trick editors like VS Code use.

use std::process::Command;
use std::sync::OnceLock;

static LOGIN_PATH: OnceLock<String> = OnceLock::new();

pub fn login_path() -> &'static str {
    LOGIN_PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(&shell)
            .args(["-l", "-i", "-c", "printf %s \"$PATH\""])
            .output();
        let resolved = out
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_default();

        let current = std::env::var("PATH").unwrap_or_default();
        // Union, login shell first, so we never lose what we already had.
        let mut parts: Vec<&str> = Vec::new();
        for p in resolved.split(':').chain(current.split(':')) {
            if !p.is_empty() && !parts.contains(&p) {
                parts.push(p);
            }
        }
        parts.join(":")
    })
}

/// Apply the resolved PATH to a command.
pub fn with_path(cmd: &mut Command) {
    cmd.env("PATH", login_path());
}
