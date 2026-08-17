//! Repository search: literal, regex, filename and symbol modes.
//!
//! The file list comes from `git ls-files`, so .gitignore is respected for free
//! and we never walk node_modules. Semantic ("where do we validate JWTs?")
//! search is deliberately not here — that runs through Claude in the UI layer,
//! because a real semantic index is a much larger commitment than this.

use crate::git;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct Hit {
    pub path: String,
    pub line: usize,
    pub col: usize,
    pub text: String,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

#[derive(Serialize)]
pub struct Results {
    pub hits: Vec<Hit>,
    pub files: Vec<String>,
    pub truncated: bool,
    pub scanned: usize,
}

const MAX_HITS: usize = 300;
const MAX_BYTES: u64 = 512 * 1024;

fn escape(s: &str) -> String {
    regex::escape(s)
}

/// Common definition forms across the languages this IDE is likely to see.
fn symbol_pattern(name: &str) -> String {
    let n = escape(name);
    format!(
        r"(?:\b(?:function|class|interface|type|enum|struct|trait|impl|def|fn|const|let|var|module|namespace)\s+{n}\b)|(?:\b{n}\s*[:=]\s*(?:async\s*)?(?:function|\()) |(?:^\s*{n}\s*\()"
    )
}

#[tauri::command]
pub async fn repo_search(
    root: String,
    query: String,
    mode: String,
    case_sensitive: bool,
) -> Result<Results, String> {
    if query.trim().is_empty() {
        return Ok(Results { hits: vec![], files: vec![], truncated: false, scanned: 0 });
    }

    let listing = git::run(&root, &["ls-files", "-z"]).unwrap_or_default();
    let paths: Vec<&str> = listing.split('\0').filter(|s| !s.is_empty()).collect();

    // Filename mode never opens a file.
    if mode == "file" {
        let q = query.to_lowercase();
        let files: Vec<String> = paths
            .iter()
            .filter(|p| p.to_lowercase().contains(&q))
            .take(200)
            .map(|p| p.to_string())
            .collect();
        let n = paths.len();
        return Ok(Results { hits: vec![], files, truncated: false, scanned: n });
    }

    let pattern = match mode.as_str() {
        "regex" => query.clone(),
        "symbol" => symbol_pattern(&query),
        _ => escape(&query),
    };
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("bad pattern: {e}"))?;

    let mut hits = Vec::new();
    let mut truncated = false;
    let mut scanned = 0usize;

    for rel in &paths {
        if hits.len() >= MAX_HITS {
            truncated = true;
            break;
        }
        let abs = Path::new(&root).join(rel);
        match fs::metadata(&abs) {
            Ok(m) if m.len() <= MAX_BYTES => {}
            _ => continue,
        }
        let bytes = match fs::read(&abs) {
            Ok(b) if !b.contains(&0) => b,
            _ => continue,
        };
        scanned += 1;
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if hits.len() >= MAX_HITS {
                truncated = true;
                break;
            }
            if let Some(m) = re.find(line) {
                hits.push(Hit {
                    path: rel.to_string(),
                    line: i + 1,
                    col: m.start() + 1,
                    text: line.chars().take(400).collect(),
                    before: lines[i.saturating_sub(2)..i].iter().map(|s| s.to_string()).collect(),
                    after: lines[(i + 1).min(lines.len())..(i + 3).min(lines.len())]
                        .iter()
                        .map(|s| s.to_string())
                        .collect(),
                });
            }
        }
    }

    Ok(Results { hits, files: vec![], truncated, scanned })
}
