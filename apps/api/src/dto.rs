//! Transport types for the Phase 1 learning API.
//!
//! Canonical answers never appear in mission payloads. They are returned only
//! in scoring feedback, after an answer has been evaluated.

use std::collections::BTreeMap;

use adaptive_learn_content::{
    CanonicalAnswer, GlossaryTerm, Interaction, LearningDesign, LearningDomainMeta, LearningModule,
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
    /// Optional authored instruction shown with the prompt, for example
    /// `Choose TWO.`. Never reveals the answer.
    pub instruction: Option<String>,
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
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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
    /// Selected choice id for multiple choice.
    pub choice_id: Option<String>,
    /// Selected choice ids for multiple response.
    pub choice_ids: Option<Vec<String>>,
}

/// Reconstruction answer primitives.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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

/// One question in a read-only mission review.
///
/// Canonical answers are included because the mission is already completed;
/// review never creates evidence or changes scores.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewedQuestion {
    /// Question identifier.
    pub id: String,
    /// Owning domain.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
    /// Learner-facing prompt.
    pub prompt: String,
    /// Evidence mode.
    pub assessment_mode: AssessmentMode,
    /// Interaction definition, used to render labels in review.
    pub interaction: Interaction,
    /// Concept mappings.
    pub concepts: Vec<ConceptWeight>,
    /// Canonical answer, safe to show after completion.
    pub canonical_answer: CanonicalAnswer,
    /// Short explanation.
    pub explanation: String,
    /// Optional hints.
    pub hints: Vec<String>,
}

/// One accepted attempt in a read-only mission review.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewedAttempt {
    /// Question answered.
    pub question_id: String,
    /// Server-derived attempt number.
    pub attempt_number: i32,
    /// Accepted partial score in `[0, 1]`.
    pub score: f64,
    /// Whether the attempt cleared the success threshold.
    pub correct: bool,
    /// Hints used.
    pub hint_count: i32,
    /// When the attempt occurred.
    pub occurred_at: DateTime<Utc>,
}

/// Read-only review of a completed mission.
///
/// Lets a learner revisit the questions and answers of completed work without
/// redoing it. It is never learning evidence.
#[derive(Debug, Serialize, ToSchema)]
pub struct MissionReviewResponse {
    /// Mission identifier.
    pub mission_id: Uuid,
    /// Quiz mode the mission used.
    pub mode: QuizMode,
    /// Completion time, when completed.
    pub completed_at: Option<DateTime<Utc>>,
    /// Questions in presentation order, with canonical answers.
    pub questions: Vec<ReviewedQuestion>,
    /// Accepted attempts for this mission.
    pub attempts: Vec<ReviewedAttempt>,
}

/// Request to sync a batch of evaluated attempts.
///
/// The request may also carry optional auxiliary sections. They share one HTTP
/// request to reduce chatter, but their transactional semantics are isolated:
/// an auxiliary failure never rejects or rolls back accepted learning events.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncRequest {
    /// Device/install context. Ownership comes from the authenticated user.
    pub device_id: Option<Uuid>,
    /// Client IANA timezone. Captured once if absent so the account-wide study
    /// streak uses the learner's local day boundary, matching Daily Missions.
    #[serde(default)]
    pub timezone: Option<String>,
    /// Attempts to reconcile. Strict: authoritative events must be well-formed.
    #[serde(default)]
    pub events: Vec<SyncEventRequest>,
    /// Optional Knowledge Map discovery deltas. Never learning evidence.
    ///
    /// Deserialized leniently: a malformed entry is dropped rather than failing
    /// the whole request, so it can never block accepted learning events.
    #[serde(default, deserialize_with = "lenient_auxiliary_list")]
    pub discovery_updates: Vec<DiscoveryUpdateRequest>,
    /// Optional recommendation lifecycle telemetry. Never authoritative.
    ///
    /// Deserialized leniently for the same reason as `discovery_updates`.
    #[serde(default, deserialize_with = "lenient_auxiliary_list")]
    pub auxiliary_events: Vec<AuxiliaryEventRequest>,
}

/// Deserializes an optional auxiliary list, dropping malformed entries.
///
/// Auxiliary sections are isolated from the authoritative `events` section. A
/// malformed analytics entry must not turn the whole batch into a 400 and
/// discard accepted learning events, so invalid items are skipped. A non-array
/// value is treated as empty.
fn lenient_auxiliary_list<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    let serde_json::Value::Array(items) = value else {
        return Ok(Vec::new());
    };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect())
}

