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
    /// Choose exactly one option from a list.
    MultipleChoice,
    /// Choose an exact set of options from a list.
    MultipleResponse,
    /// Write Python that is executed and tested locally in the browser.
    PythonCode,
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
            Self::MultipleChoice => "multiple_choice",
            Self::MultipleResponse => "multiple_response",
            Self::PythonCode => "python_code",
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
            "multiple_choice" => Ok(Self::MultipleChoice),
            "multiple_response" => Ok(Self::MultipleResponse),
            "python_code" => Ok(Self::PythonCode),
            _ => Err(DomainError::invalid(
                "interaction_type",
                "unknown interaction type",
            )),
        }
    }
}

/// The instructional role an authored activity plays.
///
/// This is deliberately separate from [`AssessmentMode`]: an assessment mode
/// describes the *evidence* an attempt provides, while a pedagogy stage
/// describes *what the learner is being asked to do* in the activity. The
/// values are domain-neutral; track-specific structure belongs in authored
/// `family_id`/`transfer_group_id`/`challenge_group_id` strings, never here.
///
/// Phase 1 is descriptive only. The stage is stored and exposed to server-side
/// planning code, but does not yet change selection or mastery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PedagogyStage {
    /// Learner is introduced to or guided toward an idea.
    Discover,
    /// Learner identifies a concept, pattern, tool, category, or structure.
    Recognize,
    /// Learner distinguishes between plausible alternatives.
    Differentiate,
    /// Learner explains why something works, chooses state/strategy,
    /// identifies a bottleneck, or applies an invariant.
    Reason,
    /// Learner follows state or execution over time.
    Trace,
    /// Learner identifies a bug, fault, misconception, failure, or broken
    /// assumption.
    Diagnose,
    /// Learner creates, configures, reconstructs, writes, or implements
    /// something.
    Construct,
    /// Learner applies learned structure in a substantially different or
    /// less-scaffolded context.
    Transfer,
}

/// Number of authored pedagogy stages.
pub const PEDAGOGY_STAGE_COUNT: u8 = 8;

impl PedagogyStage {
    /// Canonical string authored in JSON and exposed to server-side planning.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Discover => "discover",
            Self::Recognize => "recognize",
            Self::Differentiate => "differentiate",
            Self::Reason => "reason",
            Self::Trace => "trace",
            Self::Diagnose => "diagnose",
            Self::Construct => "construct",
            Self::Transfer => "transfer",
        }
    }

    /// Position of the stage in the authored progression, `0..PEDAGOGY_STAGE_COUNT`.
    ///
    /// `discover` is the earliest, most supported role and `transfer` the latest,
    /// least supported one. This is a coarse authoring order, not a required
    /// prerequisite chain: selection uses it only as a soft ranking preference.
    pub const fn ordinal(self) -> u8 {
        match self {
            Self::Discover => 0,
            Self::Recognize => 1,
            Self::Differentiate => 2,
            Self::Reason => 3,
            Self::Trace => 4,
            Self::Diagnose => 5,
            Self::Construct => 6,
            Self::Transfer => 7,
        }
    }
}

impl std::fmt::Display for PedagogyStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TryFrom<&str> for PedagogyStage {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "discover" => Ok(Self::Discover),
            "recognize" => Ok(Self::Recognize),
            "differentiate" => Ok(Self::Differentiate),
            "reason" => Ok(Self::Reason),
            "trace" => Ok(Self::Trace),
            "diagnose" => Ok(Self::Diagnose),
            "construct" => Ok(Self::Construct),
            "transfer" => Ok(Self::Transfer),
            _ => Err(DomainError::invalid(
                "pedagogy_stage",
                "unknown pedagogy stage",
            )),
        }
    }
}

/// Inclusive lower bound for an authored `pedagogy.scaffold_level`.
pub const PEDAGOGY_MIN_SCAFFOLD_LEVEL: u8 = 0;
/// Inclusive upper bound for an authored `pedagogy.scaffold_level`.
///
/// `0` means no embedded help; `6` means strongly guided,
/// reconstruction-level support. Scaffolding is independent of
/// `difficulty_prior`.
pub const PEDAGOGY_MAX_SCAFFOLD_LEVEL: u8 = 6;

