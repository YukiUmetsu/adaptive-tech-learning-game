//! Pre-quiz learning curriculum: knowledge maps that teach concepts before
//! retrieval practice.
//!
//! Learning content is deliberately a **different first-class content type**
//! from quiz [`crate::model::ContentBundle`]. Learning reveals information
//! progressively and drives a discovery map; it never produces scored learning
//! events. Keeping the schemas separate means the quiz loader cannot be
//! accidentally fed a knowledge map, and vice versa.
//!
//! The JSON under `content/**/learning/` is the curriculum; this module only
//! validates and transports it.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::model::SourceRef;
use crate::validate::ContentError;

/// One versioned learning domain: a set of modules containing knowledge nodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningDomain {
    /// Learning schema version, for example `1.0.0`.
    pub schema_version: String,
    /// Immutable learning content version.
    pub content_version: String,
    /// Certification identifier, for example `aws-soa-c03`.
    pub certification_id: String,
    /// Certification version identifier, for example `soa-c03`.
    pub certification_version: String,
    /// Official exam guide revision this content was authored against.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exam_guide_revision: Option<String>,
    /// Domain identity and exam weight.
    pub domain: LearningDomainMeta,
    /// Learner-facing vocabulary and rules for this map.
    pub learning_design: LearningDesign,
    /// Domain-level official references.
    pub source_refs: Vec<SourceRef>,
    /// Authored coverage metadata, used to validate the curriculum shape.
    pub coverage: LearningCoverage,
    /// Authoring notes. Not learner-facing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authoring_notes: Option<String>,
    /// Modules in presentation order.
    pub modules: Vec<LearningModule>,
}

/// Domain identity within a certification blueprint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningDomainMeta {
    /// Domain identifier, for example `domain-1`.
    pub id: String,
    /// Official domain name.
    pub name: String,
    /// Share of scored content, in `(0, 1]`.
    pub weight: f64,
}

/// The vocabulary and rules shown to learners on the map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningDesign {
    /// Label for discovery progress, for example `Discovery Progress`.
    pub progress_label: String,
    /// Explanation of the unlock rule.
    pub unlock_rule: String,
    /// Reminder that discovery is not mastery.
    pub mastery_note: String,
}

/// Authored counts used to validate the curriculum at load time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningCoverage {
    /// Exam task ids covered by the domain's modules.
    pub task_ids: Vec<String>,
    /// Exam skill ids covered by the domain's modules.
    pub skill_ids: Vec<String>,
    /// Number of modules.
    pub module_count: usize,
    /// Number of knowledge nodes across all modules.
    pub knowledge_node_count: usize,
    /// Number of prompts across all knowledge nodes.
    pub prompt_count: usize,
}

/// A group of knowledge nodes unlocked along one path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LearningModule {
    /// Stable module identifier.
    pub id: String,
    /// Learner-facing module title.
    pub title: String,
    /// Presentation order within the domain.
    pub order: i64,
    /// Exam task ids this module teaches.
    #[serde(default)]
    pub task_ids: Vec<String>,
    /// Exam skill ids this module teaches.
    #[serde(default)]
    pub skill_ids: Vec<String>,
    /// Modules that must be completed before this one becomes available.
    #[serde(default)]
    pub prerequisite_module_ids: Vec<String>,
    /// Knowledge nodes in presentation order.
    pub nodes: Vec<KnowledgeNode>,
}

/// One knowledge card on the map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeNode {
    /// Stable node identifier.
    pub id: String,
    /// Learner-facing node title.
    pub title: String,
    /// Certification concepts this node teaches. The bridge to quiz evidence.
    pub concept_ids: Vec<String>,
    /// Nodes that must be unlocked before this node becomes ready.
    #[serde(default)]
    pub prerequisite_node_ids: Vec<String>,
    /// Authored position on the map in `0..=1` space.
    pub map_position: MapPosition,
    /// Progressive reveal prompts. All required prompts unlock the node.
    pub prompts: Vec<KnowledgePrompt>,
    /// Official references for this node.
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
}

/// Normalized position on the knowledge map.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MapPosition {
    /// Horizontal position in `0..=1`.
    pub x: f64,
    /// Vertical position in `0..=1`.
    pub y: f64,
}

