//! Versioned certification content: schema, validation, canonical scoring, and
//! an immutable registry of embedded bundles.

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded_content.rs"));
}

pub mod learning;
pub mod model;
pub mod registry;
pub mod scoring;
pub mod validate;

pub use embedded::{EMBEDDED_LEARNING_SOURCES, EMBEDDED_SOURCES};
pub use learning::*;
pub use model::*;
pub use registry::ContentRegistry;
pub use scoring::{ScoredAnswer, ScoringError, SubmittedAnswer, normalize_typed_answer, score};
pub use validate::{ContentError, validate};
