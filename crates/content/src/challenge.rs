//! Authored multi-stage challenges.
//!
//! A challenge is a coherent **ordered sequence of existing activities** — quiz
//! questions and knowledge nodes — that share one authored identity. It is not a
//! new interaction type and it has no separate execution engine: the server
//! composes one ordinary mission from its stages, and the existing
//! mission/event/scoring/sync infrastructure runs it.
//!
//! The schema is deliberately track-agnostic. A stage references an existing
//! question or learning node by stable id; instructional role belongs in the
//! Phase 1 `pedagogy` metadata on the referenced activity, never in a
//! subject-specific stage type.

use serde::{Deserialize, Serialize};

use crate::validate::ContentError;

/// The only supported challenge schema version.
pub const CHALLENGE_SCHEMA_VERSION: &str = "challenge-v1";

/// A complete authored challenge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChallengeDefinition {
    /// Schema discriminator; must equal `challenge-v1`.
    pub schema_version: String,
    /// Stable challenge identifier, unique within a track version.
    pub id: String,
    /// Learner-facing title.
    pub title: String,
    /// Optional concise learner-facing scenario/brief shown above every stage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Certification identifier, for example `aws-soa-c03`.
    pub certification_id: String,
    /// Certification version identifier, for example `soa-c03`.
    pub certification_version: String,
    /// Optional owning domain. A challenge may span domains when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_id: Option<String>,
    /// Optional authored duration estimate, in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<u32>,
    /// Nodes that must be unlocked before the challenge is available.
    ///
    /// Optional; an empty list means always available. Reuses existing learning
    /// node ids rather than introducing a second prerequisite system.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prerequisite_node_ids: Vec<String>,
    /// Authored stages. At least two are required.
    pub stages: Vec<ChallengeStage>,
}

/// One authored stage of a challenge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChallengeStage {
    /// An existing quiz question.
    Question {
        /// Stable stage identifier, unique within the challenge.
        id: String,
        /// 1-based presentation order.
        order: u32,
        /// Referenced question id.
        question_id: String,
    },
    /// An existing knowledge node (learn/review).
    LearningNode {
        /// Stable stage identifier, unique within the challenge.
        id: String,
        /// 1-based presentation order.
        order: u32,
        /// Referenced knowledge node id.
        node_id: String,
    },
}

impl ChallengeStage {
    /// Stable stage identifier.
    pub fn id(&self) -> &str {
        match self {
            Self::Question { id, .. } | Self::LearningNode { id, .. } => id,
        }
    }

    /// 1-based presentation order.
    pub fn order(&self) -> u32 {
        match self {
            Self::Question { order, .. } | Self::LearningNode { order, .. } => *order,
        }
    }

    /// Referenced question id, when this is a question stage.
    pub fn question_id(&self) -> Option<&str> {
        match self {
            Self::Question { question_id, .. } => Some(question_id),
            Self::LearningNode { .. } => None,
        }
    }

    /// Referenced node id, when this is a learning-node stage.
    pub fn node_id(&self) -> Option<&str> {
        match self {
            Self::LearningNode { node_id, .. } => Some(node_id),
            Self::Question { .. } => None,
        }
    }
}

impl ChallengeDefinition {
    /// Stages in authored presentation order.
    ///
    /// Validation guarantees the orders are contiguous and unique, so sorting is
    /// deterministic even when the JSON array is not pre-sorted.
    pub fn ordered_stages(&self) -> Vec<&ChallengeStage> {
        let mut stages: Vec<&ChallengeStage> = self.stages.iter().collect();
        stages.sort_by_key(|stage| stage.order());
        stages
    }

    /// Referenced question ids in presentation order.
    pub fn ordered_question_ids(&self) -> Vec<String> {
        self.ordered_stages()
            .iter()
            .filter_map(|stage| stage.question_id().map(str::to_owned))
            .collect()
    }

    /// A rough duration estimate in minutes.
    ///
    /// Uses the authored estimate when present, otherwise derives a small
    /// deterministic estimate from the stage types (matching the session
    /// planner's per-activity conventions). This is for planning/presentation,
    /// not a timer.
    pub fn estimated_minutes(&self) -> u32 {
        if let Some(minutes) = self.estimated_minutes {
            return minutes;
        }
        self.stages
            .iter()
            .map(|stage| match stage {
                ChallengeStage::Question { .. } => 2,
                ChallengeStage::LearningNode { .. } => 4,
            })
            .sum()
    }
}