/// One progressive-reveal prompt on a knowledge card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgePrompt {
    /// Stable prompt identifier within the node.
    pub id: String,
    /// Prompt kind, which selects the shared icon and styling vocabulary.
    pub kind: PromptKind,
    /// Learner-facing label, authored by the curriculum.
    pub label: String,
    /// Blank text shown before the reveal.
    pub placeholder: String,
    /// Whether revealing this prompt counts toward unlocking the node.
    #[serde(default = "default_true")]
    pub required: bool,
    /// The information revealed when the learner taps the blank.
    pub reveal: LearningReveal,
}

/// The shared prompt vocabulary. Icons are selected by the UI from this kind,
/// so content can change labels without the renderer special-casing nodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PromptKind {
    /// What is it?
    What,
    /// When is it used?
    When,
    /// What does it connect to?
    ConnectsTo,
    /// What is it not?
    NotThis,
    /// How the exam phrases it.
    ExamClue,
    /// A compact mental model.
    MentalModel,
    /// The action to take.
    Action,
    /// What to look for.
    LookFor,
}

impl PromptKind {
    /// Canonical string stored in JSON and used for CSS class names.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::What => "what",
            Self::When => "when",
            Self::ConnectsTo => "connects_to",
            Self::NotThis => "not_this",
            Self::ExamClue => "exam_clue",
            Self::MentalModel => "mental_model",
            Self::Action => "action",
            Self::LookFor => "look_for",
        }
    }
}

/// How a revealed prompt renders. Deliberately not a plain string: the
/// curriculum distinguishes prose, sequences, comparisons, and keyword clues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LearningReveal {
    /// A short prose reveal.
    Text {
        /// Revealed text. Keep it to one or two sentences.
        text: String,
    },
    /// An ordered sequence, rendered top-to-bottom with arrows.
    Sequence {
        /// Ordered items.
        items: Vec<String>,
    },
    /// A compact set of bullets.
    Bullets {
        /// Bullet items.
        items: Vec<String>,
    },
    /// Keyword clues, rendered as compact chips.
    Keywords {
        /// Clue items.
        items: Vec<String>,
    },
    /// A side-by-side or stacked comparison.
    Comparison {
        /// Comparison columns.
        columns: Vec<RevealColumn>,
    },
}

/// One titled column of a comparison reveal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RevealColumn {
    /// Column heading.
    pub title: String,
    /// Column items.
    pub items: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl LearningDomain {
    /// Every knowledge node in the domain, in module/node order.
    pub fn nodes(&self) -> impl Iterator<Item = &KnowledgeNode> {
        self.modules.iter().flat_map(|module| module.nodes.iter())
    }

    /// Finds a node by id anywhere in the domain.
    pub fn node(&self, node_id: &str) -> Option<&KnowledgeNode> {
        self.nodes().find(|node| node.id == node_id)
    }

    /// Finds a module by id.
    pub fn module(&self, module_id: &str) -> Option<&LearningModule> {
        self.modules.iter().find(|module| module.id == module_id)
    }

    /// The prompts that must be revealed to unlock a node.
    pub fn required_prompts(node: &KnowledgeNode) -> impl Iterator<Item = &KnowledgePrompt> {
        node.prompts.iter().filter(|prompt| prompt.required)
    }
}

/// Validates one learning domain, returning every problem found.
///
/// Validation is strict on purpose: a malformed knowledge map should fail the
/// build or the test suite, never reach a learner.
pub fn validate_learning_domain(domain: &LearningDomain) -> Result<(), Vec<ContentError>> {
    let mut errors = Vec::new();

    if domain.schema_version.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_schema_version_missing",
            "learning schema_version must not be empty",
        ));
    }
    if domain.content_version.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_content_version_missing",
            "learning content_version must not be empty",
        ));
    }
    if domain.certification_id.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_certification_id_missing",
            "learning certification_id must not be empty",
        ));
    }
    if domain.certification_version.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_certification_version_missing",
            "learning certification_version must not be empty",
        ));
    }
    if domain.domain.id.trim().is_empty() || domain.domain.name.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_domain_field_missing",
            "learning domain id and name must not be empty",
        ));
    }
    if !(domain.domain.weight > 0.0 && domain.domain.weight <= 1.0) {
        errors.push(ContentError::new(
            "learning_domain_weight_invalid",
            format!(
                "learning domain {} weight must be within (0, 1]",
                domain.domain.id
            ),
        ));
    }
    if domain.learning_design.progress_label.trim().is_empty()
        || domain.learning_design.unlock_rule.trim().is_empty()
        || domain.learning_design.mastery_note.trim().is_empty()
    {
        errors.push(ContentError::new(
            "learning_design_field_missing",
            "learning_design fields must not be empty",
        ));
    }
    if domain.source_refs.is_empty() {
        errors.push(ContentError::new(
            "learning_source_refs_missing",
            "learning domain must reference at least one source",
        ));
    }
    validate_source_refs(&domain.source_refs, &mut errors);

    if domain.modules.is_empty() {
        errors.push(ContentError::new(
            "learning_modules_missing",
            "learning domain must define at least one module",
        ));
        return errors_or_ok(errors);
    }

    validate_modules(domain, &mut errors);
    validate_coverage(domain, &mut errors);

    errors_or_ok(errors)
}

