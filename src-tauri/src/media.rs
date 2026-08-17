//! Binary file access for media viewers and chat attachments.
//!
//! The webview cannot read local files directly, and Tauri's asset protocol
//! would need a scope per opened folder. Base64 over IPC is simpler and fine at
//! the sizes a person actually opens or attaches.

use serde::Serialize;
use std::path::Path;

/// Generous but finite: a 4K screenshot is ~10MB, a short screen recording more.
/// Base64 inflates by a third and it all crosses IPC as a string.
const MAX_BYTES: u64 = 48 * 1024 * 1024;

#[derive(Serialize)]
pub struct Blob {
    pub mime: String,
    pub base64: String,
    pub size: u64,
    pub kind: String,
}

/// Extension -> (mime, kind). `kind` is what the UI switches on.
pub fn describe(path: &str) -> (String, String) {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let (mime, kind) = match ext.as_str() {
        // Images
        "png" => ("image/png", "image"),
        "jpg" | "jpeg" => ("image/jpeg", "image"),
        "gif" => ("image/gif", "image"),
        "webp" => ("image/webp", "image"),
        "avif" => ("image/avif", "image"),
        "bmp" => ("image/bmp", "image"),
        "ico" => ("image/x-icon", "image"),
        "tif" | "tiff" => ("image/tiff", "image"),
        "heic" => ("image/heic", "image"),
        "heif" => ("image/heif", "image"),
        "jxl" => ("image/jxl", "image"),
        // SVG is text, but it renders as an image and is worth both views.
        "svg" => ("image/svg+xml", "svg"),
        // Video
        "mp4" | "m4v" => ("video/mp4", "video"),
        "webm" => ("video/webm", "video"),
        "mov" => ("video/quicktime", "video"),
        "mkv" => ("video/x-matroska", "video"),
        "avi" => ("video/x-msvideo", "video"),
        "ogv" => ("video/ogg", "video"),
        // Audio
        "mp3" => ("audio/mpeg", "audio"),
        "wav" => ("audio/wav", "audio"),
        "m4a" => ("audio/mp4", "audio"),
        "aac" => ("audio/aac", "audio"),
        "flac" => ("audio/flac", "audio"),
        "ogg" | "oga" => ("audio/ogg", "audio"),
        "opus" => ("audio/opus", "audio"),
        "aiff" | "aif" => ("audio/aiff", "audio"),
        // Documents we can preview in the webview
        "pdf" => ("application/pdf", "pdf"),
        // Fonts render nowhere useful, but knowing the type avoids a bad text view.
        "woff" | "woff2" | "ttf" | "otf" => ("font/other", "binary"),
        "zip" | "gz" | "tar" | "dmg" | "wasm" | "so" | "dylib" | "a" | "o" => {
            ("application/octet-stream", "binary")
        }
        _ => ("text/plain", "text"),
    };
    (mime.into(), kind.into())
}

#[tauri::command]
pub async fn media_kind(path: String) -> (String, String) {
    describe(&path)
}

#[tauri::command]
pub async fn read_binary(path: String) -> Result<Blob, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "file is {:.1} MB, over the {} MB preview limit",
            meta.len() as f64 / 1_048_576.0,
            MAX_BYTES / 1_048_576
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (mime, kind) = describe(&path);
    Ok(Blob {
        mime,
        kind,
        size: meta.len(),
        base64: b64(&bytes),
    })
}

/// Small base64 encoder — one call site, not worth a dependency.
fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for c in bytes.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18 & 63) as usize] as char);
        out.push(T[(n >> 12 & 63) as usize] as char);
        out.push(if c.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foob"), "Zm9vYg==");
        assert_eq!(b64(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
        // Bytes above 0x7f must not be mangled — images are full of them.
        assert_eq!(b64(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(b64(&[0x00, 0x00, 0x00]), "AAAA");
    }

    #[test]
    fn kinds_route_to_the_right_viewer() {
        assert_eq!(describe("a/b.png").1, "image");
        assert_eq!(describe("a/b.SVG").1, "svg", "extension match is case-insensitive");
        assert_eq!(describe("a/b.mp4").1, "video");
        assert_eq!(describe("a/b.flac").1, "audio");
        assert_eq!(describe("a/b.pdf").1, "pdf");
        assert_eq!(describe("a/b.ts").1, "text");
        assert_eq!(describe("Makefile").1, "text", "no extension is still text");
        assert_eq!(describe("a/b.woff2").1, "binary");
    }
}