/// Validates one authored challenge, returning every problem found.
///
/// Structural, non-cross-source rules only: referenced questions and nodes are
/// cross-checked by `ContentRegistry` where bundle/learning context exists.
pub fn validate_challenge(challenge: &ChallengeDefinition) -> Result<(), Vec<ContentError>> {
    let mut errors = Vec::new();

    if challenge.schema_version != CHALLENGE_SCHEMA_VERSION {
        errors.push(ContentError::new(
            "challenge_schema_unsupported",
            format!(
                "challenge {} schema_version must be {}",
                challenge.id, CHALLENGE_SCHEMA_VERSION
            ),
        ));
    }

    for (field, value) in [
        ("id", &challenge.id),
        ("title", &challenge.title),
        ("certification_id", &challenge.certification_id),
        ("certification_version", &challenge.certification_version),
    ] {
        if value.trim().is_empty() {
            errors.push(ContentError::new(
                "challenge_field_missing",
                format!("challenge {field} must not be empty"),
            ));
        }
    }

    if challenge
        .description
        .as_deref()
        .is_some_and(|description| description.trim().is_empty())
    {
        errors.push(ContentError::new(
            "challenge_description_empty",
            format!(
                "challenge {} description must not be blank when present",
                challenge.id
            ),
        ));
    }

    if challenge
        .domain_id
        .as_deref()
        .is_some_and(|id| id.trim().is_empty())
    {
        errors.push(ContentError::new(
            "challenge_domain_empty",
            format!(
                "challenge {} domain_id must not be blank when present",
                challenge.id
            ),
        ));
    }

    if challenge.estimated_minutes == Some(0) {
        errors.push(ContentError::new(
            "challenge_estimated_minutes_invalid",
            format!(
                "challenge {} estimated_minutes must be greater than zero",
                challenge.id
            ),
        ));
    }

    let mut prerequisite_ids = std::collections::HashSet::new();
    for node_id in &challenge.prerequisite_node_ids {
        if node_id.trim().is_empty() {
            errors.push(ContentError::new(
                "challenge_prerequisite_empty",
                format!(
                    "challenge {} prerequisite_node_ids must not contain blank ids",
                    challenge.id
                ),
            ));
        }
        if !prerequisite_ids.insert(node_id.as_str()) {
            errors.push(ContentError::new(
                "challenge_prerequisite_duplicate",
                format!(
                    "challenge {} repeats prerequisite node {}",
                    challenge.id, node_id
                ),
            ));
        }
    }

    if challenge.stages.len() < 2 {
        errors.push(ContentError::new(
            "challenge_stages_too_few",
            format!(
                "challenge {} must declare at least two stages",
                challenge.id
            ),
        ));
    }

    let mut stage_ids = std::collections::HashSet::new();
    let mut orders = std::collections::HashSet::new();
    let mut referenced_activities = std::collections::HashSet::new();
    for stage in &challenge.stages {
        if stage.id().trim().is_empty() {
            errors.push(ContentError::new(
                "challenge_stage_id_missing",
                format!("challenge {} has a stage with an empty id", challenge.id),
            ));
        }
        if !stage_ids.insert(stage.id()) {
            errors.push(ContentError::new(
                "challenge_stage_id_duplicate",
                format!(
                    "challenge {} declares stage id {} twice",
                    challenge.id,
                    stage.id()
                ),
            ));
        }
        if !orders.insert(stage.order()) {
            errors.push(ContentError::new(
                "challenge_stage_order_duplicate",
                format!(
                    "challenge {} declares stage order {} twice",
                    challenge.id,
                    stage.order()
                ),
            ));
        }
        if stage.order() == 0 {
            errors.push(ContentError::new(
                "challenge_stage_order_invalid",
                format!(
                    "challenge {} stage {} order must be at least 1",
                    challenge.id,
                    stage.id()
                ),
            ));
        }

        let activity_id = stage
            .question_id()
            .or_else(|| stage.node_id())
            .unwrap_or("");
        if activity_id.trim().is_empty() {
            errors.push(ContentError::new(
                "challenge_stage_reference_missing",
                format!(
                    "challenge {} stage {} must reference a question or node",
                    challenge.id,
                    stage.id()
                ),
            ));
        } else if !referenced_activities.insert(activity_id) {
            errors.push(ContentError::new(
                "challenge_stage_duplicate_activity",
                format!(
                    "challenge {} references activity {} more than once",
                    challenge.id, activity_id
                ),
            ));
        }
    }

    // Contiguous `1..=N` order, matching the repository's practice-test and
    // Daily Mission ordering conventions.
    if !orders.is_empty() {
        let expected: std::collections::HashSet<u32> =
            (1..=challenge.stages.len() as u32).collect();
        if orders != expected {
            errors.push(ContentError::new(
                "challenge_stage_order_not_contiguous",
                format!(
                    "challenge {} stage order must be unique and contiguous 1..={}",
                    challenge.id,
                    challenge.stages.len()
                ),
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