fn validate_modules(domain: &LearningDomain, errors: &mut Vec<ContentError>) {
    let module_ids: HashSet<&str> = domain
        .modules
        .iter()
        .map(|module| module.id.as_str())
        .collect();
    let mut seen_modules = HashSet::new();
    let mut seen_orders = HashSet::new();

    // Node ids must be globally unique so progress and prerequisites are
    // unambiguous.
    let mut node_ids: HashSet<&str> = HashSet::new();
    for module in &domain.modules {
        for node in &module.nodes {
            if !node_ids.insert(node.id.as_str()) {
                errors.push(ContentError::new(
                    "learning_duplicate_node_id",
                    format!("duplicate knowledge node id {}", node.id),
                ));
            }
        }
    }

    for module in &domain.modules {
        if module.id.trim().is_empty() || module.title.trim().is_empty() {
            errors.push(ContentError::new(
                "learning_module_field_missing",
                "module id and title must not be empty",
            ));
        }
        if !seen_modules.insert(module.id.as_str()) {
            errors.push(ContentError::new(
                "learning_duplicate_module_id",
                format!("duplicate learning module id {}", module.id),
            ));
        }
        if module.order <= 0 {
            errors.push(ContentError::new(
                "learning_module_order_invalid",
                format!("module {} order must be positive", module.id),
            ));
        } else if !seen_orders.insert(module.order) {
            errors.push(ContentError::new(
                "learning_duplicate_module_order",
                format!("duplicate learning module order {}", module.order),
            ));
        }
        if module.nodes.is_empty() {
            errors.push(ContentError::new(
                "learning_module_nodes_missing",
                format!("module {} must define at least one node", module.id),
            ));
        }
        for prerequisite in &module.prerequisite_module_ids {
            if prerequisite == &module.id {
                errors.push(ContentError::new(
                    "learning_module_self_prerequisite",
                    format!("module {} cannot require itself", module.id),
                ));
            } else if !module_ids.contains(prerequisite.as_str()) {
                errors.push(ContentError::new(
                    "learning_module_prerequisite_unknown",
                    format!(
                        "module {} references unknown prerequisite module {}",
                        module.id, prerequisite
                    ),
                ));
            }
        }
        for node in &module.nodes {
            validate_node(node, &node_ids, errors);
        }
    }

    validate_module_cycles(domain, errors);
    validate_node_cycles(domain, errors);
}