/// A monotonic Knowledge Map discovery delta for one track version.
///
/// Discovery is set-union based, so duplicates are harmless and an older device
/// can never remove a newer reveal.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DiscoveryUpdateRequest {
    /// Learning track version the discovery belongs to.
    pub track_version: String,
    /// Learning content version the reveals were recorded against.
    pub content_version: String,
    /// Raw per-domain discovery progress.
    #[serde(default)]
    pub domains: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// One auxiliary recommendation lifecycle event sent in a sync batch.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AuxiliaryEventRequest {
    /// Stable client-generated id, used to make retried telemetry idempotent.
    pub event_id: Uuid,
    /// Learning track identifier.
    pub track_id: String,
    /// Recommendation the event refers to.
    pub recommendation_id: Uuid,
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

/// Disposition of one optional sync section.
///
/// `accepted` is `false` when the auxiliary work failed; the request still
/// succeeds and the client only retains the failed section for retry.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncSectionResult {
    /// Whether the section was persisted.
    pub accepted: bool,
}

/// Result of a sync batch.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncResponse {
    /// Per-event results.
    pub results: Vec<SyncEventResult>,
    /// Authoritative settled Bits balance after this batch.
    pub bits_balance: i64,
    /// Disposition of the optional discovery section.
    pub discovery: SyncSectionResult,
    /// Disposition of the optional auxiliary telemetry section.
    pub auxiliary: SyncSectionResult,
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

/// Learner study settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UserSettingsDto {
    /// Whether the learner unlocks all study materials instead of the guided,
    /// in-order path. A preference only; it never affects scoring or evidence.
    pub unlock_all_materials: bool,
}

/// Request to update learner study settings.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSettingsRequest {
    /// Whether all study materials should be unlocked.
    pub unlock_all_materials: bool,
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
    /// Account-wide daily study streak.
    ///
    /// Bundled here so the Track Hub does not need a separate streak request.
    /// Best-effort: a streak query failure returns a neutral streak and never
    /// fails authentication.
    pub streak: StreakDto,
    /// Learner study settings.
    pub settings: UserSettingsDto,
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
    /// Clickable terms with short explanations, highlighted in learner text.
    pub glossary: Vec<GlossaryTerm>,
    /// Modules with their knowledge nodes.
    pub modules: Vec<LearningModule>,
}

/// Server-persisted Knowledge Map discovery progress for a learning track.
///
/// Discovery is raw and monotonic: node/module state is derived by the client
/// with the same rules as the Knowledge Map. It is never learning evidence.
#[derive(Debug, Serialize, ToSchema)]
pub struct DiscoveryResponse {
    /// Learning track version the progress belongs to.
    pub track_version: String,
    /// Raw per-domain discovery progress.
    pub domains: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// Discovery dimension of the Knowledge Signal.
///
/// Whether the learner explored the node's learning content. This is separate
/// from scored evidence and is never a mastery claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryState {
    /// No prompt revealed.
    Unexplored,
    /// Some prompts revealed, not yet complete.
    Explored,
    /// Every required prompt complete.
    Completed,
}

/// Knowledge Signal for one knowledge node.
#[derive(Debug, Serialize, ToSchema)]
pub struct NodeProgressDto {
    /// Knowledge node identifier.
    pub node_id: String,
    /// Whether the learner explored the node's content.
    pub discovery_state: DiscoveryState,
    /// Amount of scored evidence (coarse; never a percentage).
    pub evidence_level: crate::signals::EvidenceLevel,
    /// Freshness of that evidence (outer-ring treatment only).
    pub freshness_state: crate::signals::FreshnessState,
    /// Per-assessment-mode signals, present only for modes with evidence.
    pub mode_signals: Vec<crate::signals::ModeSignal>,
}

/// Knowledge Signal for one domain's nodes.
#[derive(Debug, Serialize, ToSchema)]
pub struct DomainProgressDto {
    /// Domain identifier.
    pub domain_id: String,
    /// Per-node signals.
    pub nodes: Vec<NodeProgressDto>,
}

