//! Discovers content bundles under `content/` at build time and embeds them.
//!
//! Content is organized as `<category>/<certification>/<version>/<file>.json`.
//! Adding a certification or version requires no code change: drop the JSON
//! into the tree and rebuild. `cargo:rerun-if-changed` on the directory makes
//! Cargo rebuild when files are added, removed, or edited.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn collect_json_files(dir: &Path, files: &mut Vec<PathBuf>) {
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
            collect_json_files(&path, files);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            files.push(path);
        }
    }
}

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let content_dir = manifest_dir.join("../../content");
    println!("cargo:rerun-if-changed={}", content_dir.display());

    let mut files = Vec::new();
    collect_json_files(&content_dir, &mut files);

    if files.is_empty() {
        panic!(
            "no content JSON files found under {}. Ensure the content directory is present and contains at least one bundle.",
            content_dir.display()
        );
    }

    let mut generated = String::from("/// Content JSON sources discovered at build time.\n");
    generated.push_str("pub static EMBEDDED_SOURCES: &[&str] = &[\n");
    for file in &files {
        generated.push_str(&format!("    include_str!({file:?}),\n"));
    }
    generated.push_str("];\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set"));
    fs::write(out_dir.join("embedded_content.rs"), generated).expect("write generated content");
}
