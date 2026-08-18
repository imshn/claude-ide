//! Filesystem watcher.
//!
//! Without this the change list only refreshed when a turn ended or on demand,
//! so anything that touched the tree from outside the app — a terminal command,
//! another editor, a `git checkout` — left the IDE showing stale state.

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Long enough that a save-plus-format or a multi-file write arrives as one
/// event, short enough to feel immediate.
const DEBOUNCE: Duration = Duration::from_millis(350);

#[derive(Default)]
pub struct Watchers(pub Mutex<Option<RecommendedWatcher>>);

/// Directories whose churn is never interesting and would swamp the channel.
const IGNORED: &[&str] = &[
    "/.git/", "/node_modules/", "/target/", "/dist/", "/.next/", "/build/",
    "/.venv/", "/__pycache__/", "/.turbo/", "/coverage/",
];

fn interesting(path: &Path) -> bool {
    let s = path.to_string_lossy();
    // `.git/index.lock` and friends fire constantly during any git operation.
    if IGNORED.iter().any(|d| s.contains(d)) {
        return false;
    }
    !s.ends_with('~') && !s.contains("/.DS_Store")
}

#[tauri::command]
pub fn watch_start(app: AppHandle, state: State<Watchers>, root: String) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    // Dropping the previous watcher unregisters it.
    *slot = None;

    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(Ok(event)) => {
                    for p in event.paths.iter().filter(|p| interesting(p)) {
                        let s = p.to_string_lossy().to_string();
                        if !pending.contains(&s) {
                            pending.push(s);
                        }
                    }
                }
                Ok(Err(_)) => {}
                // Quiet for a debounce window: flush whatever accumulated.
                Err(RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        let batch = std::mem::take(&mut pending);
                        let _ = app.emit("fs-changed", batch);
                    }
                }
                // The watcher was dropped; nothing more will arrive.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    *slot = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn watch_stop(state: State<Watchers>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_noisy_directories() {
        assert!(!interesting(Path::new("/r/.git/index.lock")));
        assert!(!interesting(Path::new("/r/node_modules/x/y.js")));
        assert!(!interesting(Path::new("/r/src-tauri/target/debug/x")));
        assert!(!interesting(Path::new("/r/src/.DS_Store")));
        assert!(!interesting(Path::new("/r/src/a.ts~")));

        assert!(interesting(Path::new("/r/src/auth.ts")));
        assert!(interesting(Path::new("/r/tests/auth.test.ts")));
        // A directory merely *named* like an ignored one must still count.
        assert!(interesting(Path::new("/r/src/git/helper.ts")));
        assert!(interesting(Path::new("/r/distribution/notes.md")));
    }
}