fn validate_node(node: &KnowledgeNode, node_ids: &HashSet<&str>, errors: &mut Vec<ContentError>) {
    if node.id.trim().is_empty() || node.title.trim().is_empty() {
        errors.push(ContentError::new(
            "learning_node_field_missing",
            "knowledge node id and title must not be empty",
        ));
    }
    if node.concept_ids.is_empty() {
        errors.push(ContentError::new(
            "learning_node_concepts_missing",
            format!("knowledge node {} must map at least one concept", node.id),
        ));
    }
    if !node.map_position.x.is_finite()
        || !node.map_position.y.is_finite()
        || !(0.0..=1.0).contains(&node.map_position.x)
        || !(0.0..=1.0).contains(&node.map_position.y)
    {
        errors.push(ContentError::new(
            "learning_map_position_invalid",
            format!(
                "knowledge node {} map_position must be within [0, 1]",
                node.id
            ),
        ));
    }
    for prerequisite in &node.prerequisite_node_ids {
        if prerequisite == &node.id {
            errors.push(ContentError::new(
                "learning_node_self_prerequisite",
                format!("knowledge node {} cannot require itself", node.id),
            ));
        } else if !node_ids.contains(prerequisite.as_str()) {
            errors.push(ContentError::new(
                "learning_node_prerequisite_unknown",
                format!(
                    "knowledge node {} references unknown prerequisite node {}",
                    node.id, prerequisite
                ),
            ));
        }
    }
    validate_source_refs(&node.source_refs, errors);

    if node.prompts.is_empty() {
        errors.push(ContentError::new(
            "learning_prompts_missing",
            format!("knowledge node {} must define at least one prompt", node.id),
        ));
    }

    let mut seen_prompts = HashSet::new();
    let mut required = 0;
    for prompt in &node.prompts {
        if !seen_prompts.insert(prompt.id.as_str()) {
            errors.push(ContentError::new(
                "learning_duplicate_prompt_id",
                format!(
                    "knowledge node {} has duplicate prompt id {}",
                    node.id, prompt.id
                ),
            ));
        }
        if prompt.id.trim().is_empty() {
            errors.push(ContentError::new(
                "learning_prompt_field_missing",
                format!("knowledge node {} has a prompt with an empty id", node.id),
            ));
        }
        if prompt.label.trim().is_empty() || prompt.placeholder.trim().is_empty() {
            errors.push(ContentError::new(
                "learning_prompt_field_missing",
                format!(
                    "knowledge node {} prompt {} needs a label and placeholder",
                    node.id, prompt.id
                ),
            ));
        }
        if prompt.required {
            required += 1;
        }
        validate_reveal(node, prompt, errors);
    }

    if !node.prompts.is_empty() && required == 0 {
        errors.push(ContentError::new(
            "learning_required_prompts_missing",
            format!("knowledge node {} has no required prompts", node.id),
        ));
    }
}

fn validate_reveal(node: &KnowledgeNode, prompt: &KnowledgePrompt, errors: &mut Vec<ContentError>) {
    let invalid = |message: String| {
        ContentError::new(
            "learning_reveal_incomplete",
            format!("knowledge node {} prompt {} {message}", node.id, prompt.id),
        )
    };
    let require_items = |items: &[String]| {
        if items.is_empty() || items.iter().any(|item| item.trim().is_empty()) {
            Some(invalid("items must be non-empty".to_owned()))
        } else {
            None
        }
    };

    match &prompt.reveal {
        LearningReveal::Text { text } => {
            if text.trim().is_empty() {
                errors.push(invalid("text reveal must not be empty".to_owned()));
            }
        }
        LearningReveal::Sequence { items } => {
            if let Some(error) = require_items(items) {
                errors.push(error);
            }
        }
        LearningReveal::Bullets { items } => {
            if let Some(error) = require_items(items) {
                errors.push(error);
            }
        }
        LearningReveal::Keywords { items } => {
            if let Some(error) = require_items(items) {
                errors.push(error);
            }
        }
        LearningReveal::Comparison { columns } => {
            if columns.len() < 2 {
                errors.push(invalid(
                    "comparison reveal needs at least two columns".to_owned(),
                ));
            }
            for column in columns {
                if column.title.trim().is_empty() {
                    errors.push(invalid(
                        "comparison column title must not be empty".to_owned(),
                    ));
                }
                if let Some(error) = require_items(&column.items) {
                    errors.push(error);
                }
            }
        }
    }
}

fn validate_source_refs(source_refs: &[SourceRef], errors: &mut Vec<ContentError>) {
    for source in source_refs {
        if source.title.trim().is_empty() || source.url.trim().is_empty() {
            errors.push(ContentError::new(
                "learning_source_ref_field_missing",
                "learning source references need a title and url",
            ));
        }
    }
}

