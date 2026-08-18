//! Symbol index and impact analysis.
//!
//! A real index over the repository, not the model re-reading files: definitions
//! and references are extracted with per-language patterns so "what breaks if I
//! change this?" is answered from data rather than from a guess.
//!
//! Deliberately lexical, not semantic. It resolves names, not types — a method
//! called `run` on two unrelated classes looks like one symbol here. That is a
//! known ceiling, surfaced in the UI as "possible" callers rather than certain
//! ones; resolving it properly needs a language server per language.

use crate::git;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

const MAX_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Clone)]
pub struct Definition {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: usize,
    pub exported: bool,
}

#[derive(Serialize, Clone)]
pub struct Reference {
    pub name: String,
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Serialize)]
pub struct Impact {
    pub path: String,
    pub definitions: Vec<Definition>,
    /// Files whose import/require/use mentions this module.
    pub importers: Vec<Reference>,
    /// Uses of the symbols defined here, elsewhere in the repo.
    pub callers: Vec<Reference>,
    /// Subset of the above that live in test files.
    pub tests: Vec<String>,
    pub files_affected: usize,
    pub scanned: usize,
    pub truncated: bool,
}

/// Definition patterns, capture group 1 = the name.
fn definition_patterns() -> Vec<(Regex, &'static str)> {
    let p = |s: &str, k: &'static str| (Regex::new(s).unwrap(), k);
    vec![
        p(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)", "function"),
        p(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)", "class"),
        p(r"^\s*(?:export\s+)?interface\s+(\w+)", "interface"),
        p(r"^\s*(?:export\s+)?type\s+(\w+)", "type"),
        p(r"^\s*(?:export\s+)?enum\s+(\w+)", "enum"),
        p(r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)", "const"),
        p(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", "fn"),
        p(r"^\s*(?:pub\s+)?struct\s+(\w+)", "struct"),
        p(r"^\s*(?:pub\s+)?trait\s+(\w+)", "trait"),
        p(r"^\s*(?:pub\s+)?impl(?:<[^>]*>)?\s+(\w+)", "impl"),
        p(r"^\s*def\s+(\w+)", "def"),
        p(r"^\s*func\s+(?:\([^)]*\)\s*)?(\w+)", "func"),
    ]
}

fn is_test(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("/test") || p.starts_with("test") || p.contains("__tests__")
        || p.contains(".test.") || p.contains(".spec.") || p.ends_with("_test.go")
        || p.ends_with("_test.py") || p.contains("/spec/")
}

fn read_text(root: &str, rel: &str) -> Option<String> {
    let abs = Path::new(root).join(rel);
    let meta = fs::metadata(&abs).ok()?;
    if meta.len() > MAX_BYTES {
        return None;
    }
    let bytes = fs::read(&abs).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).to_string())
}

