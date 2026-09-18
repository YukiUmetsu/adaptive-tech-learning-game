//! Versioned certification content: schema, validation, and canonical scoring.
//!
//! Content is authored as immutable JSON bundles. A bundle is validated before
//! it can be used, so invalid concept references, broken answers, duplicate
//! identifiers, and bad weights fail loudly instead of reaching learners.
//!
//! Canonical answers live only in the bundle. They are never sent with a
//! mission and are returned only after an answer has been scored.

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
    /// Interaction definition.
    pub interaction: Interaction,
    /// Canonical answer. Never sent before scoring.
    pub canonical_answer: CanonicalAnswer,
    /// Concept mappings with weights.
    pub concepts: Vec<QuestionConcept>,
    /// Short explanation shown after scoring.
    pub explanation: String,
    /// Optional hints.
    pub hints: Vec<String>,
    /// Structured error definitions the scorer may return.
    pub error_codes: Vec<ErrorCodeDef>,
    /// Official references.
    pub source_refs: Vec<SourceRef>,
}