/// Aggregate Knowledge Signal for one learning track.
///
/// One request returns every domain and node so the Track Hub never fetches
/// per-node state. Coarse semantic states only: no raw model probabilities,
/// percentages, or pass estimates.
#[derive(Debug, Serialize, ToSchema)]
pub struct TrackProgressResponse {
    /// Learning track identifier.
    pub track_id: String,
    /// Learning track version identifier.
    pub track_version: String,
    /// Immutable learning content version.
    pub content_version: String,
    /// Per-domain node signals.
    pub domains: Vec<DomainProgressDto>,
}

/// All learner-facing learning content for one learning track.
///
/// This is a read-only aggregate over authored content so the Track Hub can
/// render one track-wide Knowledge Map without a request per domain. It carries
/// no scored answers and no learner state.
#[derive(Debug, Serialize, ToSchema)]
pub struct TrackMapResponse {
    /// Learning track identifier.
    pub track_id: String,
    /// Learning track version identifier.
    pub track_version: String,
    /// Immutable learning content version.
    pub content_version: String,
    /// Learning domains with modules, nodes, and reveals.
    pub domains: Vec<LearningDomainResponse>,
}

/// Account-wide daily study streak.
///
/// Motivational only: it never feeds concept state, scoring, or rewards. It
/// spans every learning track.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StreakDto {
    /// Consecutive active days ending today or yesterday.
    pub current: u32,
    /// Longest consecutive run ever recorded.
    pub longest: u32,
    /// Whether today is already a qualified study day.
    pub active_today: bool,
    /// Most recent qualified local day, `YYYY-MM-DD`, when any.
    pub last_active_day: Option<String>,
}

impl From<adaptive_learn_domain::StreakSummary> for StreakDto {
    fn from(summary: adaptive_learn_domain::StreakSummary) -> Self {
        Self {
            current: summary.current,
            longest: summary.longest,
            active_today: summary.active_today,
            last_active_day: summary
                .last_active_day
                .map(|day| day.format("%Y-%m-%d").to_string()),
        }
    }
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
    /// Stable client-generated id for idempotent retries. Generated by the
    /// server when absent.
    #[serde(default)]
    pub event_id: Option<Uuid>,
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

/// How a Daily Mission was generated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DailyMissionPlanType {
    /// Generated from the learner's adaptive state.
    Adaptive,
    /// A non-adaptive fallback generated from authored track content.
    Standard,
}

impl DailyMissionPlanType {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Adaptive => "adaptive",
            Self::Standard => "standard",
        }
    }
}

/// Daily Mission lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DailyMissionStatus {
    /// Still has incomplete items.
    Active,
    /// Every item is complete.
    Completed,
}

impl DailyMissionStatus {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
        }
    }
}

/// One Daily Mission activity kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DailyMissionItemKind {
    /// Study a knowledge-map node.
    LearnNode,
    /// Revisit a node for a stale concept.
    ReviewNode,
    /// Answer a fixed, server-selected set of questions.
    Practice,
    /// Take a domain/topic review.
    DomainPractice,
}

impl DailyMissionItemKind {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LearnNode => "learn_node",
            Self::ReviewNode => "review_node",
            Self::Practice => "practice",
            Self::DomainPractice => "domain_practice",
        }
    }

    /// Parses a stored kind.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "learn_node" => Some(Self::LearnNode),
            "review_node" => Some(Self::ReviewNode),
            "practice" => Some(Self::Practice),
            "domain_practice" => Some(Self::DomainPractice),
            _ => None,
        }
    }
}

/// Completion status of one Daily Mission item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DailyMissionItemStatus {
    /// Not yet completed.
    Pending,
    /// Completed.
    Completed,
}

/// One item of the learner's Daily Mission.
#[derive(Debug, Serialize, ToSchema)]
pub struct DailyMissionItemDto {
    /// Zero-based position in the immutable plan.
    pub position: i32,
    /// Activity kind.
    pub kind: DailyMissionItemKind,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Learner-facing domain name.
    pub domain_name: String,
    /// Knowledge node, for node items.
    pub node_id: Option<String>,
    /// Learner-facing title.
    pub title: String,
    /// Estimated minutes.
    pub estimated_minutes: u32,
    /// Completion status.
    pub status: DailyMissionItemStatus,
    /// Number of server-selected questions, for practice items.
    pub question_count: usize,
    /// Completion time, when complete.
    pub completed_at: Option<DateTime<Utc>>,
}