fn tracked(root: &str) -> Vec<String> {
    git::run(root, &["ls-files", "-z"])
        .unwrap_or_default()
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Definitions in one file.
pub fn definitions_in(root: &str, rel: &str) -> Vec<Definition> {
    let Some(text) = read_text(root, rel) else { return vec![] };
    let pats = definition_patterns();
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();

    for (i, line) in text.lines().enumerate() {
        for (re, kind) in &pats {
            if let Some(c) = re.captures(line) {
                let name = c[1].to_string();
                if name.len() < 2 || !seen.insert((name.clone(), *kind)) {
                    continue;
                }
                out.push(Definition {
                    name,
                    kind: (*kind).to_string(),
                    path: rel.to_string(),
                    line: i + 1,
                    // Rust's `pub` and JS/TS `export` both mean "others can use it".
                    exported: line.contains("export") || line.trim_start().starts_with("pub "),
                });
                break;
            }
        }
    }
    out
}

#[tauri::command]
pub async fn symbol_index(root: String, query: String) -> Result<Vec<Definition>, String> {
    let needle = query.to_lowercase();
    let mut out = Vec::new();
    for rel in tracked(&root) {
        for d in definitions_in(&root, &rel) {
            if needle.is_empty() || d.name.to_lowercase().contains(&needle) {
                out.push(d);
            }
            if out.len() > 500 {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

/// What else in the repo depends on this file.
#[tauri::command]
pub async fn analyze_impact(root: String, path: String) -> Result<Impact, String> {
    impact_of(&root, &path)
}

pub fn impact_of(root: &str, path: &str) -> Result<Impact, String> {
    let root = root.to_string();
    let path = path.to_string();
    let definitions = definitions_in(&root, &path);

    // Only exported names can be depended on from elsewhere; if nothing is
    // marked exported the language probably has no such marker, so use all.
    let mut names: Vec<String> = definitions
        .iter()
        .filter(|d| d.exported)
        .map(|d| d.name.clone())
        .collect();
    if names.is_empty() {
        names = definitions.iter().map(|d| d.name.clone()).collect();
    }
    names.sort();
    names.dedup();

    let stem = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let name_re = if names.is_empty() {
        None
    } else {
        Some(
            Regex::new(&format!(
                r"\b({})\b",
                names.iter().map(|n| regex::escape(n)).collect::<Vec<_>>().join("|")
            ))
            .map_err(|e| e.to_string())?,
        )
    };
    let import_re = Regex::new(&format!(
        r#"(?:import|require|from|use|include)\b[^\n]*['"/:]{}\b"#,
        regex::escape(&stem)
    ))
    .map_err(|e| e.to_string())?;

    let mut importers = Vec::new();
    let mut callers = Vec::new();
    let mut affected: BTreeSet<String> = BTreeSet::new();
    let mut tests: BTreeSet<String> = BTreeSet::new();
    let mut scanned = 0usize;
    let mut truncated = false;

    for rel in tracked(&root) {
        if rel == path {
            continue;
        }
        let Some(text) = read_text(&root, &rel) else { continue };
        scanned += 1;

        for (i, line) in text.lines().enumerate() {
            if import_re.is_match(line) {
                importers.push(Reference {
                    name: stem.clone(),
                    path: rel.clone(),
                    line: i + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                affected.insert(rel.clone());
                if is_test(&rel) {
                    tests.insert(rel.clone());
                }
            } else if let Some(re) = &name_re {
                if let Some(m) = re.captures(line) {
                    if callers.len() < 400 {
                        callers.push(Reference {
                            name: m[1].to_string(),
                            path: rel.clone(),
                            line: i + 1,
                            text: line.trim().chars().take(200).collect(),
                        });
                        affected.insert(rel.clone());
                        if is_test(&rel) {
                            tests.insert(rel.clone());
                        }
                    } else {
                        truncated = true;
                    }
                }
            }
        }
    }

    Ok(Impact {
        path,
        definitions,
        importers,
        callers,
        tests: tests.into_iter().collect(),
        files_affected: affected.len(),
        scanned,
        truncated,
    })
}

/// Definition counts per file, for a quick repo overview.
#[tauri::command]
pub async fn symbol_summary(root: String) -> Result<BTreeMap<String, usize>, String> {
    let mut out = BTreeMap::new();
    for rel in tracked(&root) {
        let n = definitions_in(&root, &rel).len();
        if n > 0 {
            out.insert(rel, n);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as Cmd;

    fn repo(name: &str, files: &[(&str, &str)]) -> String {
        let dir = std::env::temp_dir().join(format!("claude-ide-impact-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Cmd::new("git").current_dir(&dir).args(["init", "-q"]).output().unwrap();
        for (rel, body) in files {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        Cmd::new("git").current_dir(&dir).args(["add", "-A"]).output().unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn extracts_definitions_across_languages() {
        let root = repo("defs", &[
            ("a.ts", "export function login(u: string) {}\nexport const MAX = 5\nclass Helper {}\n"),
            ("b.rs", "pub fn parse() {}\nstruct Inner;\n"),
            ("c.py", "def handle():\n    pass\n"),
        ]);
        let ts = definitions_in(&root, "a.ts");
        assert!(ts.iter().any(|d| d.name == "login" && d.kind == "function" && d.exported));
        assert!(ts.iter().any(|d| d.name == "MAX" && d.exported));
        assert!(ts.iter().any(|d| d.name == "Helper" && !d.exported), "unexported class");

        assert!(definitions_in(&root, "b.rs").iter().any(|d| d.name == "parse" && d.exported));
        assert!(definitions_in(&root, "c.py").iter().any(|d| d.name == "handle"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_importers_callers_and_tests() {
        let root = repo("impact", &[
            ("src/auth.ts", "export function login() {}\nexport function logout() {}\n"),
            ("src/page.ts", "import { login } from './auth'\nlogin()\n"),
            ("tests/auth.test.ts", "import { login } from '../src/auth'\nlogin()\n"),
            ("src/unrelated.ts", "export const x = 1\n"),
        ]);

        let r = impact_of(&root, "src/auth.ts").unwrap();
        assert_eq!(r.definitions.len(), 2);
        assert!(r.importers.iter().any(|i| i.path == "src/page.ts"));
        assert!(r.callers.iter().any(|c| c.path == "src/page.ts" && c.name == "login"));
        assert!(r.tests.contains(&"tests/auth.test.ts".to_string()), "test files are flagged");
        assert_eq!(r.files_affected, 2, "unrelated.ts must not be counted");
        let _ = std::fs::remove_dir_all(&root);
    }
}
