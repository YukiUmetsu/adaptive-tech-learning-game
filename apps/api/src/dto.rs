//! Transport types for the Phase 1 learning API.
//!
//! Canonical answers never appear in mission payloads. They are returned only
//! in scoring feedback, after an answer has been evaluated.

use std::collections::BTreeMap;

use adaptive_learn_content::{
    CanonicalAnswer, Interaction, LearningDesign, LearningDomainMeta, LearningModule,
    PlacementPoint, SourceRef,
};
use adaptive_learn_domain::{
    AssessmentMode, ConceptWeight, InteractionType, MissionStatus, QuizMode,
};
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
    /// Learner-facing knowledge concepts referenced by this version.
    ///
    /// Mission payloads carry only concept ids; the catalog supplies the names so
    /// summaries never have to render a raw identifier.
    pub concepts: Vec<ConceptDto>,
}

/// A learner-facing knowledge concept.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConceptDto {
    /// Stable concept identifier, for example `aws.cloudformation.changesets`.
    pub id: String,
    /// Short learner-facing name, for example `CloudFormation change sets`.
    pub name: String,
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
    /// Whether pre-quiz learning content exists for this domain.
    pub learning_available: bool,
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

/// Request to issue a mission for a quiz mode.
#[derive(Debug, Deserialize, ToSchema)]
pub struct IssueMissionRequest {
    /// Device/install context. Ownership always comes from the authenticated
    /// user; this value is never used as an authorization proof.
    pub device_id: Option<Uuid>,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Quiz mode deciding how the server selects questions.
    pub mode: QuizMode,
    /// Domain to scope a domain quiz to. Ignored for other modes.
    pub domain_id: Option<String>,
    /// Task to scope a task practice to. Required for `task_practice`.
    pub task_id: Option<String>,
    /// Anchor question for `recommended_practice`. The server validates it
    /// belongs to the certification version; it never trusts it as the whole
    /// practice set.
    pub question_id: Option<String>,
    /// Recommendation that produced this mission, when it was recommended.
    /// Context only, never an authorization key.
    pub recommendation_id: Option<Uuid>,
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
    /// Quiz mode.
    pub mode: QuizMode,
    /// Domain covered, for domain quizzes.
    pub domain_id: Option<String>,
    /// Task covered, for task practice.
    pub task_id: Option<String>,
    /// Issue time.
    pub issued_at: DateTime<Utc>,
    /// Expiry time.
    pub expires_at: DateTime<Utc>,
    /// Questions in presentation order.
    pub questions: Vec<QuestionView>,
}

/// A learner's settled Bits balance.
///
/// The wallet is owned by the authenticated user, so it is read from the token
/// rather than from a client-supplied identifier.
#[derive(Debug, Serialize, ToSchema)]
pub struct WalletResponse {
    /// Owning account.
    pub user_id: Uuid,
    /// Settled Bits balance.
    pub bits_balance: i64,
}

/// A question shown to the learner. Contains no answer key.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuestionView {
    /// Question identifier.
    pub id: String,
    /// Owning domain.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
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
    /// Slot id to raw typed text for typed fill-in-the-blank.
    pub typed_answers: Option<BTreeMap<String, String>>,
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
    /// Device/install context. Not an authorization proof.
    pub device_id: Option<Uuid>,
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
    /// Bits the learner is expected to earn when this attempt is settled.
    ///
    /// A preview only: the authoritative balance is settled during sync.
    pub bits_preview: i64,
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
    /// Device/install context. Ownership comes from the authenticated user.
    pub device_id: Option<Uuid>,
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
    /// Authoritative settled Bits balance after this batch.
    pub bits_balance: i64,
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
    /// Bits settled for this event (0 when rejected or already settled).
    pub bits_settled: i64,
}

/// Request to complete a mission.
///
/// The owner is taken from the verified token, so no identity is required here.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CompleteMissionRequest {
    /// Device/install context. Not an authorization proof.
    #[serde(default)]
    pub device_id: Option<Uuid>,
}

/// Safe application account data for the signed-in learner.
#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    /// Internal application user id. The stable ownership key.
    pub id: Uuid,
    /// Email known for the account, when the provider supplied one.
    pub email: Option<String>,
    /// Always `true`; the endpoint requires authentication.
    pub authenticated: bool,
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

