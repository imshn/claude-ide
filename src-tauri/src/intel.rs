//! Project Intelligence: a deterministic scan of what a repository *is*.
//!
//! Deliberately contains no model call. Everything here is read off manifests,
//! lockfiles and the git index, so opening a repo costs milliseconds and zero
//! tokens. The result is summarised into a small card that gets handed to Claude
//! once per task, which is what stops it re-discovering the repo every turn.

use crate::git;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Serialize, Default, Clone)]
pub struct Intel {
    pub root: String,
    pub name: String,
    pub languages: Vec<String>,
    pub frameworks: Vec<String>,
    pub package_manager: String,
    pub test_framework: String,
    pub database: String,
    pub scripts: BTreeMap<String, String>,
    pub build_cmd: String,
    pub test_cmd: String,
    pub dev_cmd: String,
    pub typecheck_cmd: String,
    pub entry_points: Vec<String>,
    pub config_files: Vec<String>,
    /// CLAUDE.md / AGENTS.md and friends — project instructions we must respect.
    pub instruction_files: Vec<String>,
    pub top_dirs: Vec<DirStat>,
    pub file_count: usize,
    pub line_count: usize,
    /// Files git knows about but that are too large / binary to count.
    pub skipped: usize,
}

#[derive(Serialize, Default, Clone)]
pub struct DirStat {
    pub name: String,
    pub files: usize,
}

fn exists(root: &str, rel: &str) -> bool {
    Path::new(root).join(rel).exists()
}

fn read(root: &str, rel: &str) -> Option<String> {
    fs::read_to_string(Path::new(root).join(rel)).ok()
}

/// Package manager is decided by lockfile, which is the only reliable signal —
/// the presence of package.json says nothing about how it is installed.
fn detect_package_manager(root: &str) -> String {
    for (file, name) in [
        ("bun.lockb", "Bun"),
        ("bun.lock", "Bun"),
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "Yarn"),
        ("package-lock.json", "npm"),
        ("deno.lock", "Deno"),
        ("uv.lock", "uv"),
        ("poetry.lock", "Poetry"),
        ("Pipfile.lock", "Pipenv"),
        ("Cargo.lock", "Cargo"),
        ("go.sum", "Go modules"),
        ("Gemfile.lock", "Bundler"),
        ("composer.lock", "Composer"),
    ] {
        if exists(root, file) {
            return name.into();
        }
    }
    if exists(root, "package.json") {
        return "npm".into();
    }
    String::new()
}

/// Cheap dependency lookup: we only ever ask "is this name present", so parsing
/// the manifest as raw text beats pulling in a JSON dependency graph walker.
fn deps_of(pkg: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(pkg) {
        for key in ["dependencies", "devDependencies", "peerDependencies"] {
            if let Some(map) = v.get(key).and_then(|d| d.as_object()) {
                out.extend(map.keys().cloned());
            }
        }
    }
    out
}

fn first_match(hay: &[String], pairs: &[(&str, &str)]) -> String {
    for (needle, label) in pairs {
        if hay.iter().any(|d| d == needle) {
            return (*label).into();
        }
    }
    String::new()
}

fn all_matches(hay: &[String], pairs: &[(&str, &str)]) -> Vec<String> {
    let mut out = Vec::new();
    for (needle, label) in pairs {
        if hay.iter().any(|d| d == needle) && !out.contains(&label.to_string()) {
            out.push((*label).to_string());
        }
    }
    out
}

