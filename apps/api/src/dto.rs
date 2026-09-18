//! Transport types for the Phase 1 learning API.
//!
//! Canonical answers never appear in mission payloads. They are returned only
//! in scoring feedback, after an answer has been evaluated.

use std::collections::BTreeMap;

use adaptive_learn_content::{CanonicalAnswer, Interaction, PlacementPoint};
use adaptive_learn_domain::{AssessmentMode, ConceptWeight, InteractionType, MissionStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Response for the certification catalog.
#[derive(Debug, Serialize, ToSchema)]
pub struct CatalogResponse {
    /// All known certifications.
    pub certifications: Vec<CertificationDto>,
}

/// A certification with its versioned blueprints.
#[derive(Debug, Serialize, ToSchema)]
pub struct CertificationDto {
    /// Certification identifier.
    pub id: String,
    /// Vendor.
    pub vendor: String,
    /// Full name.
    pub name: String,
    /// Official exam code.
    pub exam_code: String,
    /// Official blueprint source.
    pub official_source_url: String,
    /// Last blueprint review date.
    pub last_reviewed: String,
    /// Known exam versions.
    pub versions: Vec<CertificationVersionDto>,
}

/// A versioned exam blueprint.
#[derive(Debug, Serialize, ToSchema)]
pub struct CertificationVersionDto {
    /// Version identifier.
    pub id: String,
    /// Official exam code.
    pub exam_code: String,
    /// Blueprint effective date.
    pub effective_date: String,
    /// Immutable content version.
    pub content_version: String,
    /// Domains with authored tasks.
    pub domains: Vec<DomainDto>,
}

/// A content domain.
#[derive(Debug, Serialize, ToSchema)]
pub struct DomainDto {
    /// Domain identifier.
    pub id: String,
    /// Domain name.
    pub name: String,
    /// Share of scored content.
    pub weight: f64,
    /// Tasks with authored content.
    pub tasks: Vec<TaskDto>,
}

/// A task with a count of authored questions.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskDto {
    /// Task identifier.
    pub id: String,
    /// Task name.
    pub name: String,
    /// Number of authored questions available.
    pub question_count: usize,
}

/// Request to issue a mission for a task.
#[derive(Debug, Deserialize, ToSchema)]
pub struct IssueMissionRequest {
    /// Client device identifier.
    pub device_id: Uuid,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Task to study.
    pub task_id: String,
}

/// A server-issued mission with its questions.
#[derive(Debug, Serialize, ToSchema)]
pub struct MissionResponse {
    /// Mission identifier.
    pub id: Uuid,
    /// Device the mission belongs to.
    pub device_id: Uuid,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Immutable content version.
    pub content_version: String,
    /// Domain covered.
    pub domain_id: String,
    /// Task covered.
    pub task_id: String,
    /// Issue time.
    pub issued_at: DateTime<Utc>,
    /// Expiry time.
    pub expires_at: DateTime<Utc>,
    /// Questions in presentation order.
    pub questions: Vec<QuestionView>,
}

/// A question shown to the learner. Contains no answer key.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuestionView {
    /// Question identifier.
    pub id: String,
    /// Learner-facing prompt.
    pub prompt: String,
    /// Interaction family.
    pub interaction_type: InteractionType,
    /// Evidence mode.
    pub assessment_mode: AssessmentMode,
    /// Prior difficulty.
    pub difficulty_prior: f64,
    /// Concept mappings.
    pub concepts: Vec<ConceptWeight>,
    /// Optional hints.
    pub hints: Vec<String>,
    /// Interaction definition.
    pub interaction: Interaction,
}

