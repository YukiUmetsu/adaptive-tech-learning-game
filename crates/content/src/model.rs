//! Versioned certification content: schema, validation, and canonical scoring.
//!
//! Content is authored as immutable JSON bundles. A bundle is validated before
//! it can be used, so invalid concept references, broken answers, duplicate
//! identifiers, and bad weights fail loudly instead of reaching learners.
//!
//! Canonical answers live only in the bundle. The transport layer decides
//! whether a given payload exposes them: ordinary study missions ship them for
//! local optimistic scoring, while practice tests and pre-submit content never
//! do. The server always re-scores raw answers authoritatively before recording
//! evidence.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A complete, versioned content bundle for one certification version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ContentBundle {
    /// Certification identity.
    pub certification: Certification,
    /// Versioned exam blueprint metadata.
    pub version: CertificationVersion,
    /// Concepts referenced by questions.
    pub concepts: Vec<Concept>,
    /// Authored questions.
    pub questions: Vec<Question>,
}

/// Certification identity, independent of exam revision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Certification {
    /// Stable certification identifier, for example `aws-soa-c03`.
    pub id: String,
    /// Certification vendor.
    pub vendor: String,
    /// Full certification name.
    pub name: String,
    /// Official exam code.
    pub exam_code: String,
    /// Official blueprint source.
    pub official_source_url: String,
    /// Date the blueprint was last reviewed, `YYYY-MM-DD`.
    pub last_reviewed: String,
}

/// A versioned exam blueprint. History is preserved by keeping old versions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CertificationVersion {
    /// Version identifier, for example `soa-c03`.
    pub id: String,
    /// Official exam code this version belongs to.
    pub exam_code: String,
    /// Blueprint effective date, `YYYY-MM-DD`.
    pub effective_date: String,
    /// Immutable content version shared by the questions.
    pub content_version: String,
    /// Domains in the blueprint.
    pub domains: Vec<Domain>,
}

/// An official content domain with its exam weight.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Domain {
    /// Domain identifier, for example `domain-1`.
    pub id: String,
    /// Official domain name.
    pub name: String,
    /// Share of scored content, in `(0, 1]`.
    pub weight: f64,
    /// Tasks authored for this domain. May be empty.
    pub tasks: Vec<Task>,
}

/// An official task statement under a domain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Task {
    /// Task identifier, for example `1.1`.
    pub id: String,
    /// Official task name.
    pub name: String,
    /// Questions authored for this task, in presentation order.
    pub question_ids: Vec<String>,
}

/// A knowledge component.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Concept {
    /// Stable concept identifier.
    pub id: String,
    /// Short display name.
    pub name: String,
    /// One-sentence description.
    pub description: String,
}

/// A concept mapped to a question with a share of the evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct QuestionConcept {
    /// Concept identifier; must exist in the bundle.
    pub concept_id: String,
    /// Share of the question attributed to this concept, in `(0, 1]`.
    pub weight: f64,
}

/// A selectable item or category.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Choice {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing label.
    pub label: String,
}

/// A node in a connection graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Node {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing label.
    pub label: String,
    /// Horizontal position in an abstract `0..=1` layout space.
    pub x: f64,
    /// Vertical position in an abstract `0..=1` layout space.
    pub y: f64,
}

/// A blank the learner must fill from a constrained option set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FillSlot {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing label for the blank, for example `Destination`.
    pub label: String,
}

/// A blank the learner fills by typing free text.
///
/// The slot's `id` is referenced as `{{id}}` inside a content template.
///
/// The optional presentation hints (`width_chars`, `multiline`, `rows`) only
/// shape the input; they never affect scoring or the accepted answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TypedBlankSlot {
    /// Stable identifier within the question, used as the `{{id}}` placeholder.
    pub id: String,
    /// Learner-facing label for the blank, for example `Policy result`.
    pub label: String,
    /// Optional hint text shown inside the empty input.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub placeholder: String,
    /// Optional initial/minimum visible width of the blank, in characters.
    ///
    /// When omitted the input keeps its historical auto-growing behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_chars: Option<u16>,
    /// Whether the blank should render as a multi-line answer box.
    #[serde(default)]
    pub multiline: bool,
    /// Optional number of visible rows for a multi-line blank. Only meaningful
    /// when `multiline` is true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u8>,
}

/// Accepted typed answers for one blank.
///
/// Matching is deterministic: the normalized typed answer must equal one of the
/// explicitly authored aliases. There is no semantic or fuzzy matching.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TypedBlankAnswer {
    /// Authored answers that are accepted for this blank.
    pub accepted_answers: Vec<String>,
}