/// The learner's immutable Daily Mission snapshot for the canonical day.
#[derive(Debug, Serialize, ToSchema)]
pub struct DailyMissionResponse {
    /// Mission identifier.
    pub id: Uuid,
    /// Learning track identifier.
    pub track_id: String,
    /// Learning track version identifier.
    pub track_version: String,
    /// Canonical UTC day key, `YYYY-MM-DD`.
    pub day_key: String,
    /// How the plan was generated.
    pub plan_type: DailyMissionPlanType,
    /// Lifecycle status.
    pub status: DailyMissionStatus,
    /// Bits bonus for completing the whole mission.
    pub reward_bits: i64,
    /// Whether the completion bonus has been settled.
    pub reward_granted: bool,
    /// Completed item count.
    pub completed_items: usize,
    /// Total item count.
    pub total_items: usize,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Completion time, when complete.
    pub completed_at: Option<DateTime<Utc>>,
    /// Immutable, ordered items.
    pub items: Vec<DailyMissionItemDto>,
}

/// Request for the learner's Daily Mission for today.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct DailyMissionRequest {
    /// Client IANA timezone. Stored as metadata; the day boundary is canonical UTC.
    #[serde(default)]
    pub timezone: Option<String>,
    /// Raw Knowledge Map discovery progress, if available.
    #[serde(default)]
    pub discovery: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// Request to complete a learning-node Daily Mission item.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct DailyItemCompleteRequest {
    /// Raw Knowledge Map discovery progress used to derive node completion.
    #[serde(default)]
    pub discovery: Vec<adaptive_learn_content::DomainDiscoveryInput>,
}

/// Result of completing one Daily Mission item.
#[derive(Debug, Serialize, ToSchema)]
pub struct DailyItemCompleteResponse {
    /// Whether the item is now complete.
    pub item_completed: bool,
    /// The updated Daily Mission.
    pub mission: DailyMissionResponse,
}

/// One calibration bucket in an internal evaluation summary.
#[derive(Debug, Serialize, ToSchema)]
pub struct CalibrationBucketDto {
    /// Bucket label, for example `0.6-0.8`.
    pub bucket: String,
    /// Number of samples in the bucket.
    pub count: usize,
    /// Mean predicted probability in the bucket.
    pub mean_prediction: f64,
    /// Mean observed score in the bucket.
    pub mean_observed: f64,
}

/// Metrics for one slice of the evaluation set.
#[derive(Debug, Serialize, ToSchema)]
pub struct EvaluationSliceDto {
    /// Slice dimension, for example `assessment_mode`.
    pub dimension: String,
    /// Slice key within the dimension, for example `recall`.
    pub key: String,
    /// Number of samples in the slice.
    pub samples: usize,
    /// Brier score for the slice.
    pub brier_score: Option<f64>,
    /// Log loss for the slice.
    pub log_loss: Option<f64>,
    /// Mean predicted probability for the slice.
    pub mean_prediction: Option<f64>,
    /// Mean observed score for the slice.
    pub mean_observed: Option<f64>,
}

/// Internal calibration summary for one model version.
///
/// Analytics only: no per-user data is exposed.
#[derive(Debug, Serialize, ToSchema)]
pub struct ModelEvaluationResponse {
    /// Model version evaluated, for example `heuristic-v1`.
    pub model_version: String,
    /// Number of resolved prediction/outcome pairs.
    pub samples: usize,
    /// Brier score over all samples.
    pub brier_score: Option<f64>,
    /// Log loss over all samples.
    pub log_loss: Option<f64>,
    /// Mean predicted probability.
    pub mean_prediction: Option<f64>,
    /// Mean observed score.
    pub mean_observed: Option<f64>,
    /// Calibration buckets.
    pub calibration: Vec<CalibrationBucketDto>,
    /// Metrics sliced by assessment mode, source, track, domain, difficulty,
    /// spacing, and delayed-retrieval flag.
    pub slices: Vec<EvaluationSliceDto>,
}

/// Summary of one available practice test (exam simulation).
///
/// Metadata only: it never contains questions or answers. The scored count is
/// an aggregate and does not reveal which items are unscored.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestSummaryDto {
    /// Stable practice-test identifier.
    pub id: String,
    /// Learner-facing title.
    pub title: String,
    /// Official exam code.
    pub exam_code: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Exam time limit in minutes.
    pub time_limit_minutes: i64,
    /// Total authored items.
    pub question_count: usize,
    /// Items that count toward the practice score.
    pub scored_question_count: usize,
    /// Response types present, for example `multiple_choice`.
    pub question_types: Vec<String>,
}