/// Learner-facing learning content for one certification domain.
///
/// This is the discovery layer that sits before retrieval practice. Reveals are
/// present because progressive disclosure is the mechanic, not a secret. Quiz
/// canonical answers are never included.
#[derive(Debug, Serialize, ToSchema)]
pub struct LearningDomainResponse {
    /// Learning schema version.
    pub schema_version: String,
    /// Immutable learning content version.
    pub content_version: String,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Official exam guide revision.
    pub exam_guide_revision: Option<String>,
    /// Domain identity and weight.
    pub domain: LearningDomainMeta,
    /// Learner-facing vocabulary and unlock rules.
    pub learning_design: LearningDesign,
    /// Domain-level references.
    pub source_refs: Vec<SourceRef>,
    /// Modules with their knowledge nodes.
    pub modules: Vec<LearningModule>,
}

/// Best-effort next-action recommendation for a learning track.
///
/// Recommendations are optional and explainable. `recommendation` is `null` when
/// the track has nothing actionable yet, and the field is never required for the
/// dashboard to render.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecommendationResponse {
    /// Stable id for this recommendation, used by lifecycle telemetry. `null`
    /// only when no recommendation was produced.
    pub recommendation_id: Option<Uuid>,
    /// The chosen recommendation, or `null` when none is available.
    pub recommendation: Option<crate::planner::Recommendation>,
}

/// Request body for a recommendation.
///
/// Discovery progress is optional and best-effort: it lets the planner mirror
/// the Knowledge Map's exact unlock semantics. It is never learning evidence.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct RecommendationRequest {
    /// Raw Knowledge Map discovery progress for the track, if available.
    #[serde(default)]
    pub discovery: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// A recommendation lifecycle stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationEventKind {
    /// The client actually rendered the recommendation card.
    Shown,
    /// The learner clicked/accepted the recommendation.
    Clicked,
    /// Practice started (server-observed for missions, client-reported for the
    /// node path).
    Started,
    /// The learner opened the recommended Knowledge Node.
    NodeOpened,
    /// Practice from the recommendation was completed.
    Completed,
}

impl RecommendationEventKind {
    /// Canonical event string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::Clicked => "clicked",
            Self::Started => "started",
            Self::NodeOpened => "node_opened",
            Self::Completed => "completed",
        }
    }
}

/// One recommendation lifecycle event.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecommendationEventRequest {
    /// Lifecycle stage being reported.
    pub event: RecommendationEventKind,
    /// Planner action the recommendation had, when known.
    #[serde(default)]
    pub action: Option<crate::planner::PlannerAction>,
    /// Domain/topic, when known.
    #[serde(default)]
    pub domain_id: Option<String>,
    /// Knowledge node, when known.
    #[serde(default)]
    pub node_id: Option<String>,
    /// Question, when known.
    #[serde(default)]
    pub question_id: Option<String>,
}

/// Result of recording a lifecycle event.
///
/// `recorded` is `false` when the auxiliary write failed; the request still
/// succeeds because telemetry must never block learning.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecommendationEventResponse {
    /// Whether the event was persisted.
    pub recorded: bool,
}

/// Request body for an adaptive study session.
///
/// Session planning is optional; a failed request never blocks the dashboard.
#[derive(Debug, Deserialize, ToSchema)]
pub struct StudySessionRequest {
    /// Requested approximate session length in minutes. Clamped to a sane range.
    #[serde(default)]
    pub available_minutes: u32,
    /// How to balance learning and retrieval practice.
    #[serde(default)]
    pub preference: crate::planner::session::SessionPreference,
    /// Raw Knowledge Map discovery progress for the track, if available.
    #[serde(default)]
    pub discovery: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// A planned study session.
#[derive(Debug, Serialize, ToSchema)]
pub struct StudySessionResponse {
    /// Stable id for this session, used by auxiliary telemetry.
    pub session_id: Uuid,
    /// Learning track the session belongs to.
    pub track_id: String,
    /// Estimated total minutes.
    pub estimated_minutes: u32,
    /// Ordered activities. Empty when nothing is actionable; the client then
    /// builds a standard non-adaptive session.
    pub activities: Vec<crate::planner::session::SessionActivity>,
}
