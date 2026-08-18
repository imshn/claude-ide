//! Debug session launcher.
//!
//! Spawns the target under an inspector and hands the webview the WebSocket URL
//! for the Chrome DevTools Protocol. The protocol itself is spoken from
//! TypeScript — it is JSON over a socket, and keeping it there means the UI
//! reads paused state directly instead of through an IPC relay.
//!
//! Verified against Node 24: with `--inspect-brk` no script is parsed before the
//! program runs, so breakpoints must be set by file URL up front rather than by
//! waiting for `Debugger.scriptParsed`.

use crate::shellenv;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Debuggers(pub Mutex<HashMap<String, Child>>);

#[derive(Serialize, Clone)]
pub struct DebugTarget {
    pub id: String,
    pub ws_url: String,
    pub port: u16,
    pub pid: u32,
}

#[derive(Serialize, Clone)]
struct DebugOut<'a> {
    id: &'a str,
    stream: &'a str,
    line: String,
}

/// A free localhost port, found by binding one and letting it go.
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(9229)
}

/// The inspector needs a moment to open; poll rather than sleep a fixed guess.
fn wait_for_ws(port: u16) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let url = format!("http://127.0.0.1:{port}/json/list");

    while Instant::now() < deadline {
        let mut cmd = Command::new("curl");
        shellenv::with_path(&mut cmd);
        if let Ok(out) = cmd.args(["-s", "--max-time", "2", &url]).output() {
            if out.status.success() {
                let body = String::from_utf8_lossy(&out.stdout);
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(ws) = v
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|t| t.get("webSocketDebuggerUrl"))
                        .and_then(|u| u.as_str())
                    {
                        return Ok(ws.to_string());
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    Err("the inspector did not open in time".into())
}

#[tauri::command]
pub async fn debug_start(
    app: AppHandle,
    state: State<'_, Debuggers>,
    id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    runtime: Option<String>,
) -> Result<DebugTarget, String> {
    let port = free_port();
    let runtime = runtime.unwrap_or_else(|| "node".into());

    let mut cmd = Command::new(&runtime);
    shellenv::with_path(&mut cmd);
    cmd.current_dir(&cwd)
        // -brk so breakpoints can be set before a single line executes.
        .arg(format!("--inspect-brk=127.0.0.1:{port}"))
        .arg(&program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {runtime}: {e}"))?;
    let pid = child.id();

    for (stream, reader) in [
        ("stdout", child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)),
        ("stderr", child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)),
    ] {
        let Some(r) = reader else { continue };
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(r).lines().map_while(Result::ok) {
                let _ = app.emit("debug-output", DebugOut { id: &id, stream, line });
            }
        });
    }

    match wait_for_ws(port) {
        Ok(ws_url) => {
            state.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), child);
            Ok(DebugTarget { id, ws_url, port, pid })
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn debug_stop(state: State<'_, Debuggers>, id: String) -> Result<(), String> {
    if let Some(mut child) = state.0.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn debug_running(state: State<'_, Debuggers>, id: String) -> Result<bool, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.contains_key(&id))
}
