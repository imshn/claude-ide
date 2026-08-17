//! HTTP client for the API workbench.
//!
//! Shells out to `curl` rather than pulling in a TLS stack: it ships with macOS,
//! already handles redirects, proxies, HTTP/2 and every auth scheme, and keeps
//! the build light. Arguments are passed as argv (never through a shell), so a
//! URL or header value cannot inject a command.

use crate::media::describe;
use crate::shellenv;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Instant;

#[derive(Deserialize)]
pub struct Header {
    pub key: String,
    pub value: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub follow_redirects: Option<bool>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub insecure: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct ResponseHeader {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<ResponseHeader>,
    pub body: String,
    /// Set instead of `body` when the response is not text.
    pub body_is_binary: bool,
    pub content_type: String,
    pub ms: u64,
    pub size: u64,
}

/// Parse curl's dumped headers. Redirect chains produce several blocks; the last
/// one is the response the user actually received.
fn parse_headers(raw: &str) -> (u16, String, Vec<ResponseHeader>) {
    let blocks: Vec<&str> = raw
        .split("\r\n\r\n")
        .flat_map(|b| b.split("\n\n"))
        .filter(|b| b.trim_start().starts_with("HTTP/"))
        .collect();

    let last = blocks.last().copied().unwrap_or("");
    let mut lines = last.lines();
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.split_whitespace();
    let _proto = parts.next();
    let status: u16 = parts.next().and_then(|c| c.parse().ok()).unwrap_or(0);
    let status_text = parts.collect::<Vec<_>>().join(" ");

    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| ResponseHeader { key: k.trim().to_string(), value: v.trim().to_string() })
        .collect();

    (status, status_text, headers)
}

#[tauri::command]
pub async fn api_send(req: ApiRequest) -> Result<ApiResponse, String> {
    if req.url.trim().is_empty() {
        return Err("no URL".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir();
    let head_path = dir.join(format!("claude-ide-h-{stamp}"));
    let body_path = dir.join(format!("claude-ide-b-{stamp}"));
    let payload_path = dir.join(format!("claude-ide-p-{stamp}"));

    let mut cmd = Command::new("curl");
    shellenv::with_path(&mut cmd);
    cmd.args(["-sS", "--globoff"])
        .args(["-X", req.method.trim()])
        .args(["-D".as_ref(), head_path.as_os_str()])
        .args(["-o".as_ref(), body_path.as_os_str()])
        .args(["--max-time", &req.timeout_secs.unwrap_or(60).to_string()]);

    if req.follow_redirects.unwrap_or(true) {
        cmd.arg("-L");
    }
    if req.insecure.unwrap_or(false) {
        cmd.arg("-k");
    }
    for h in req.headers.iter().filter(|h| h.enabled && !h.key.trim().is_empty()) {
        cmd.args(["-H", &format!("{}: {}", h.key.trim(), h.value)]);
    }
    if let Some(body) = req.body.as_ref().filter(|b| !b.is_empty()) {
        std::fs::write(&payload_path, body).map_err(|e| e.to_string())?;
        cmd.arg("--data-binary");
        let mut at = std::ffi::OsString::from("@");
        at.push(&payload_path);
        cmd.arg(at);
    }
    cmd.arg(req.url.trim());

    let started = Instant::now();
    let out = cmd.output().map_err(|e| format!("curl: {e}"))?;
    let ms = started.elapsed().as_millis() as u64;

    let cleanup = || {
        let _ = std::fs::remove_file(&head_path);
        let _ = std::fs::remove_file(&body_path);
        let _ = std::fs::remove_file(&payload_path);
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        cleanup();
        return Err(if err.is_empty() { "request failed".into() } else { err });
    }

    let raw_head = std::fs::read_to_string(&head_path).unwrap_or_default();
    let (status, status_text, headers) = parse_headers(&raw_head);
    let bytes = std::fs::read(&body_path).unwrap_or_default();
    cleanup();

    let content_type = headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case("content-type"))
        .map(|h| h.value.clone())
        .unwrap_or_default();

    // Treat anything with a NUL as binary; that is what a text pane cannot show.
    let binary = bytes.contains(&0);
    let size = bytes.len() as u64;
    let body = if binary {
        format!("<{} bytes of {}>", size, if content_type.is_empty() { "binary".into() } else { content_type.clone() })
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    Ok(ApiResponse { status, status_text, headers, body, body_is_binary: binary, content_type, ms, size })
}

/// Read a Postman collection or environment straight off disk for import.
#[tauri::command]
pub async fn read_json_file(path: String) -> Result<String, String> {
    let (_, kind) = describe(&path);
    if kind == "binary" {
        return Err("not a JSON file".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_final_response_of_a_redirect_chain() {
        let raw = "HTTP/1.1 301 Moved Permanently\r\nLocation: https://x\r\n\r\nHTTP/2 200 OK\r\nContent-Type: application/json\r\nX-Trace: abc\r\n\r\n";
        let (status, text, headers) = parse_headers(raw);
        assert_eq!(status, 200);
        assert_eq!(text, "OK");
        assert_eq!(headers.len(), 2);
        assert_eq!(headers[0].key, "Content-Type");
        assert_eq!(headers[1].value, "abc");
    }

    #[test]
    fn handles_a_single_response_and_a_value_containing_colons() {
        let (status, _, headers) = parse_headers("HTTP/1.1 404 Not Found\r\nDate: Mon, 17 Aug 2026 10:00:00 GMT\r\n\r\n");
        assert_eq!(status, 404);
        assert_eq!(headers[0].value, "Mon, 17 Aug 2026 10:00:00 GMT");
    }

    #[test]
    fn survives_garbage() {
        let (status, _, headers) = parse_headers("");
        assert_eq!(status, 0);
        assert!(headers.is_empty());
    }
}