/// Answer primitives for one attempt. Exactly one field is set.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AnswerPayload {
    /// Item id to category id placements for classification.
    pub placements: Option<BTreeMap<String, String>>,
    /// Item ids in submitted order for ordering.
    pub ordered_ids: Option<Vec<String>>,
    /// Directed `[from, to]` pairs for node connection.
    pub edges: Option<Vec<Vec<String>>>,
    /// Selected components and relationships for reconstruction.
    pub reconstruction: Option<ReconstructionAnswerPayload>,
    /// Selected evidence source ids for evidence selection.
    pub evidence_ids: Option<Vec<String>>,
    /// Selected faulty element ids for spot the fault.
    pub faulty_ids: Option<Vec<String>>,
    /// Slot id to option id values for fill slots.
    pub slot_values: Option<BTreeMap<String, String>>,
    /// Ordered choice ids for troubleshooting or a scenario chain.
    pub choice_path: Option<Vec<String>>,
    /// Slot id to piece id assignments for configuration builder.
    pub assignments: Option<BTreeMap<String, String>>,
    /// Item id to position for two-dimensional placement.
    pub positions: Option<BTreeMap<String, PlacementPoint>>,
    /// Slot id to token id values for command assembly.
    pub token_values: Option<BTreeMap<String, String>>,
}

/// Reconstruction answer primitives.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReconstructionAnswerPayload {
    /// Slot id to piece id placements.
    pub placements: BTreeMap<String, String>,
    /// Directed `[from, to]` relationships the learner drew.
    #[serde(default)]
    pub edges: Vec<Vec<String>>,
}

/// Request to score one attempt.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AnswerRequest {
    /// Client device identifier.
    pub device_id: Uuid,
    /// Stable event identifier for this attempt.
    pub event_id: Uuid,
    /// Question being answered.
    pub question_id: String,
    /// Content version the client believes it is answering.
    pub content_version: String,
    /// 1-based attempt number.
    pub attempt_number: i32,
    /// Hints used before submitting.
    pub hint_count: i32,
    /// Active response time in milliseconds.
    pub response_ms: i32,
    /// When the attempt occurred on the device.
    pub occurred_at: DateTime<Utc>,
    /// Answer primitives.
    pub answer: AnswerPayload,
}

/// Feedback for one scored attempt.
#[derive(Debug, Serialize, ToSchema)]
pub struct FeedbackResponse {
    /// Event identifier echoed back.
    pub event_id: Uuid,
    /// Question identifier.
    pub question_id: String,
    /// Whether the attempt was fully correct.
    pub correct: bool,
    /// Partial score in `[0, 1]`.
    pub score: f64,
    /// Structured error codes.
    pub error_codes: Vec<String>,
    /// Short explanation.
    pub explanation: String,
    /// Canonical answer, revealed after scoring.
    pub canonical_answer: CanonicalAnswer,
    /// Concept mappings with weights.
    pub concepts: Vec<ConceptWeight>,
}

/// Request to sync a batch of evaluated attempts.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncRequest {
    /// Client device identifier.
    pub device_id: Uuid,
    /// Attempts to reconcile.
    pub events: Vec<SyncEventRequest>,
}

/// One attempt in a sync batch.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncEventRequest {
    /// Stable event identifier.
    pub event_id: Uuid,
    /// Mission the attempt belongs to.
    pub mission_instance_id: Uuid,
    /// Question answered.
    pub question_id: String,
    /// Content version the answer was produced against.
    pub content_version: String,
    /// 1-based attempt number.
    pub attempt_number: i32,
    /// Hints used.
    pub hint_count: i32,
    /// Active response time in milliseconds.
    pub response_ms: i32,
    /// When the attempt occurred.
    pub occurred_at: DateTime<Utc>,
    /// Answer primitives.
    pub answer: AnswerPayload,
}

/// Result of a sync batch.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncResponse {
    /// Per-event results.
    pub results: Vec<SyncEventResult>,
}

/// Result for one synced event.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncEventResult {
    /// Event identifier.
    pub event_id: Uuid,
    /// Whether the event is now accepted server-side.
    pub accepted: bool,
    /// Error code when not accepted.
    pub error_code: Option<String>,
}

/// Request to complete a mission.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CompleteMissionRequest {
    /// Device that owns the mission.
    pub device_id: Uuid,
}

/// Completion result.
#[derive(Debug, Serialize, ToSchema)]
pub struct CompleteMissionResponse {
    /// Mission identifier.
    pub id: Uuid,
    /// New status.
    pub status: MissionStatus,
    /// Completion time.
    pub completed_at: Option<DateTime<Utc>>,
}
