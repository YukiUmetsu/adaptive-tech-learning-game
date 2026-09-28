//! Core domain types for the adaptive learning game.
//!
//! This crate holds plain data types and invariants that do not depend on the
//! database, HTTP, or any provider. Persistence and transport layers map to and
//! from these types. Phase 0 intentionally covers only the foundational
//! `users` and `sync_batches` concepts.

pub mod concept_state;
pub mod cyber_defense;
pub mod cyber_operation;
pub mod cyber_story;
pub mod evaluation;
pub mod learning;
pub mod reward;
pub mod streak;
pub mod sync;
pub mod user;

pub use concept_state::{
    ConceptObservation, ConceptState, MODEL_VERSION, PRIOR_ESTIMATE, confidence, forgetting_risk,
    retrievability, uncertainty, update_concept_state,
};
pub use cyber_defense::{
    CAMPAIGN_MISSIONS, CAREER_MAX_LEVEL, CyberReward, DEFAULT_HEALTH_RATIO_THRESHOLD,
    DEFAULT_HERO_IDS, HERO_MAX_LEVEL, HERO_PROGRESSION, HeroMilestone, HeroProgressionDefinition,
    HeroTalentChoice, OperationOutcome, THREAT_LEVEL_MAX, THREAT_LEVEL_MIN, TOWER_UPGRADES,
    ThreatRecommendationInput, TowerUpgradeDefinition, adversary_progress_award,
    adversary_rank_from_progress, career_level_from_xp, career_rank, career_xp_to_next_level,
    fixed_mission_reward, hero_level_from_xp, hero_milestone_choices, hero_progression,
    hero_xp_to_next_level, is_campaign_mission, is_known_hero, is_legal_talent, operation_reward,
    recommend_threat_level, tower_level, tower_upgrade, tower_upgrade_cost, unlocked_threat_level,
    xp_for_career_level, xp_for_hero_level,
};
pub use cyber_operation::{
    GeneratedModifier, GeneratedOperation, GeneratedSpawnGroup, GeneratedWave,
    OPERATION_ADVERSARIES, OPERATION_ATTACKS, OPERATION_DEFENSES, OPERATION_MAPS,
    OPERATION_MODIFIERS, OPERATION_TEMPLATES, OperationAdversary, OperationAttack,
    OperationDefense, OperationGenerationError, OperationGenerationInput, OperationMap,
    OperationModifier, OperationTemplate, generate_operation, map_has_node, map_reaches,
    operation_adversary, operation_attack, operation_defense, operation_map, operation_modifier,
    operation_template, validate_generated_operation,
};
pub use cyber_story::{
    STORY_NODES, StoryNodeDefinition, StoryProgressInput, StoryTrigger, active_chapter,
    evaluate_story_nodes, story_node,
};
pub use evaluation::{
    CalibrationBucket, ConceptPrediction, EvaluationSummary, PredictionSample, QuestionPrediction,
    brier_score, calibration_buckets, evaluate, log_loss, mean_observed, mean_prediction,
    predict_question,
};
pub use learning::{
    AssessmentMode, ConceptWeight, ErrorRemediation, InteractionType, LearningEvent,
    MissionInstance, MissionStatus, PEDAGOGY_MAX_SCAFFOLD_LEVEL, PEDAGOGY_MIN_SCAFFOLD_LEVEL,
    PEDAGOGY_STAGE_COUNT, PedagogyMetadata, PedagogyStage, QuizMode,
};
pub use reward::{
    BASE_BITS, DAILY_MISSION_BONUS_BITS, SECTION_QUIZ_BONUS_BITS, cyber_defense_upgrade_bits,
    reward_bits,
};
pub use streak::{StreakSummary, summarize_streak};
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
