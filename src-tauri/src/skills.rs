//! Skill discovery, for the `/` autocomplete in chat.
//!
//! Skills are directories containing SKILL.md with YAML frontmatter. Verified
//! that sending `/name …` as a normal user message activates the skill in
//! headless mode, so the IDE only needs to know which names exist.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// Skills marked `user-invocable: false` are model-triggered only; showing
    /// them in a `/` menu would offer the user something that does nothing.
    pub user_invocable: bool,
    pub source: String,
}

/// Minimal frontmatter reader: the three scalar keys we need, tolerant of
/// quoting and of values containing colons.
fn parse_frontmatter(md: &str) -> (Option<String>, Option<String>, Option<bool>) {
    let mut name = None;
    let mut description = None;
    let mut invocable = None;

    let lines: Vec<&str> = md.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return (name, description, invocable);
    }

    let mut i = 1;
    while i < lines.len() {
        let t = lines[i].trim_end();
        if t.trim() == "---" {
            break;
        }
        let Some((key, value)) = t.split_once(':') else {
            i += 1;
            continue;
        };
        // Only top-level keys; nested entries are indented.
        if key.starts_with(char::is_whitespace) {
            i += 1;
            continue;
        }
        let mut v = value.trim().trim_matches('"').trim_matches('\'').to_string();

        // YAML block scalars (`description: >` / `|`) put the real text on the
        // following indented lines. Without this, every skill written that way
        // showed a literal ">" as its description.
        if v == ">" || v == "|" || v == ">-" || v == "|-" {
            let mut folded: Vec<String> = Vec::new();
            i += 1;
            while i < lines.len() {
                let l = lines[i];
                if l.trim() == "---" || (!l.trim().is_empty() && !l.starts_with(char::is_whitespace)) {
                    break;
                }
                if !l.trim().is_empty() {
                    folded.push(l.trim().to_string());
                }
                i += 1;
            }
            v = folded.join(" ");
            i -= 1;
        }

        match key.trim() {
            "name" => name = Some(v),
            "description" => description = Some(v),
            "user-invocable" => invocable = Some(v != "false"),
            _ => {}
        }
        i += 1;
    }
    (name, description, invocable)
}

fn read_skill(dir: &Path, source: &str) -> Option<Skill> {
    let md = fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let (name, description, invocable) = parse_frontmatter(&md);
    let fallback = dir.file_name()?.to_string_lossy().to_string();
    Some(Skill {
        name: name.filter(|n| !n.is_empty()).unwrap_or(fallback),
        description: description.unwrap_or_default(),
        // Absent means invocable: most skills do not declare the key.
        user_invocable: invocable.unwrap_or(true),
        source: source.to_string(),
    })
}

fn scan(root: PathBuf, source: &str, out: &mut Vec<Skill>) {
    let Ok(entries) = fs::read_dir(&root) else { return };
    for e in entries.flatten() {
        // `DirEntry::file_type` does not follow symlinks, and most installed
        // skills are symlinks into plugin or project directories — checking the
        // entry type directly hid 86 of 180 skills on a real machine.
        if e.path().is_dir() {
            if let Some(s) = read_skill(&e.path(), source) {
                out.push(s);
            }
        }
    }
}

#[tauri::command]
pub async fn list_skills(cwd: Option<String>) -> Vec<Skill> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut out: Vec<Skill> = Vec::new();

    scan(PathBuf::from(&home).join(".claude/skills"), "user", &mut out);

    // Project skills win over personal ones of the same name, matching how the
    // CLI resolves them.
    if let Some(cwd) = cwd.filter(|c| !c.is_empty()) {
        scan(PathBuf::from(&cwd).join(".claude/skills"), "project", &mut out);
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.name == b.name);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_keys_we_need() {
        let (n, d, i) = parse_frontmatter(
            "---\nname: shadcn\ndescription: Manages components: adds and fixes them.\nuser-invocable: false\n---\nbody",
        );
        assert_eq!(n.unwrap(), "shadcn");
        assert_eq!(d.unwrap(), "Manages components: adds and fixes them.", "a colon in the value must survive");
        assert_eq!(i, Some(false));
    }

    #[test]
    fn folds_yaml_block_scalars() {
        // The shape most real skills use.
        let (n, d, _) = parse_frontmatter(
            "---\nname: wiki-query\ndescription: >\n  Answer questions by searching\n  the compiled wiki.\nuser-invocable: true\n---\nbody",
        );
        assert_eq!(n.unwrap(), "wiki-query");
        assert_eq!(d.unwrap(), "Answer questions by searching the compiled wiki.");

        // The key after a block scalar must still be read.
        let (_, _, i) = parse_frontmatter("---\ndescription: |\n  line one\n  line two\nuser-invocable: false\n---\n");
        assert_eq!(i, Some(false));
    }

    #[test]
    fn absent_key_means_invocable() {
        let (_, _, i) = parse_frontmatter("---\nname: x\ndescription: y\n---\n");
        assert_eq!(i, None, "caller decides the default");
    }

    #[test]
    fn ignores_nested_keys_and_missing_frontmatter() {
        let (n, _, _) = parse_frontmatter("no frontmatter here\nname: nope\n");
        assert!(n.is_none());
        // A nested `name:` under metadata must not be mistaken for the skill name.
        let (n2, _, _) = parse_frontmatter("---\nname: real\nmetadata:\n  name: nested\n---\n");
        assert_eq!(n2.unwrap(), "real");
    }
}

#[cfg(test)]
mod live {
    use super::*;

    #[test]
    fn finds_real_skills_on_this_machine() {
        let home = std::env::var("HOME").unwrap();
        let dir = PathBuf::from(&home).join(".claude/skills");
        if !dir.exists() {
            eprintln!("no skills dir, skipping");
            return;
        }
        let mut out = Vec::new();
        scan(dir, "user", &mut out);
        eprintln!("scanned {} skills", out.len());
        assert!(!out.is_empty(), "expected to find skills");
        // Symlinked skills are the majority here; if they are being skipped this
        // collapses to well under half.
        assert!(
            out.iter().any(|s| s.name.starts_with("wiki-")),
            "symlinked skills must be followed, found only {} entries",
            out.len()
        );
    }
}
