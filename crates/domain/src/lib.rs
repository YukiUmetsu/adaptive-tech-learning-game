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
    CAMPAIGN_FINAL_MISSION_ID, CAMPAIGN_MISSIONS, CAMPAIGN_ORDER, CAREER_MAX_LEVEL, COSMETICS,
    CosmeticDefinition, CyberReward, DEFAULT_HEALTH_RATIO_THRESHOLD, DEFAULT_HERO_IDS,
    HERO_MAX_LEVEL, HERO_PROGRESSION, HeroMilestone, HeroProgressionDefinition, HeroTalentChoice,
    OPERATION_DURATION_TOLERANCE_MS, OPERATION_MIN_ELAPSED_MS, OPERATION_RATE_MAX_SETTLED,
    OPERATION_RATE_WINDOW_MINUTES, OperationOutcome, THREAT_LEVEL_MAX, THREAT_LEVEL_MIN,
    TOWER_UPGRADES, ThreatRecommendationInput, TowerUpgradeDefinition, adversary_progress_award,
    adversary_rank_from_progress, campaign_complete, campaign_mission_unlocked,
    campaign_prerequisite, career_level_from_xp, career_rank, career_xp_to_next_level, cosmetic,
    fixed_mission_reward, hero_level_from_xp, hero_milestone_choices, hero_progression,
    hero_xp_to_next_level, is_campaign_mission, is_known_hero, is_legal_talent,
    operation_result_is_plausible, operation_reward, recommend_threat_level, scale_xp, tower_level,
    tower_upgrade, tower_upgrade_cost, training_center_hero_xp_multiplier, unlocked_threat_level,
    xp_for_career_level, xp_for_hero_level,
};
pub use cyber_operation::{
    AdversaryUnlockInput, GeneratedModifier, GeneratedOperation, GeneratedSpawnGroup,
    GeneratedWave, MAX_OPERATION_OFFERS, OPERATION_ADVERSARIES, OPERATION_ATTACKS,
    OPERATION_DEFENSES, OPERATION_MAPS, OPERATION_MODIFIERS, OPERATION_RECENT_TEMPLATE_AVOIDANCE,
    OPERATION_TEMPLATES, OperationAdversary, OperationAttack, OperationDefense,
    OperationGenerationError, OperationGenerationInput, OperationHeroSnapshot, OperationMap,
    OperationModifier, OperationProgressionSnapshot, OperationTemplate, OperationTowerSnapshot,
    RecentOperationIdentity, available_adversaries, estimated_operation_minutes,
    generate_operation, map_has_node, map_reaches, operation_adversary, operation_attack,
    operation_defense, operation_map, operation_modifier, operation_template,
    random_selectable_templates, select_operation_offer_templates, select_operation_template,
    selectable_templates, validate_generated_operation,
};
pub use cyber_story::{
    CONFRONTATION_TEMPLATE_ID, STORY_NODES, StoryNodeDefinition, StoryProgressInput, StoryTrigger,
    active_chapter, confrontation_available, evaluate_story_nodes, story_node,
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
