//! Discovers content JSON under `content/` at build time and embeds it.
//!
//! Content is organized as `<category>/<certification>/<version>/<file>.json`.
//! Three content types are discovered, by path:
//!
//! - `**/learning/**/*.json`       -> learning knowledge maps (`LearningDomain`)
//! - `**/practice-tests/**/*.json` -> practice-test exams (`practice-test-v2`)
//! - every other JSON file         -> quiz content bundles (`ContentBundle`)
//!
//! The distinction is made from the directory, never by trial deserialization,
//! so a schema mistake fails validation instead of silently loading as the
//! wrong type. `cargo:rerun-if-changed` on the directory makes Cargo rebuild
//! when files are added, removed, or edited.
//!
//! Every embedded file also carries its repository-relative path, so a
//! validation error can name the file an author needs to fix.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Returns whether a path sits under a directory with the given name.
fn has_component(path: &Path, name: &str) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|component| component == name)
    })
}

/// Returns whether a path sits under a `learning/` directory.
fn is_learning(path: &Path) -> bool {
    has_component(path, "learning")
}

/// Returns whether a path sits under a `practice-tests/` directory.
///
/// Practice tests use the `practice-test-v2` schema, which is distinct from a
/// scored `ContentBundle`. They are embedded as their own content type so a
/// practice test is never misparsed as a quiz bundle.
fn is_practice_test(path: &Path) -> bool {
    has_component(path, "practice-tests")
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

fn collect_json_files(
    dir: &Path,
    quiz: &mut Vec<PathBuf>,
    learning: &mut Vec<PathBuf>,
    practice: &mut Vec<PathBuf>,
) {
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
            collect_json_files(&path, quiz, learning, practice);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            if is_learning(&path) {
                learning.push(path);
            } else if is_practice_test(&path) {
                practice.push(path);
            } else {
                quiz.push(path);
            }
        }
    }
}

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let repo_root = manifest_dir.join("../..");
    let content_dir = manifest_dir.join("../../content");
    println!("cargo:rerun-if-changed={}", content_dir.display());

    let mut quiz = Vec::new();
    let mut learning = Vec::new();
    let mut practice = Vec::new();
    collect_json_files(&content_dir, &mut quiz, &mut learning, &mut practice);

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

    let mut generated = String::new();

    push_source_static(
        &mut generated,
        &["Quiz content JSON sources discovered at build time."],
        "EMBEDDED_SOURCES",
        &quiz,
        &repo_root,
    );
    push_source_static(
        &mut generated,
        &["Learning content JSON sources discovered at build time."],
        "EMBEDDED_LEARNING_SOURCES",
        &learning,
        &repo_root,
    );
    push_source_static(
        &mut generated,
        &[
            "Practice-test JSON sources discovered at build time.",
            "",
            "These use the `practice-test-v2` schema and are parsed as a",
            "distinct content type by `ContentRegistry`; they are never parsed",
            "as a scored quiz bundle.",
        ],
        "EMBEDDED_PRACTICE_TEST_SOURCES",
        &practice,
        &repo_root,
    );

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set"));
    fs::write(out_dir.join("embedded_content.rs"), generated).expect("write generated content");
}

/// Appends one `&[EmbeddedSource]` static covering `files`.
fn push_source_static(
    generated: &mut String,
    doc: &[&str],
    name: &str,
    files: &[PathBuf],
    repo_root: &Path,
) {
    for line in doc {
        generated.push_str(&format!("/// {line}\n"));
    }
    generated.push_str(&format!(
        "pub static {name}: &[crate::EmbeddedSource] = &[\n"
    ));
    for file in files {
        let relative = file.strip_prefix(repo_root).unwrap_or(file.as_path());
        let relative = relative.to_string_lossy();
        generated.push_str(&format!(
            "    crate::EmbeddedSource {{ path: {relative:?}, json: include_str!({file:?}) }},\n"
        ));
    }
    generated.push_str("];\n\n");
}
