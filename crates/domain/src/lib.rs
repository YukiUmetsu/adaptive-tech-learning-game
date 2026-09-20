//! Core domain types for the adaptive learning game.
//!
//! This crate holds plain data types and invariants that do not depend on the
//! database, HTTP, or any provider. Persistence and transport layers map to and
//! from these types. Phase 0 intentionally covers only the foundational
//! `users` and `sync_batches` concepts.

pub mod concept_state;
pub mod evaluation;
pub mod learning;
pub mod reward;
pub mod sync;
pub mod user;

pub use concept_state::{
    ConceptObservation, ConceptState, MODEL_VERSION, PRIOR_ESTIMATE, confidence, forgetting_risk,
    retrievability, uncertainty, update_concept_state,
};
pub use evaluation::{
    CalibrationBucket, ConceptPrediction, EvaluationSummary, PredictionSample, QuestionPrediction,
    brier_score, calibration_buckets, evaluate, log_loss, mean_observed, mean_prediction,
    predict_question,
};
pub use learning::{
    AssessmentMode, ConceptWeight, InteractionType, LearningEvent, MissionInstance, MissionStatus,
    QuizMode,
};
pub use reward::{BASE_BITS, DAILY_MISSION_BONUS_BITS, reward_bits};
pub use sync::{NewSyncBatch, SyncBatch, SyncBatchStatus};
pub use user::{NewUser, User};

/// Errors raised when a value violates a domain invariant.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    /// A field failed validation.
    #[error("invalid {field}: {reason}")]
    Invalid {
        /// Name of the offending field.
        field: &'static str,
        /// Human-readable reason the value was rejected.
        reason: &'static str,
    },
}

impl DomainError {
    /// Builds a new invariant error.
    pub const fn invalid(field: &'static str, reason: &'static str) -> Self {
        Self::Invalid { field, reason }
    }
}