/// Presentation context for a typed fill-in-the-blank interaction.
///
/// Presentation is explicit and tagged, so the renderer never has to guess
/// whether authored content is prose, source code, or a table. Blank positions
/// are always marked with `{{slot_id}}` inside a `template`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TypedFillContent {
    /// A sentence or short prose statement containing `{{slot_id}}` placeholders.
    Text {
        /// Template text containing `{{slot_id}}` placeholders.
        template: String,
    },
    /// A syntax-highlighted source-code sample containing `{{slot_id}}` placeholders.
    Code {
        /// Highlighting language, for example `python`.
        language: String,
        /// Code template containing `{{slot_id}}` placeholders. Newlines and
        /// indentation are significant.
        template: String,
    },
    /// A table whose cells may contain text or code templates.
    Table {
        /// Columns in presentation order.
        columns: Vec<TypedFillTableColumn>,
        /// Rows in presentation order.
        rows: Vec<TypedFillTableRow>,
    },
}

/// A column in a typed fill-in-the-blank table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TypedFillTableColumn {
    /// Stable identifier within the interaction.
    pub id: String,
    /// Learner-facing column heading.
    pub label: String,
}

/// A row in a typed fill-in-the-blank table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TypedFillTableRow {
    /// Stable identifier within the interaction.
    pub id: String,
    /// Column id to the cell presented in that column.
    pub cells: std::collections::BTreeMap<String, TypedFillTableCell>,
}

/// Presentation of one typed fill-in-the-blank table cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TypedFillTableCell {
    /// A text template containing `{{slot_id}}` placeholders.
    Text {
        /// Cell text containing `{{slot_id}}` placeholders.
        template: String,
    },
    /// A syntax-highlighted code template containing `{{slot_id}}` placeholders.
    Code {
        /// Highlighting language, for example `python`.
        language: String,
        /// Code template containing `{{slot_id}}` placeholders.
        template: String,
    },
}

/// The operational stage a branching-scenario decision belongs to.
///
/// The stage is used only to attach a structured error code to a poor decision;
/// it is not a measure of overall mastery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioStage {
    /// Gather evidence or identify the cause.
    Diagnosis,
    /// Choose the next operational action.
    Action,
    /// Apply a fix.
    Remediation,
    /// Confirm recovery.
    Verification,
}

/// One authored decision point in a branching scenario.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ScenarioStep {
    /// Stable identifier within the scenario.
    pub id: String,
    /// Learner-facing situation or question.
    pub prompt: String,
    /// What kind of decision this step represents.
    pub stage: ScenarioStage,
    /// Choices available at this step.
    pub choices: Vec<Choice>,
    /// Choice id to next step id. A choice with no entry ends the scenario.
    pub next_step_by_choice: std::collections::BTreeMap<String, String>,
}

/// A named role the learner assigns a component to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConfigSlot {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing label for the role, for example `IPv4 default route target`.
    pub label: String,
}

/// One axis of a two-dimensional conceptual map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlacementAxis {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing axis name.
    pub label: String,
    /// Label for the low end of the axis.
    pub low_label: String,
    /// Label for the high end of the axis.
    pub high_label: String,
}

/// A tolerant canonical region on a two-dimensional map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlacementRegion {
    /// Inclusive `[min, max]` horizontal range in `0..=1`.
    pub x: Vec<f64>,
    /// Inclusive `[min, max]` vertical range in `0..=1`.
    pub y: Vec<f64>,
}

/// A point submitted for a two-dimensional placement.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlacementPoint {
    /// Horizontal position in `0..=1`.
    pub x: f64,
    /// Vertical position in `0..=1`.
    pub y: f64,
}

/// How a reconstruction scaffold represents structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReconstructionLayout {
    /// Ordered slots; the slot order itself encodes the relationships.
    Linear,
    /// Positioned slots; explicit edges may be required for topology.
    Graph,
}

/// Where a provided node sits relative to a reconstruction's slots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FixedNodePosition {
    /// Before the first slot.
    Start,
    /// After the last slot.
    End,
}

/// A node that is already provided as part of the scaffold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FixedNode {
    /// Stable identifier within the question.
    pub id: String,
    /// Learner-facing label.
    pub label: String,
    /// Where the node is shown relative to the slots in `linear` layouts.
    pub position: FixedNodePosition,
    /// Authored horizontal position for `graph` layouts, in `0..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// Authored vertical position for `graph` layouts, in `0..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
}

