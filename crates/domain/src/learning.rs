use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::DomainError;

/// How an attempt measures knowledge.
///
/// The first four are the base evidence modes from `docs/06-learning-engine.md`.
/// The remaining two are explicit Phase 1 subtypes used by tactile
/// interactions; they are still treated as evidence modes, not proven
/// independent latent abilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentMode {
    /// Recognizing a correct option.
    Recognition,
    /// Retrieving a fact unaided.
    Recall,
    /// Applying knowledge to a scenario.
    Application,
    /// Reconstructing a structure.
    StructuralReconstruction,
    /// Retrieving a relationship between components.
    RelationshipRecall,
    /// Recalling a procedure or ordered sequence.
    ProceduralRecall,
}

/// The tactile interaction family a question uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InteractionType {
    /// Place items into categories.
    Classification,
    /// Arrange items in a meaningful order.
    Ordering,
    /// Connect nodes with directed relationships.
    NodeConnection,
    /// Rebuild a structure from components and relationships.
    Reconstruction,
    /// Select the telemetry/log evidence needed to answer a question.
    EvidenceSelection,
    /// Identify the faulty element(s) in a broken configuration.
    SpotTheFault,
    /// Fill constrained blanks with values drawn from an option set.
    FillSlots,
    /// Work through a deterministic diagnosis/remediation decision tree.
    Troubleshooting,
    /// Work through a deterministic authored decision chain.
    ScenarioChoiceChain,
    /// Assemble a configuration from components into named slots.
    ConfigurationBuilder,
    /// Place items on a two-axis conceptual map.
    TwoDimensionalPlacement,
    /// Assemble an ordered command or configuration statement from tokens.
    CommandAssembly,
    /// Type the missing word, phrase, service, concept, or value into inline blanks.
    TypedFillBlank,
}

impl AssessmentMode {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Recognition => "recognition",
            Self::Recall => "recall",
            Self::Application => "application",
            Self::StructuralReconstruction => "structural_reconstruction",
            Self::RelationshipRecall => "relationship_recall",
            Self::ProceduralRecall => "procedural_recall",
        }
    }
}

impl TryFrom<&str> for AssessmentMode {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "recognition" => Ok(Self::Recognition),
            "recall" => Ok(Self::Recall),
            "application" => Ok(Self::Application),
            "structural_reconstruction" => Ok(Self::StructuralReconstruction),
            "relationship_recall" => Ok(Self::RelationshipRecall),
            "procedural_recall" => Ok(Self::ProceduralRecall),
            _ => Err(DomainError::invalid(
                "assessment_mode",
                "unknown assessment mode",
            )),
        }
    }
}

impl InteractionType {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Classification => "classification",
            Self::Ordering => "ordering",
            Self::NodeConnection => "node_connection",
            Self::Reconstruction => "reconstruction",
            Self::EvidenceSelection => "evidence_selection",
            Self::SpotTheFault => "spot_the_fault",
            Self::FillSlots => "fill_slots",
            Self::Troubleshooting => "troubleshooting",
            Self::ScenarioChoiceChain => "scenario_choice_chain",
            Self::ConfigurationBuilder => "configuration_builder",
            Self::TwoDimensionalPlacement => "two_dimensional_placement",
            Self::CommandAssembly => "command_assembly",
            Self::TypedFillBlank => "typed_fill_blank",
        }
    }
}

impl TryFrom<&str> for InteractionType {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "classification" => Ok(Self::Classification),
            "ordering" => Ok(Self::Ordering),
            "node_connection" => Ok(Self::NodeConnection),
            "reconstruction" => Ok(Self::Reconstruction),
            "evidence_selection" => Ok(Self::EvidenceSelection),
            "spot_the_fault" => Ok(Self::SpotTheFault),
            "fill_slots" => Ok(Self::FillSlots),
            "troubleshooting" => Ok(Self::Troubleshooting),
            "scenario_choice_chain" => Ok(Self::ScenarioChoiceChain),
            "configuration_builder" => Ok(Self::ConfigurationBuilder),
            "two_dimensional_placement" => Ok(Self::TwoDimensionalPlacement),
            "command_assembly" => Ok(Self::CommandAssembly),
            "typed_fill_blank" => Ok(Self::TypedFillBlank),
            _ => Err(DomainError::invalid(
                "interaction_type",
                "unknown interaction type",
            )),
        }
    }
}

/// A concept mapped to a question, with its share of the evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConceptWeight {
    /// Concept identifier, for example `aws.cloudwatch.alarm`.
    pub concept_id: String,
    /// Share of the question attributed to this concept, in `(0, 1]`.
    pub weight: f64,
}

/// Lifecycle of a server-issued mission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MissionStatus {
    /// Issued and still answerable.
    Issued,
    /// The learner finished the mission.
    Completed,
}

impl MissionStatus {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Issued => "issued",
            Self::Completed => "completed",
        }
    }
}

impl std::fmt::Display for MissionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TryFrom<&str> for MissionStatus {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "issued" => Ok(Self::Issued),
            "completed" => Ok(Self::Completed),
            _ => Err(DomainError::invalid(
                "mission_status",
                "must be issued or completed",
            )),
        }
    }
}

