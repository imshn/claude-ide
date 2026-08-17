//! Tool-permission approvals.
//!
//! Claude Code exposes no `--permission-prompt-tool` in 2.1.226, but a
//! `PreToolUse` hook can return `permissionDecision`, and that decision is
//! honoured (verified: a denied Bash call comes back as an errored tool_result
//! carrying our reason). So the IDE stands up a loopback HTTP server, writes a
//! hook script that POSTs each tool request to it and blocks, and answers with
//! the user's decision.
//!
//! Everything is 127.0.0.1 only and the port is ephemeral. Nothing is exposed
//! off-machine, and the hook is added to a session-scoped settings file rather
//! than to the user's own configuration.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// How long a tool call may sit unanswered before we fail closed.
const TIMEOUT: Duration = Duration::from_secs(600);

type Waiters = Arc<Mutex<HashMap<String, Sender<String>>>>;

#[derive(Default)]
pub struct Approvals {
    waiters: Waiters,
    port: OnceLock<u16>,
    counter: Mutex<u64>,
}

#[derive(Serialize, Clone)]
struct Request {
    id: String,
    tool: String,
    input: serde_json::Value,
    cwd: String,
}

fn decision(verdict: &str, reason: &str) -> String {
    serde_json::json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": verdict,
            "permissionDecisionReason": reason,
        }
    })
    .to_string()
}

/// Start the loopback server once and return its port.
fn ensure_server(app: &AppHandle, state: &Approvals) -> Result<u16, String> {
    if let Some(p) = state.port.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let _ = state.port.set(port);

    let waiters = state.waiters.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let waiters = waiters.clone();
            let app = app.clone();
            std::thread::spawn(move || handle(stream, app, waiters));
        }
    });
    Ok(port)
}

fn handle(mut stream: TcpStream, app: AppHandle, waiters: Waiters) {
    let body = match read_body(&mut stream) {
        Some(b) => b,
        None => return,
    };
    let payload: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();

    let id = format!("ap-{}", uuid_like());
    let req = Request {
        id: id.clone(),
        tool: payload["tool_name"].as_str().unwrap_or("unknown").to_string(),
        input: payload["tool_input"].clone(),
        cwd: payload["cwd"].as_str().unwrap_or("").to_string(),
    };

    let (tx, rx) = channel::<String>();
    waiters.lock().ok().map(|mut w| w.insert(id.clone(), tx));

    let verdict = if app.emit("approval", &req).is_err() {
        decision("deny", "Claude IDE could not present this request")
    } else {
        match rx.recv_timeout(TIMEOUT) {
            Ok(v) => v,
            // Fail closed: an unanswered request must never become an approval.
            Err(_) => decision("deny", "Timed out waiting for approval in Claude IDE"),
        }
    };
    waiters.lock().ok().map(|mut w| w.remove(&id));

    let res = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        verdict.len(),
        verdict
    );
    let _ = stream.write_all(res.as_bytes());
    let _ = stream.flush();
}

fn read_body(stream: &mut TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut len = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(v) = trimmed.strip_prefix("Content-Length:") {
            len = v.trim().parse().unwrap_or(0);
        }
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{n:x}")
}

/// Write the hook script + a settings file, and return the settings path to
/// hand to `claude --settings`.
#[tauri::command]
pub fn approval_setup(app: AppHandle, state: State<Approvals>) -> Result<String, String> {
    let port = ensure_server(&app, &state)?;
    let dir = std::env::temp_dir().join("claude-ide");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Per-process filenames. Two IDE windows would otherwise share one settings
    // file, and the second to start would repoint the first one's hook at its
    // own port — approvals then surface in the wrong window, or nowhere.
    let pid = std::process::id();
    let hook: PathBuf = dir.join(format!("permission-hook-{pid}.sh"));
    let script = format!(
        r#"#!/bin/bash
# Written by Claude IDE. Forwards each tool request to the running IDE and
# blocks until the user decides. Denies if the IDE is unreachable.
payload=$(cat)
reply=$(curl -sS -m {timeout} -X POST -H 'content-type: application/json' \
  --data-binary "$payload" "http://127.0.0.1:{port}/ask" 2>/dev/null)
if [ -z "$reply" ]; then
  printf '%s' '{fallback}'
else
  printf '%s' "$reply"
fi
"#,
        timeout = TIMEOUT.as_secs(),
        port = port,
        fallback = decision("deny", "Claude IDE was not reachable").replace('\'', "'\\''"),
    );
    std::fs::write(&hook, script).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())?;

    // One matcher covering every tool that touches the machine. Whether a given
    // call is auto-allowed or shown to the user is decided in the UI, so the
    // policy lives in one place instead of being split across a regex.
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "Bash|Write|Edit|NotebookEdit|WebFetch|WebSearch|Task",
                "hooks": [{ "type": "command", "command": hook.to_string_lossy() }]
            }]
        }
    });
    let path = dir.join(format!("settings-{pid}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn approval_respond(
    state: State<Approvals>,
    id: String,
    allow: bool,
    reason: String,
) -> Result<(), String> {
    let verdict = decision(
        if allow { "allow" } else { "deny" },
        if reason.is_empty() {
            if allow { "Approved in Claude IDE" } else { "Declined in Claude IDE" }
        } else {
            &reason
        },
    );
    let mut waiters = state.waiters.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = waiters.remove(&id) {
        let _ = tx.send(verdict);
    }
    Ok(())
}

/// Bump and read a counter — used by the UI to label sessions distinctly.
#[tauri::command]
pub fn approval_stats(state: State<Approvals>) -> u64 {
    let mut c = state.counter.lock().unwrap();
    *c += 1;
    *c
}

