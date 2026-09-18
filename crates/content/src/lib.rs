//! Versioned certification content: schema, validation, canonical scoring, and
//! an immutable registry of embedded bundles.

pub mod model;
pub mod registry;
pub mod scoring;
pub mod validate;

pub use model::*;
pub use registry::{ContentRegistry, EMBEDDED_BUNDLE};
pub use scoring::{ScoredAnswer, ScoringError, SubmittedAnswer, score};
pub use validate::{ContentError, validate};