#[tauri::command]
pub async fn project_intel(root: String) -> Result<Intel, String> {
    let mut intel = Intel {
        root: root.clone(),
        name: Path::new(&root)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        package_manager: detect_package_manager(&root),
        ..Default::default()
    };

    // ---- Node / TypeScript ------------------------------------------------
    if let Some(pkg) = read(&root, "package.json") {
        let deps = deps_of(&pkg);

        intel.languages.push(
            if exists(&root, "tsconfig.json") { "TypeScript" } else { "JavaScript" }.into(),
        );

        intel.frameworks = all_matches(
            &deps,
            &[
                ("next", "Next.js"), ("react", "React"), ("vue", "Vue"),
                ("svelte", "Svelte"), ("@angular/core", "Angular"), ("solid-js", "Solid"),
                ("astro", "Astro"), ("nuxt", "Nuxt"), ("express", "Express"),
                ("fastify", "Fastify"), ("@nestjs/core", "NestJS"), ("hono", "Hono"),
                ("vite", "Vite"), ("@tauri-apps/api", "Tauri"), ("electron", "Electron"),
                ("tailwindcss", "Tailwind"), ("react-native", "React Native"),
            ],
        );

        intel.test_framework = first_match(
            &deps,
            &[
                ("vitest", "Vitest"), ("jest", "Jest"), ("@playwright/test", "Playwright"),
                ("cypress", "Cypress"), ("mocha", "Mocha"), ("ava", "AVA"), ("bun:test", "Bun test"),
            ],
        );

        intel.database = first_match(
            &deps,
            &[
                ("@prisma/client", "Prisma"), ("drizzle-orm", "Drizzle"), ("pg", "PostgreSQL"),
                ("postgres", "PostgreSQL"), ("mysql2", "MySQL"), ("mongoose", "MongoDB"),
                ("better-sqlite3", "SQLite"), ("redis", "Redis"), ("@supabase/supabase-js", "Supabase"),
            ],
        );

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&pkg) {
            if let Some(s) = v.get("scripts").and_then(|s| s.as_object()) {
                for (k, val) in s {
                    if let Some(cmd) = val.as_str() {
                        intel.scripts.insert(k.clone(), cmd.to_string());
                    }
                }
            }
        }

        // Prefer the project's own scripts over a guessed command.
        let run = match intel.package_manager.as_str() {
            "Bun" => "bun run",
            "pnpm" => "pnpm",
            "Yarn" => "yarn",
            "Deno" => "deno task",
            _ => "npm run",
        };
        for (key, slot) in [
            ("build", &mut intel.build_cmd),
            ("test", &mut intel.test_cmd),
            ("dev", &mut intel.dev_cmd),
            ("typecheck", &mut intel.typecheck_cmd),
        ] {
            if intel.scripts.contains_key(key) {
                *slot = format!("{run} {key}");
            }
        }
        if intel.typecheck_cmd.is_empty() && intel.scripts.contains_key("check-types") {
            intel.typecheck_cmd = format!("{run} check-types");
        }
    }

    // ---- Other ecosystems -------------------------------------------------
    if let Some(cargo) = read(&root, "Cargo.toml") {
        intel.languages.push("Rust".into());
        if intel.build_cmd.is_empty() {
            intel.build_cmd = "cargo build".into();
        }
        if intel.test_cmd.is_empty() {
            intel.test_cmd = "cargo test".into();
        }
        if cargo.contains("tauri") && !intel.frameworks.iter().any(|f| f == "Tauri") {
            intel.frameworks.push("Tauri".into());
        }
    }
    if exists(&root, "go.mod") {
        intel.languages.push("Go".into());
        if intel.test_cmd.is_empty() {
            intel.test_cmd = "go test ./...".into();
        }
        if intel.build_cmd.is_empty() {
            intel.build_cmd = "go build ./...".into();
        }
    }
    if exists(&root, "pyproject.toml") || exists(&root, "requirements.txt") || exists(&root, "setup.py") {
        intel.languages.push("Python".into());
        if intel.test_cmd.is_empty() {
            intel.test_cmd = "pytest".into();
        }
        if intel.test_framework.is_empty() {
            intel.test_framework = "pytest".into();
        }
    }
    if exists(&root, "Gemfile") {
        intel.languages.push("Ruby".into());
    }
    if exists(&root, "pom.xml") || exists(&root, "build.gradle") || exists(&root, "build.gradle.kts") {
        intel.languages.push("Java/Kotlin".into());
    }

    if intel.database.is_empty() {
        if exists(&root, "prisma/schema.prisma") {
            intel.database = "Prisma".into();
        } else if let Some(compose) =
            read(&root, "docker-compose.yml").or_else(|| read(&root, "docker-compose.yaml"))
        {
            for (needle, label) in [
                ("postgres", "PostgreSQL"), ("mysql", "MySQL"),
                ("mongo", "MongoDB"), ("redis", "Redis"),
            ] {
                if compose.contains(needle) {
                    intel.database = label.into();
                    break;
                }
            }
        }
    }

    // ---- Notable files ----------------------------------------------------
    for f in [
        "CLAUDE.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md",
        "CONTRIBUTING.md",
    ] {
        if exists(&root, f) {
            intel.instruction_files.push(f.into());
        }
    }
    for f in [
        "package.json", "tsconfig.json", "vite.config.ts", "next.config.js", "next.config.mjs",
        "Cargo.toml", "go.mod", "pyproject.toml", "Dockerfile", "docker-compose.yml",
        "tailwind.config.js", ".env.example", "Makefile",
    ] {
        if exists(&root, f) {
            intel.config_files.push(f.into());
        }
    }
    for f in [
        "src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts", "src/App.tsx",
        "app/page.tsx", "pages/index.tsx", "src/main.rs", "main.go", "main.py", "src/app.ts",
        "index.js", "server.js",
    ] {
        if exists(&root, f) {
            intel.entry_points.push(f.into());
        }
    }

    // ---- Size, from the git index so ignored files never inflate it -------
    if let Ok(listing) = git::run(&root, &["ls-files", "-z"]) {
        let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
        for rel in listing.split('\0').filter(|s| !s.is_empty()) {
            intel.file_count += 1;
            let top = rel.split('/').next().unwrap_or(rel);
            let key = if top == rel { ".".to_string() } else { top.to_string() };
            *dirs.entry(key).or_insert(0) += 1;

            let path = Path::new(&root).join(rel);
            match fs::metadata(&path) {
                // Skip anything large enough to be a lockfile, asset or blob.
                Ok(m) if m.len() > 512 * 1024 => intel.skipped += 1,
                Ok(_) => match fs::read(&path) {
                    Ok(bytes) if !bytes.contains(&0) => {
                        intel.line_count += bytes.iter().filter(|b| **b == b'\n').count();
                    }
                    _ => intel.skipped += 1,
                },
                Err(_) => intel.skipped += 1,
            }
        }
        let mut stats: Vec<DirStat> = dirs
            .into_iter()
            .map(|(name, files)| DirStat { name, files })
            .collect();
        stats.sort_by(|a, b| b.files.cmp(&a.files));
        stats.truncate(8);
        intel.top_dirs = stats;
    }

    intel.languages.dedup();
    Ok(intel)
}
