//! Versioned certification content: schema, validation, canonical scoring, and
//! an immutable registry of embedded bundles.

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded_content.rs"));
}

pub mod discovery;
pub mod learning;
pub mod model;
pub mod practice_test;
pub mod registry;
pub mod scoring;
pub mod validate;

pub use discovery::{
    DomainDiscoveryInput, DomainDiscoveryState, derive_domain_discovery, is_node_unlocked,
    is_prompt_complete, merge_domain_discovery,
};

/// A content JSON file embedded at build time.
///
/// `path` is repository-relative and used for diagnostics, so a validation
/// error can name the file an author needs to fix.
#[derive(Debug, Clone, Copy)]
pub struct EmbeddedSource {
    /// Repository-relative path, for diagnostics.
    pub path: &'static str,
    /// Raw JSON contents.
    pub json: &'static str,
}

pub use embedded::{EMBEDDED_LEARNING_SOURCES, EMBEDDED_PRACTICE_TEST_SOURCES, EMBEDDED_SOURCES};
pub use learning::*;
pub use model::*;
pub use practice_test::{
    PRACTICE_TEST_SCHEMA_VERSION, PracticeTest, PracticeTestItem, validate_practice_test,
};
pub use registry::ContentRegistry;
pub use scoring::{ScoredAnswer, ScoringError, SubmittedAnswer, normalize_typed_answer, score};
pub use validate::{ContentError, validate};
