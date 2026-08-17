//! Claude Code integration.
//!
//! We drive the user's already-installed `claude` binary through its supported
//! headless streaming interface:
//!
//!   claude -p --input-format stream-json --output-format stream-json --verbose
//!
//! stdin takes newline-delimited user messages, stdout emits newline-delimited
//! events (system/init, assistant, user tool-results, result). Authentication,
//! subscription, and limits are entirely Claude Code's business — we never see a
//! token and never pass one.

use crate::shellenv;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Sessions(pub Mutex<HashMap<String, Session>>);

pub struct Session {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Serialize, Clone)]
pub struct Detection {
    pub found: bool,
    pub path: String,
    pub version: String,
    pub searched: Vec<String>,
}

fn candidate_paths() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in shellenv::login_path().split(':') {
        if !dir.is_empty() {
            out.push(PathBuf::from(dir).join("claude"));
        }
    }
    for rel in [
        ".local/bin/claude",
        ".claude/local/claude",
        ".bun/bin/claude",
        ".npm-global/bin/claude",
    ] {
        out.push(PathBuf::from(&home).join(rel));
    }
    for abs in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
        out.push(PathBuf::from(abs));
    }
    out
}

fn probe(path: &PathBuf) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let mut cmd = Command::new(path);
    shellenv::with_path(&mut cmd);
    let out = cmd.arg("--version").output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Locate the local Claude Code CLI. `override_path` wins when the user has
/// pointed us at a specific binary in Settings.
#[tauri::command]
pub fn claude_detect(override_path: Option<String>) -> Detection {
    let mut searched = Vec::new();

    if let Some(p) = override_path.filter(|p| !p.is_empty()) {
        let pb = PathBuf::from(&p);
        searched.push(p.clone());
        if let Some(version) = probe(&pb) {
            return Detection { found: true, path: p, version, searched };
        }
    }

    let mut seen = Vec::new();
    for cand in candidate_paths() {
        let s = cand.to_string_lossy().to_string();
        if seen.contains(&s) {
            continue;
        }
        seen.push(s.clone());
        searched.push(s.clone());
        if let Some(version) = probe(&cand) {
            return Detection { found: true, path: s, version, searched };
        }
    }

    Detection { found: false, path: String::new(), version: String::new(), searched }
}

#[derive(Serialize, Clone)]
struct Event<'a> {
    session: &'a str,
    kind: &'a str,
    data: serde_json::Value,
}

fn emit(app: &AppHandle, session: &str, kind: &str, data: serde_json::Value) {
    let _ = app.emit("claude", Event { session, kind, data });
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn claude_start(
    app: AppHandle,
    state: State<Sessions>,
    id: String,
    cwd: String,
    bin: String,
    model: Option<String>,
    permission_mode: Option<String>,
    resume: Option<String>,
    // Skip the user's MCP servers. Measured at ~209k tokens of cache creation
    // per session on a full config. The IDE supplies project context itself.
    lean: Option<bool>,
    // Path to the generated settings file carrying the approval hook.
    settings: Option<String>,
    // low | medium | high | xhigh | max
    effort: Option<String>,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if map.contains_key(&id) {
        return Err("session already running".into());
    }

    let mut cmd = Command::new(if bin.is_empty() { "claude".into() } else { bin });
    shellenv::with_path(&mut cmd);
    cmd.current_dir(&cwd)
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ])
        // Edits land on disk so the Changes workspace can review them. Every turn
        // is checkpointed first and nothing is committed automatically.
        .args(["--permission-mode", permission_mode.as_deref().unwrap_or("acceptEdits")]);

    if lean.unwrap_or(true) {
        cmd.arg("--strict-mcp-config");
    }
    if let Some(s) = settings.filter(|s| !s.is_empty()) {
        cmd.args(["--settings", &s]);
    }
    if let Some(e) = effort.filter(|e| !e.is_empty()) {
        cmd.args(["--effort", &e]);
    }
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        cmd.args(["--model", &m]);
    }
    if let Some(r) = resume.filter(|r| !r.is_empty()) {
        cmd.args(["--resume", &r]);
    }

    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("could not start Claude Code: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    {
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(v) => emit(&app, &id, "message", v),
                    // Anything non-JSON on stdout is CLI chatter, not a protocol event.
                    Err(_) => emit(&app, &id, "raw", serde_json::json!(trimmed)),
                }
            }
            emit(&app, &id, "closed", serde_json::json!(null));
        });
    }

    {
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                emit(&app, &id, "stderr", serde_json::json!(line));
            }
        });
    }

    map.insert(id, Session { child, stdin });
    Ok(())
}

/// A file the user attached in chat.
#[derive(serde::Deserialize)]
pub struct Attachment {
    pub name: String,
    /// "image" sends a vision block; anything else is inlined as text.
    pub kind: String,
    pub mime: String,
    pub base64: Option<String>,
    pub text: Option<String>,
}

#[tauri::command]
pub fn claude_send(
    state: State<Sessions>,
    id: String,
    text: String,
    attachments: Option<Vec<Attachment>>,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let session = map.get_mut(&id).ok_or("no such session")?;

    let mut content: Vec<serde_json::Value> = Vec::new();
    if !text.trim().is_empty() {
        content.push(serde_json::json!({ "type": "text", "text": text }));
    }

    // Verified against 2.1.226: base64 image blocks on stdin reach the model —
    // it read text out of a PNG sent this way.
    for a in attachments.unwrap_or_default() {
        match (a.kind.as_str(), a.base64, a.text) {
            ("image", Some(data), _) => content.push(serde_json::json!({
                "type": "image",
                "source": { "type": "base64", "media_type": a.mime, "data": data },
            })),
            (_, _, Some(body)) => content.push(serde_json::json!({
                "type": "text",
                "text": format!("Attached file `{}`:\n\n{}", a.name, body),
            })),
            _ => {}
        }
    }
    if content.is_empty() {
        return Ok(());
    }

    let payload =
        serde_json::json!({ "type": "user", "message": { "role": "user", "content": content } });
    writeln!(session.stdin, "{payload}").map_err(|e| e.to_string())?;
    session.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn claude_stop(state: State<Sessions>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = map.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn claude_running(state: State<Sessions>, id: String) -> bool {
    state.0.lock().map(|m| m.contains_key(&id)).unwrap_or(false)
}