fn validate_coverage(domain: &LearningDomain, errors: &mut Vec<ContentError>) {
    let module_count = domain.modules.len();
    let node_count = domain.nodes().count();
    let prompt_count: usize = domain.nodes().map(|node| node.prompts.len()).sum();

    if domain.coverage.module_count != module_count {
        errors.push(ContentError::new(
            "learning_coverage_mismatch",
            format!(
                "coverage.module_count {} does not match {} authored modules",
                domain.coverage.module_count, module_count
            ),
        ));
    }
    if domain.coverage.knowledge_node_count != node_count {
        errors.push(ContentError::new(
            "learning_coverage_mismatch",
            format!(
                "coverage.knowledge_node_count {} does not match {} authored nodes",
                domain.coverage.knowledge_node_count, node_count
            ),
        ));
    }
    if domain.coverage.prompt_count != prompt_count {
        errors.push(ContentError::new(
            "learning_coverage_mismatch",
            format!(
                "coverage.prompt_count {} does not match {} authored prompts",
                domain.coverage.prompt_count, prompt_count
            ),
        ));
    }

    let module_tasks: HashSet<&str> = domain
        .modules
        .iter()
        .flat_map(|module| module.task_ids.iter().map(String::as_str))
        .collect();
    let coverage_tasks: HashSet<&str> = domain
        .coverage
        .task_ids
        .iter()
        .map(String::as_str)
        .collect();
    if module_tasks != coverage_tasks {
        errors.push(ContentError::new(
            "learning_coverage_task_mismatch",
            "coverage.task_ids must equal the union of module task_ids",
        ));
    }

    let module_skills: HashSet<&str> = domain
        .modules
        .iter()
        .flat_map(|module| module.skill_ids.iter().map(String::as_str))
        .collect();
    let coverage_skills: HashSet<&str> = domain
        .coverage
        .skill_ids
        .iter()
        .map(String::as_str)
        .collect();
    if module_skills != coverage_skills {
        errors.push(ContentError::new(
            "learning_coverage_skill_mismatch",
            "coverage.skill_ids must equal the union of module skill_ids",
        ));
    }
}

fn validate_module_cycles(domain: &LearningDomain, errors: &mut Vec<ContentError>) {
    let mut adjacency: HashMap<&str, &[String]> = HashMap::new();
    for module in &domain.modules {
        adjacency.insert(module.id.as_str(), &module.prerequisite_module_ids);
    }
    if let Some(cycle) = find_cycle(&adjacency) {
        errors.push(ContentError::new(
            "learning_module_dependency_cycle",
            format!("module prerequisites contain a cycle at {cycle}"),
        ));
    }
}

fn validate_node_cycles(domain: &LearningDomain, errors: &mut Vec<ContentError>) {
    let mut adjacency: HashMap<&str, &[String]> = HashMap::new();
    for node in domain.nodes() {
        adjacency.insert(node.id.as_str(), &node.prerequisite_node_ids);
    }
    if let Some(cycle) = find_cycle(&adjacency) {
        errors.push(ContentError::new(
            "learning_node_dependency_cycle",
            format!("node prerequisites contain a cycle at {cycle}"),
        ));
    }
}

/// Returns a node on a dependency cycle, if one exists.
///
/// Only edges to known nodes are followed; unknown references are reported
/// separately, so a missing id never hides a cycle behind it.
fn find_cycle<'a>(adjacency: &HashMap<&'a str, &'a [String]>) -> Option<&'a str> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Unvisited,
        Visiting,
        Done,
    }

    fn visit<'a>(
        node: &'a str,
        adjacency: &HashMap<&'a str, &'a [String]>,
        marks: &mut HashMap<&'a str, Mark>,
    ) -> Option<&'a str> {
        marks.insert(node, Mark::Visiting);
        if let Some(neighbors) = adjacency.get(node) {
            for neighbor in neighbors.iter().map(String::as_str) {
                if !adjacency.contains_key(neighbor) {
                    continue;
                }
                match marks.get(neighbor).copied().unwrap_or(Mark::Unvisited) {
                    Mark::Visiting => return Some(neighbor),
                    Mark::Unvisited => {
                        if let Some(cycle) = visit(neighbor, adjacency, marks) {
                            return Some(cycle);
                        }
                    }
                    Mark::Done => {}
                }
            }
        }
        marks.insert(node, Mark::Done);
        None
    }

    let mut marks: HashMap<&str, Mark> = HashMap::new();
    for node in adjacency.keys() {
        if marks.get(*node).copied().unwrap_or(Mark::Unvisited) == Mark::Unvisited {
            if let Some(cycle) = visit(node, adjacency, &mut marks) {
                return Some(cycle);
            }
        }
    }
    None
}

fn errors_or_ok(errors: Vec<ContentError>) -> Result<(), Vec<ContentError>> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