/// The quiz mode a mission was issued for.
///
/// `task_practice` is kept for the demo/task flow and internal debugging; the
/// three learner-facing modes are quick, domain, and full practice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum QuizMode {
    /// A short, cross-domain adaptive set.
    QuickAdaptive,
    /// A focused set drawn from one exam domain.
    DomainQuiz,
    /// A full-length, weighted certification challenge.
    FullPractice,
    /// A single task's questions (demo/internal).
    TaskPractice,
    /// A short set anchored on one recommended question.
    RecommendedPractice,
}

impl QuizMode {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::QuickAdaptive => "quick_adaptive",
            Self::DomainQuiz => "domain_quiz",
            Self::FullPractice => "full_practice",
            Self::TaskPractice => "task_practice",
            Self::RecommendedPractice => "recommended_practice",
        }
    }

    /// Whether the mode draws across the whole certification.
    pub const fn is_certification_wide(self) -> bool {
        matches!(self, Self::QuickAdaptive | Self::FullPractice)
    }

    /// Server-side mission lifetime in minutes.
    pub const fn ttl_minutes(self) -> i64 {
        match self {
            Self::QuickAdaptive => 60,
            Self::DomainQuiz => 120,
            Self::FullPractice => 180,
            Self::TaskPractice => 60,
            Self::RecommendedPractice => 60,
        }
    }
}

impl std::fmt::Display for QuizMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TryFrom<&str> for QuizMode {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "quick_adaptive" => Ok(Self::QuickAdaptive),
            "domain_quiz" => Ok(Self::DomainQuiz),
            "full_practice" => Ok(Self::FullPractice),
            "task_practice" => Ok(Self::TaskPractice),
            "recommended_practice" => Ok(Self::RecommendedPractice),
            _ => Err(DomainError::invalid("quiz_mode", "unknown quiz mode")),
        }
    }
}

/// A server-issued mission. The client never invents its identifiers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MissionInstance {
    /// Server-generated mission identifier.
    pub id: Uuid,
    /// Owning learner, or `None` for a public demo mission issued without an
    /// account. Ownership checks always use this field, never `device_id`.
    pub user_id: Option<Uuid>,
    /// Device the mission was issued from. Context only, not an owner.
    pub device_id: Uuid,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Immutable content version the mission was issued against.
    pub content_version: String,
    /// Quiz mode used to build the mission.
    pub mode: QuizMode,
    /// Recommendation that started this mission, when it was recommended.
    ///
    /// Context only: it is never an ownership or authorization key.
    pub recommendation_id: Option<Uuid>,
    /// Daily Mission this mission executes, when it belongs to one.
    pub daily_mission_id: Option<Uuid>,
    /// Zero-based Daily Mission item position this mission executes.
    pub daily_item_position: Option<i32>,
    /// Domain covered, when the mission is domain-scoped.
    pub domain_id: Option<String>,
    /// Task covered, when the mission is task-scoped.
    pub task_id: Option<String>,
    /// Questions selected for the mission, in presentation order. For
    /// mixed-domain modes this is the authoritative scope, not domain_id/task_id.
    pub question_ids: Vec<String>,
    /// Current status.
    pub status: MissionStatus,
    /// Issue time in UTC.
    pub issued_at: DateTime<Utc>,
    /// Expiry time in UTC.
    pub expires_at: DateTime<Utc>,
    /// Completion time, when finished.
    pub completed_at: Option<DateTime<Utc>>,
}

/// A normalized, server-evaluated learning event.
///
/// This is the append-oriented evidence record. It intentionally keeps partial
/// scores and structured error codes instead of collapsing to correct/incorrect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningEvent {
    /// Stable event identifier used for deduplication.
    pub event_id: Uuid,
    /// Owning learner, or `None` for an anonymous public demo attempt.
    pub user_id: Option<Uuid>,
    /// Device that produced the attempt. Context only, not an owner.
    pub device_id: Uuid,
    /// Mission the attempt belongs to.
    pub mission_instance_id: Uuid,
    /// Certification identifier.
    pub certification_id: String,
    /// Certification version identifier.
    pub certification_version: String,
    /// Domain identifier.
    pub domain_id: String,
    /// Task identifier.
    pub task_id: String,
    /// Question identifier.
    pub question_id: String,
    /// Content version the answer was scored against.
    pub content_version: String,
    /// Canonical question difficulty prior in `[0, 1]`, copied from server
    /// content. The client never supplies this; it is preserved with the
    /// evidence so selection and later models can use the difficulty the item
    /// actually had.
    pub difficulty_prior: f64,
    /// Concept mappings with weights.
    pub concepts: Vec<ConceptWeight>,
    /// Assessment/evidence mode.
    pub assessment_mode: AssessmentMode,
    /// Interaction family.
    pub interaction_type: InteractionType,
    /// Partial score in `[0, 1]`.
    pub score: f64,
    /// 1-based attempt number for the question within the mission.
    pub attempt_number: i32,
    /// Hints used before submitting.
    pub hint_count: i32,
    /// Active response time in milliseconds.
    pub response_ms: i32,
    /// Structured error codes from scoring.
    pub structured_error_codes: Vec<String>,
    /// Time the attempt occurred on the device.
    pub occurred_at: DateTime<Utc>,
}