/// Optional, track-agnostic pedagogical metadata authored on a question.
///
/// Every field is optional, so existing content without `pedagogy` keeps
/// loading unchanged. The metadata is descriptive in Phase 1: it is stored in
/// canonical content and exposed to server-side planning, but it never changes
/// mastery, scoring, rewards, or selection ranking.
///
/// The `*_id` and `surface_context` values are opaque, author-defined strings.
/// Core code must never branch on their contents, and no global enum exists for
/// them, so any current or future track (DSA, Python, AWS, Terraform, security,
/// ML) can use the same contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PedagogyMetadata {
    /// Deeper reusable family/pattern/strategy/conceptual structure this
    /// activity belongs to, for example `dsa.sliding_window.variable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family_id: Option<String>,
    /// Instructional role of this particular activity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<PedagogyStage>,
    /// How much assistance is embedded in the activity, `0..=6`.
    ///
    /// This is not difficulty: an easy question may embed no help and a hard
    /// question may embed substantial help. It never modifies
    /// `difficulty_prior`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    // utoipa requires a literal here; keep it in sync with
    // `PEDAGOGY_MAX_SCAFFOLD_LEVEL`, which validation enforces.
    #[schema(maximum = 6)]
    pub scaffold_level: Option<u8>,
    /// Groups activities that exercise the same deep transferable structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transfer_group_id: Option<String>,
    /// Surface/domain/story context, for example `api_rate_limiting`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_context: Option<String>,
    /// Groups questions that may eventually form one multi-stage learning
    /// journey. Phase 1 stores the grouping only; it does not sequence it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub challenge_group_id: Option<String>,
}

/// Optional, track-agnostic remediation metadata authored on a structured
/// error code.
///
/// This describes the *teaching-policy* response to a recent structured error.
/// It is not mastery and it never permanently labels a learner: a structured
/// error is temporary, local evidence about how one attempt failed, and it only
/// influences selection while it is recent and not superseded by a recovery.
///
/// Every field is optional, so an existing `{"code", "description"}` error
/// definition keeps working unchanged. The `*_id` values are opaque authored
/// strings; core code never branches on their contents.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
pub struct ErrorRemediation {
    /// Concepts most directly implicated by the error.
    ///
    /// Lets a specific mistake target a narrower concept than the whole
    /// question. When present in a scored bundle these must be known concepts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub concept_ids: Vec<String>,
    /// A learning node that directly addresses the misconception.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    /// The kind of follow-up activity most useful for this error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_stage: Option<PedagogyStage>,
    /// A reusable family the remediation should stay within or redirect to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_family_id: Option<String>,
    /// Temporary lower bound on embedded support for immediate remediation.
    ///
    /// Cooperates with scaffold fading: it raises the preferred scaffold while
    /// the error signal is active and disappears once the learner recovers. It
    /// never permanently raises scaffold state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(maximum = 6)]
    pub min_scaffold_level: Option<u8>,
}

impl ErrorRemediation {
    /// Whether the object carries no actionable target at all.
    ///
    /// A present-but-empty remediation is rejected by content validation; this
    /// helper is the single definition of "empty" used by that check.
    pub fn is_empty(&self) -> bool {
        self.concept_ids.is_empty()
            && self.node_id.is_none()
            && self.preferred_stage.is_none()
            && self.preferred_family_id.is_none()
            && self.min_scaffold_level.is_none()
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
/// learner-facing modes are quick, domain, full practice, and the one-question
/// section quiz that concludes a learning module.
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
    /// One adaptive question that concludes a learning module (section).
    SectionQuiz,
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
            Self::SectionQuiz => "section_quiz",
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
            Self::SectionQuiz => 60,
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
            "section_quiz" => Ok(Self::SectionQuiz),
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
    /// Learning module (section) covered, when the mission is a section quiz.
    pub module_id: Option<String>,
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