/// Practice tests available for one certification.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestListResponse {
    /// Available practice tests.
    pub practice_tests: Vec<PracticeTestSummaryDto>,
}

/// One learner-safe practice-test item, before submission.
///
/// No answer key, per-choice feedback, or scored flag is present.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestItemView {
    /// 1-based authored position.
    pub order: i64,
    /// The question to present, in authored order.
    pub question: QuestionView,
}

/// Learner-safe practice-test content served before submission.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestResponse {
    /// Stable practice-test identifier.
    pub id: String,
    /// Learner-facing title.
    pub title: String,
    /// Official exam code.
    pub exam_code: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Immutable content version.
    pub content_version: String,
    /// Exam time limit in minutes.
    pub time_limit_minutes: i64,
    /// Total authored items.
    pub question_count: usize,
    /// Items that count toward the practice score.
    pub scored_question_count: usize,
    /// Response types present.
    pub question_types: Vec<String>,
    /// Items in authored presentation order.
    pub items: Vec<PracticeTestItemView>,
}

/// The learner's answer to one practice-test item.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PracticeTestAnswerRequest {
    /// Question being answered.
    pub question_id: String,
    /// Answer primitives, keyed by the question's interaction type.
    pub answer: AnswerPayload,
}

/// One-shot submission of a practice-test attempt.
///
/// Answers are keyed by question id; unanswered items are simply omitted.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PracticeTestSubmissionRequest {
    /// Submitted answers, at most one per question.
    #[serde(default)]
    pub answers: Vec<PracticeTestAnswerRequest>,
}

/// Scored accuracy for one exam domain, over scored items only.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestDomainResult {
    /// Domain identifier.
    pub domain_id: String,
    /// Scored items answered correctly in this domain.
    pub correct: usize,
    /// Scored items in this domain.
    pub scored_count: usize,
}

/// One reviewed practice-test item, available only after submission.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestItemResult {
    /// 1-based authored position.
    pub order: i64,
    /// Question identifier.
    pub question_id: String,
    /// Owning domain.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
    /// Learner-facing prompt.
    pub prompt: String,
    /// Optional authored instruction.
    pub instruction: Option<String>,
    /// Interaction family.
    pub interaction_type: InteractionType,
    /// Evidence mode.
    pub assessment_mode: AssessmentMode,
    /// Interaction definition, used to render labels in review.
    pub interaction: Interaction,
    /// Canonical answer, safe to reveal after submission.
    pub canonical_answer: CanonicalAnswer,
    /// Short explanation.
    pub explanation: String,
    /// Per-choice feedback keyed by choice id, safe after submission.
    pub choice_feedback: BTreeMap<String, String>,
    /// Whether the item counts toward the practice score.
    pub is_scored: bool,
    /// Whether the learner submitted any answer.
    pub answered: bool,
    /// The learner's submitted answer, when any.
    pub submitted_answer: Option<AnswerPayload>,
    /// Whether the submission was fully correct; `None` when unanswered.
    pub correct: Option<bool>,
}

/// Full practice-test result and review, available only after submission.
#[derive(Debug, Serialize, ToSchema)]
pub struct PracticeTestResultResponse {
    /// Practice-test identifier.
    pub id: String,
    /// Learner-facing title.
    pub title: String,
    /// Official exam code.
    pub exam_code: String,
    /// Total authored items.
    pub total_questions: usize,
    /// Items that count toward the practice score.
    pub scored_question_count: usize,
    /// Scored items answered correctly.
    pub correct_count: usize,
    /// Raw accuracy across scored items, in `[0, 1]`.
    pub raw_accuracy: f64,
    /// Items with a submitted answer.
    pub answered_count: usize,
    /// Items without a submitted answer.
    pub unanswered_count: usize,
    /// Per-domain scored accuracy, derived from authored content.
    pub domain_breakdown: Vec<PracticeTestDomainResult>,
    /// Per-item review in authored order.
    pub questions: Vec<PracticeTestItemResult>,
    /// Explicit note that this raw score is not an AWS scaled score.
    pub score_note: String,
}