/// A structural position the learner fills with a piece.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ReconstructionSlot {
    /// Stable identifier within the question.
    pub id: String,
    /// Authored horizontal position for `graph` layouts, in `0..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// Authored vertical position for `graph` layouts, in `0..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
}

/// Interaction definition shown to the learner. Contains no answer key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Interaction {
    /// Place items into categories.
    Classification {
        /// Items to place.
        items: Vec<Choice>,
        /// Destination categories.
        categories: Vec<Choice>,
    },
    /// Arrange items into a meaningful order.
    Ordering {
        /// Items to order.
        items: Vec<Choice>,
    },
    /// Connect nodes with directed relationships.
    NodeConnection {
        /// Nodes available to connect.
        nodes: Vec<Node>,
    },
    /// Rebuild a structure by placing pieces into a scaffold's slots.
    Reconstruction {
        /// How the scaffold represents structure.
        layout: ReconstructionLayout,
        /// Nodes already provided as context. Not part of the answer.
        fixed_nodes: Vec<FixedNode>,
        /// Candidate pieces, including plausible distractors.
        pieces: Vec<Choice>,
        /// Structural positions the learner fills.
        slots: Vec<ReconstructionSlot>,
    },
    /// Select the evidence sources relevant to a question.
    EvidenceSelection {
        /// Candidate telemetry, log, or evidence sources.
        evidence: Vec<Choice>,
    },
    /// Identify the faulty element(s) in an authored configuration.
    SpotTheFault {
        /// Structured elements (components, rules, rows) the learner inspects.
        elements: Vec<Choice>,
    },
    /// Fill blanks with values drawn from a constrained option set.
    FillSlots {
        /// Blanks to fill, in presentation order.
        slots: Vec<FillSlot>,
        /// Values the learner may use. May contain distractors.
        options: Vec<Choice>,
    },
    /// Follow a deterministic diagnosis/remediation decision tree.
    Troubleshooting {
        /// Step the scenario starts at.
        start_step_id: String,
        /// Authored decision steps.
        steps: Vec<ScenarioStep>,
    },
    /// Follow a deterministic authored decision chain.
    ScenarioChoiceChain {
        /// Step the scenario starts at.
        start_step_id: String,
        /// Authored decision steps.
        steps: Vec<ScenarioStep>,
    },
    /// Assemble a configuration by assigning components to named roles.
    ConfigurationBuilder {
        /// Named roles that each expect one component.
        slots: Vec<ConfigSlot>,
        /// Components the learner may assign. May contain distractors.
        pieces: Vec<Choice>,
    },
    /// Place items on a two-axis conceptual map.
    TwoDimensionalPlacement {
        /// Horizontal axis definition.
        x_axis: PlacementAxis,
        /// Vertical axis definition.
        y_axis: PlacementAxis,
        /// Items the learner positions.
        items: Vec<Choice>,
    },
    /// Assemble an ordered statement from a token pool.
    CommandAssembly {
        /// Ordered parts of the statement.
        slots: Vec<FillSlot>,
        /// Tokens the learner may use. May contain distractors.
        tokens: Vec<Choice>,
    },
    /// Fill inline blanks inside a sentence by typing the missing text.
    TypedFillBlank {
        /// Presentation context (prose, code, or table).
        content: TypedFillContent,
        /// Blanks referenced anywhere in the content, in declaration order.
        slots: Vec<TypedBlankSlot>,
    },
    /// Choose exactly one option.
    MultipleChoice {
        /// Selectable options, including distractors.
        choices: Vec<Choice>,
    },
    /// Choose an exact set of options.
    MultipleResponse {
        /// Selectable options, including distractors.
        choices: Vec<Choice>,
        /// Number of options the learner must select.
        required_selections: usize,
    },
}

