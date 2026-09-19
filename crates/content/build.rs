//! Discovers content JSON under `content/` at build time and embeds it.
//!
//! Content is organized as `<category>/<certification>/<version>/<file>.json`.
//! Two content types are discovered, by path:
//!
//! - `**/learning/**/*.json` -> learning knowledge maps (`LearningDomain`)
//! - every other JSON file    -> quiz content bundles (`ContentBundle`)
//!
//! The distinction is made from the directory, never by trial deserialization,
//! so a schema mistake fails validation instead of silently loading as the
//! wrong type. `cargo:rerun-if-changed` on the directory makes Cargo rebuild
//! when files are added, removed, or edited.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Returns whether a path sits under a `learning/` directory.
fn is_learning(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name == "learning")
    })
}

/// Returns whether a path is a certification-level catalog bundle.
///
/// Catalog bundles are named `bundle.json` in this repository. They are loaded
/// before per-domain files so a domain can extend or correct the skeleton.
fn is_catalog_bundle(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "bundle.json")
}

fn collect_json_files(dir: &Path, quiz: &mut Vec<PathBuf>, learning: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect();
    paths.sort();

    for path in paths {
        if path.is_dir() {
            collect_json_files(&path, quiz, learning);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            if is_learning(&path) {
                learning.push(path);
            } else {
                quiz.push(path);
            }
        }
    }
}

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let content_dir = manifest_dir.join("../../content");
    println!("cargo:rerun-if-changed={}", content_dir.display());

    let mut quiz = Vec::new();
    let mut learning = Vec::new();
    collect_json_files(&content_dir, &mut quiz, &mut learning);

    // A catalog bundle declares the certification, version, domains, and
    // concepts, and may carry a small sample of questions. Per-domain files
    // expand those tasks. Merge order decides which wins, so catalog bundles are
    // embedded first and domain files extend them afterwards.
    quiz.sort_by_key(|path| !is_catalog_bundle(path));

    if quiz.is_empty() {
        panic!(
            "no quiz content JSON files found under {}. Ensure the content directory is present and contains at least one bundle.",
            content_dir.display()
        );
    }

    let mut generated = String::from("/// Quiz content JSON sources discovered at build time.\n");
    generated.push_str("pub static EMBEDDED_SOURCES: &[&str] = &[\n");
    for file in &quiz {
        generated.push_str(&format!("    include_str!({file:?}),\n"));
    }
    generated.push_str("];\n\n");

    generated.push_str("/// Learning content JSON sources discovered at build time.\n");
    generated.push_str("pub static EMBEDDED_LEARNING_SOURCES: &[&str] = &[\n");
    for file in &learning {
        generated.push_str(&format!("    include_str!({file:?}),\n"));
    }
    generated.push_str("];\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set"));
    fs::write(out_dir.join("embedded_content.rs"), generated).expect("write generated content");
}