/// The canonical answer for a question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CanonicalAnswer {
    /// Correct item-to-category placements.
    Classification {
        /// Item id to category id.
        placements: std::collections::BTreeMap<String, String>,
    },
    /// Correct order of item ids.
    Ordering {
        /// Item ids in canonical order.
        ordered_ids: Vec<String>,
    },
    /// Correct directed relationships.
    NodeConnection {
        /// Directed `[from, to]` pairs.
        edges: Vec<Vec<String>>,
    },
    /// Correct piece placed in each slot.
    Reconstruction {
        /// Slot id to piece id.
        placements: std::collections::BTreeMap<String, String>,
        /// Optional directed `[from, to]` piece-id pairs for `graph` layouts.
        #[serde(default)]
        edges: Vec<Vec<String>>,
    },
    /// Evidence source ids that are relevant to the question.
    EvidenceSelection {
        /// Relevant evidence ids. Every other candidate is a false positive.
        relevant_ids: Vec<String>,
    },
    /// Element ids that are faulty.
    SpotTheFault {
        /// Faulty element ids.
        faulty_ids: Vec<String>,
    },
    /// Correct value id for each slot id.
    FillSlots {
        /// Slot id to option id.
        values: std::collections::BTreeMap<String, String>,
    },
    /// Correct decisions for a diagnosis/remediation scenario.
    Troubleshooting {
        /// Step id to the choice ids that are correct at that step.
        correct_choice_ids: std::collections::BTreeMap<String, Vec<String>>,
        /// The intended ordered choice ids from the start step.
        expected_path: Vec<String>,
    },
    /// Correct decisions for an authored decision chain.
    ScenarioChoiceChain {
        /// Step id to the choice ids that are correct at that step.
        correct_choice_ids: std::collections::BTreeMap<String, Vec<String>>,
        /// The intended ordered choice ids from the start step.
        expected_path: Vec<String>,
    },
    /// Correct component assignment for each role.
    ConfigurationBuilder {
        /// Slot id to piece id.
        assignments: std::collections::BTreeMap<String, String>,
    },
    /// Correct tolerant region for each placed item.
    TwoDimensionalPlacement {
        /// Item id to its canonical region.
        regions: std::collections::BTreeMap<String, PlacementRegion>,
    },
    /// Correct token for each ordered slot.
    CommandAssembly {
        /// Slot id to token id.
        values: std::collections::BTreeMap<String, String>,
    },
    /// Accepted typed answers for each inline blank.
    TypedFillBlank {
        /// Slot id to the authored accepted answers.
        answers: std::collections::BTreeMap<String, TypedBlankAnswer>,
    },
    /// The single correct choice id.
    MultipleChoice {
        /// Correct choice id.
        choice_id: String,
    },
    /// The exact set of correct choice ids.
    MultipleResponse {
        /// Correct choice ids; order is not significant.
        choice_ids: Vec<String>,
    },
}

/// A structured error the scorer may emit for a question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ErrorCodeDef {
    /// Stable code, for example `classification_misplaced`.
    pub code: String,
    /// Learner-safe description.
    pub description: String,
}

/// A reference to the official source of a content unit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SourceRef {
    /// Display title.
    pub title: String,
    /// URL.
    pub url: String,
}

/// An authored question with its canonical answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Question {
    /// Stable question identifier.
    pub id: String,
    /// Content version this question belongs to.
    pub content_version: String,
    /// Certification version this question belongs to.
    pub certification_version: String,
    /// Owning domain.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
    /// Evidence mode.
    pub assessment_mode: adaptive_learn_domain::AssessmentMode,
    /// Interaction family.
    pub interaction_type: adaptive_learn_domain::InteractionType,
    /// Prior difficulty in `[0, 1]`.
    pub difficulty_prior: f64,
    /// Learner-facing prompt.
    pub prompt: String,
    /// Optional authored instruction shown with the prompt, for example
    /// `Choose TWO.`. Learner-safe: it never reveals the answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Interaction definition.
    pub interaction: Interaction,
    /// Canonical answer. Never sent before scoring.
    pub canonical_answer: CanonicalAnswer,
    /// Concept mappings with weights.
    ///
    /// Normal adaptive quiz questions must map at least one concept. Practice
    /// tests may omit mappings, in which case the question carries no mastery
    /// signal.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub concepts: Vec<QuestionConcept>,
    /// Short explanation shown after scoring.
    pub explanation: String,
    /// Per-choice feedback keyed by choice id.
    ///
    /// Post-answer information: it must never be sent to a learner before the
    /// exercise is submitted/scored.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub choice_feedback: std::collections::BTreeMap<String, String>,
    /// Official exam-objective/skill ids this question maps to.
    ///
    /// Blueprint references, never concept-mastery ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blueprint_skill_ids: Vec<String>,
    /// Authored difficulty label, for example `medium`.
    ///
    /// Display/authoring metadata; [`Question::difficulty_prior`] stays the
    /// numeric machine-readable value the learning model uses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty_label: Option<String>,
    /// Optional hints.
    pub hints: Vec<String>,
    /// Structured error definitions the scorer may return.
    pub error_codes: Vec<ErrorCodeDef>,
    /// Official references.
    pub source_refs: Vec<SourceRef>,
}
