//! Deterministic, explainable next-action planner for a learning track.
//!
//! This is a small pure function, `PlannerInput -> Recommendation`. It is
//! intentionally track-agnostic: a "track" may be a vendor certification or a
//! general learning track (for example Python Fluency or PyTorch Core). The
//! planner never mentions a specific exam or vendor.
//!
//! Inputs are the learner's derived concept state (`heuristic-v1`), accepted
//! practice history, question metadata, knowledge-map nodes, and their
//! prerequisite relationships. Optional discovery progress marks a node as
//! already explored even before it produces quiz evidence.
//!
//! The planner is deliberately rule-based for V1 and makes no trained-model
//! assumptions. Assessment modes stay distinct: practice candidates are scored
//! against the state row for the question's own mode, so strength in recognition
//! never hides a weakness in application.

use std::collections::{HashMap, HashSet};

use adaptive_learn_domain::{
    AssessmentMode, ConceptWeight, InteractionType, PRIOR_ESTIMATE, retrievability,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod session;

/// Estimate at or below which a concept is treated as weak.
const WEAK_ESTIMATE: f64 = 0.55;
/// Estimate at or above which a concept is treated as strong.
const STRONG_ESTIMATE: f64 = 0.7;
/// Evidence mass below which a concept still counts as "little evidence".
const LITTLE_EVIDENCE_MASS: f64 = 2.0;
/// Retrievability at or below which a strong concept counts as stale.
const STALE_RETRIEVABILITY: f64 = 0.6;
/// Retrievability at or above which a strong concept counts as fresh.
const FRESH_RETRIEVABILITY: f64 = 0.8;
/// Penalty for recommending a question the learner just answered.
const REPEAT_PENALTY: f64 = 0.5;
/// Weight of the domain/topic weight in candidate scores.
const WEIGHT_DOMAIN: f64 = 0.15;
/// Weight of difficulty fit in question candidate scores.
const WEIGHT_DIFFICULTY_FIT: f64 = 0.1;
/// Bonus for a learning node the learner has never seen.
const UNSEEN_BONUS: f64 = 0.1;
/// Small bonus for practice questions so ties prefer active retrieval.
const PRACTICE_TIE_BONUS: f64 = 0.001;

/// A next action the learner can take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PlannerAction {
    /// Study a knowledge-map node the learner has not explored.
    LearnNode,
    /// Revisit a knowledge-map node for a strong but stale concept.
    ReviewNode,
    /// Answer a retrieval-practice question.
    PracticeQuestion,
    /// Take a domain/topic review.
    PracticeDomain,
}

impl PlannerAction {
    /// Canonical string used in logs and the API.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LearnNode => "learn_node",
            Self::ReviewNode => "review_node",
            Self::PracticeQuestion => "practice_question",
            Self::PracticeDomain => "practice_domain",
        }
    }
}

/// A stable, explainable reason code for a recommendation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationReason {
    /// No accepted evidence yet; start at the beginning of the track.
    ColdStart,
    /// A weak concept whose node has not been explored.
    WeakConcept,
    /// A weak prerequisite should be learned before its dependent concept.
    WeakPrerequisite,
    /// A weak concept the learner has already explored needs retrieval.
    NeedsPractice,
    /// A strong concept that has not been practiced in a while.
    StaleKnowledge,
    /// No single weak concept stands out; review a domain.
    DomainReview,
    /// Strong and fresh; advance to harder or applied practice.
    StrongAndFresh,
}

impl RecommendationReason {
    /// Canonical string used in logs and the API.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ColdStart => "cold_start",
            Self::WeakConcept => "weak_concept",
            Self::WeakPrerequisite => "weak_prerequisite",
            Self::NeedsPractice => "needs_practice",
            Self::StaleKnowledge => "stale_knowledge",
            Self::DomainReview => "domain_review",
            Self::StrongAndFresh => "strong_and_fresh",
        }
    }
}

/// Learner state for one `(concept, assessment mode)` pair.
#[derive(Debug, Clone, PartialEq)]
pub struct ConceptStateView {
    /// Concept identifier shared with `KnowledgeNode::concept_ids`.
    pub concept_id: String,
    /// Evidence mode this estimate measures.
    pub assessment_mode: AssessmentMode,
    /// Current estimate in `[0, 1]`.
    pub estimate: f64,
    /// Accumulated evidence mass; more mass decays more slowly.
    pub evidence_mass: f64,
    /// Number of accepted observations applied.
    pub exposure_count: i32,
    /// Most recent observation time.
    pub last_practiced_at: Option<DateTime<Utc>>,
}

/// A track domain/topic with its official weight.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannerDomain {
    /// Domain/topic identifier.
    pub id: String,
    /// Learner-facing name.
    pub name: String,
    /// Share of scored content in `(0, 1]`.
    pub weight: f64,
}

/// One knowledge-map node, flattened across modules and domains.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannerNode {
    /// Knowledge node identifier.
    pub id: String,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Owning module.
    pub module_id: String,
    /// Learner-facing node title.
    pub title: String,
    /// Modules that must be explored before this node's module is available.
    pub module_prerequisite_ids: Vec<String>,
    /// Nodes that should be explored before this node.
    pub prerequisite_node_ids: Vec<String>,
    /// Concepts this node teaches; the bridge to quiz evidence.
    pub concept_ids: Vec<String>,
}

/// Question metadata needed to recommend retrieval practice.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannerQuestion {
    /// Question identifier.
    pub id: String,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
    /// Interaction family, used for session interaction variety.
    pub interaction_type: InteractionType,
    /// Evidence mode the question measures.
    pub assessment_mode: AssessmentMode,
    /// Prior difficulty in `[0, 1]`.
    pub difficulty_prior: f64,
    /// Authored concept mappings with their evidence weights.
    pub concepts: Vec<ConceptWeight>,
}

/// Everything the planner needs, independent of storage and transport.
#[derive(Debug, Clone)]
pub struct PlannerInput {
    /// Learning track identifier (the internal certification id today).
    pub track_id: String,
    /// Learning track version identifier.
    pub track_version: String,
    /// Reference time for forgetting calculations.
    pub now: DateTime<Utc>,
    /// Derived learner concept state.
    pub states: Vec<ConceptStateView>,
    /// Track domains/topics in authored order.
    pub domains: Vec<PlannerDomain>,
    /// Knowledge nodes in presentation order.
    pub nodes: Vec<PlannerNode>,
    /// Questions available for practice.
    pub questions: Vec<PlannerQuestion>,
    /// Node ids the learner has already explored (any reveal), if known.
    pub explored_node_ids: HashSet<String>,
    /// Node ids whose required prompts are all complete, mirroring the map.
    pub unlocked_node_ids: HashSet<String>,
    /// Module ids whose every node is unlocked, mirroring the map.
    pub completed_module_ids: HashSet<String>,
    /// Recently answered question ids, to avoid immediate repeats.
    pub recent_question_ids: HashSet<String>,
}

/// A structured, explainable recommendation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Recommendation {
    /// Action to take.
    pub action: PlannerAction,
    /// Why this action was chosen.
    pub reason: RecommendationReason,
    /// Learning track the recommendation belongs to.
    pub track_id: String,
    /// Domain/topic the action belongs to.
    pub domain_id: String,
    /// Learner-facing domain name.
    pub domain_name: String,
    /// Knowledge node to open, when the action is node-based.
    pub node_id: Option<String>,
    /// Learner-facing node title, when the action is node-based.
    pub node_title: Option<String>,
    /// Question to practice, when the action targets one.
    pub question_id: Option<String>,
    /// Assessment mode the recommendation is measured in, when known.
    pub assessment_mode: Option<AssessmentMode>,
    /// Concepts the recommendation targets.
    pub concept_ids: Vec<String>,
    /// Short learner-facing title, for example `Learn tensor broadcasting`.
    pub title: String,
}

/// A cross-mode summary of one concept, used for node-level decisions.
#[derive(Debug, Clone, Copy)]
struct ConceptSummary {
    estimate: f64,
    evidence_mass: f64,
    last_practiced_at: Option<DateTime<Utc>>,
    explored: bool,
}

impl ConceptSummary {
    const UNSEEN: ConceptSummary = ConceptSummary {
        estimate: PRIOR_ESTIMATE,
        evidence_mass: 0.0,
        last_practiced_at: None,
        explored: false,
    };

    fn is_weak(self) -> bool {
        self.estimate < WEAK_ESTIMATE
    }

    fn is_strong(self) -> bool {
        self.estimate >= STRONG_ESTIMATE
    }

    fn retrieval(self, now: DateTime<Utc>) -> f64 {
        retrievability(self.evidence_mass, self.last_practiced_at, now)
    }
}

/// One scored planner candidate before it is chosen.
struct Candidate {
    score: f64,
    action: PlannerAction,
    reason: RecommendationReason,
    domain_id: String,
    node_id: Option<String>,
    question_id: Option<String>,
    assessment_mode: Option<AssessmentMode>,
    concept_ids: Vec<String>,
}

impl Candidate {
    /// Deterministic tie-break key: the most specific target id, then domain.
    fn tie_break_key(&self) -> (&str, &str) {
        let specific = self
            .node_id
            .as_deref()
            .or(self.question_id.as_deref())
            .unwrap_or("");
        (specific, self.domain_id.as_str())
    }
}

/// Planner state precomputed once per call.
struct Model<'a> {
    input: &'a PlannerInput,
    concept_global: HashMap<String, ConceptSummary>,
    state_index: HashMap<(String, AssessmentMode), &'a ConceptStateView>,
    discovered_concepts: HashSet<String>,
    node_index: HashMap<String, usize>,
    domain_index: HashMap<String, usize>,
    nodes_by_module: HashMap<String, Vec<usize>>,
    module_prereqs: HashMap<String, Vec<String>>,
}

impl<'a> Model<'a> {
    fn build(input: &'a PlannerInput) -> Self {
        let mut concept_global: HashMap<String, ConceptSummary> = HashMap::new();
        let mut state_index: HashMap<(String, AssessmentMode), &ConceptStateView> = HashMap::new();

        for state in &input.states {
            state_index.insert((state.concept_id.clone(), state.assessment_mode), state);
            let entry = concept_global
                .entry(state.concept_id.clone())
                .or_insert(ConceptSummary {
                    estimate: state.estimate,
                    evidence_mass: state.evidence_mass,
                    last_practiced_at: state.last_practiced_at,
                    explored: true,
                });
            // The weakest mode governs whether the concept as a whole is weak.
            entry.estimate = entry.estimate.min(state.estimate);
            entry.evidence_mass = entry.evidence_mass.max(state.evidence_mass);
            entry.last_practiced_at = max_time(entry.last_practiced_at, state.last_practiced_at);
            entry.explored = true;
        }

        let mut node_index = HashMap::new();
        let mut domain_index = HashMap::new();
        let mut nodes_by_module: HashMap<String, Vec<usize>> = HashMap::new();
        let module_prereqs: HashMap<String, Vec<String>> = HashMap::new();
        let mut discovered_concepts = HashSet::new();

        for (index, node) in input.nodes.iter().enumerate() {
            node_index.insert(node.id.clone(), index);
            nodes_by_module
                .entry(node.module_id.clone())
                .or_default()
                .push(index);
            if input.explored_node_ids.contains(&node.id) {
                for concept in &node.concept_ids {
                    discovered_concepts.insert(concept.clone());
                }
            }
        }
        for (index, domain) in input.domains.iter().enumerate() {
            domain_index.insert(domain.id.clone(), index);
        }

        for concept in &discovered_concepts {
            concept_global
                .entry(concept.clone())
                .or_insert(ConceptSummary {
                    estimate: PRIOR_ESTIMATE,
                    evidence_mass: 0.0,
                    last_practiced_at: None,
                    explored: true,
                });
        }

        Self {
            input,
            concept_global,
            state_index,
            discovered_concepts,
            node_index,
            domain_index,
            nodes_by_module,
            module_prereqs,
        }
        .with_module_prereqs()
    }

    fn with_module_prereqs(mut self) -> Self {
        // Module prerequisites are not carried on the node, so callers pass the
        // module definition order implicitly through node grouping. The service
        // supplies them via `module_prerequisite_ids` on the first node of a
        // module; collect the union per module so every node sees them.
        for node in &self.input.nodes {
            let entry = self
                .module_prereqs
                .entry(node.module_id.clone())
                .or_default();
            for prereq in &node.module_prerequisite_ids {
                if !entry.contains(prereq) {
                    entry.push(prereq.clone());
                }
            }
        }
        self
    }

    /// Cross-mode summary for a concept.
    fn summary(&self, concept_id: &str) -> ConceptSummary {
        self.concept_global
            .get(concept_id)
            .copied()
            .unwrap_or(ConceptSummary::UNSEEN)
    }

    /// Summary for exactly one assessment mode.
    ///
    /// A missing mode row is treated as unseen *in that mode* while staying
    /// "explored" if the concept was practiced in another mode or discovered on
    /// the map. This keeps recognition and recall evidence distinct.
    fn mode_summary(&self, concept_id: &str, mode: AssessmentMode) -> ConceptSummary {
        if let Some(state) = self.state_index.get(&(concept_id.to_owned(), mode)) {
            return ConceptSummary {
                estimate: state.estimate,
                evidence_mass: state.evidence_mass,
                last_practiced_at: state.last_practiced_at,
                explored: true,
            };
        }
        ConceptSummary {
            estimate: PRIOR_ESTIMATE,
            evidence_mass: 0.0,
            last_practiced_at: None,
            explored: self.summary(concept_id).explored,
        }
    }

    fn domain_weight(&self, domain_id: &str) -> f64 {
        self.domain_index
            .get(domain_id)
            .map(|index| self.input.domains[*index].weight.clamp(0.0, 1.0))
            .unwrap_or(0.0)
    }

    fn domain_name(&self, domain_id: &str) -> String {
        self.domain_index
            .get(domain_id)
            .map(|index| self.input.domains[*index].name.clone())
            .unwrap_or_else(|| domain_id.to_owned())
    }

    /// The weakest concept of a node, by cross-mode estimate.
    fn weakest_node_concept<'b>(&self, node: &'b PlannerNode) -> Option<(&'b str, ConceptSummary)> {
        node.concept_ids
            .iter()
            .map(|concept_id| (concept_id.as_str(), self.summary(concept_id)))
            .min_by(|a, b| {
                a.1.estimate
                    .partial_cmp(&b.1.estimate)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.0.cmp(b.0))
            })
    }

    fn node_avg_weakness(&self, node: &PlannerNode) -> f64 {
        if node.concept_ids.is_empty() {
            return 0.0;
        }
        let total: f64 = node
            .concept_ids
            .iter()
            .map(|concept_id| 1.0 - self.summary(concept_id).estimate)
            .sum();
        total / node.concept_ids.len() as f64
    }

    fn node_has_weak(&self, node: &PlannerNode) -> bool {
        node.concept_ids
            .iter()
            .any(|concept_id| self.summary(concept_id).is_weak())
    }

    /// Whether a node has been fully explored. Discovery progress counts, and so
    /// does accepted quiz evidence for every concept the node teaches.
    fn node_explored(&self, node: &PlannerNode) -> bool {
        if self.input.explored_node_ids.contains(&node.id)
            || self.input.unlocked_node_ids.contains(&node.id)
        {
            return true;
        }
        !node.concept_ids.is_empty()
            && node
                .concept_ids
                .iter()
                .all(|concept_id| self.summary(concept_id).explored)
    }

    /// Whether every required prompt on the node is complete in the map.
    fn node_unlocked(&self, node: &PlannerNode) -> bool {
        self.input.unlocked_node_ids.contains(&node.id)
    }

    /// Whether the Knowledge Map would show this node as available or in
    /// progress, i.e. not `locked`.
    ///
    /// This intentionally mirrors the frontend rule exactly: the owning module
    /// must be available (all prerequisite modules complete) and every node
    /// prerequisite must be unlocked.
    fn node_accessible(&self, node: &PlannerNode) -> bool {
        self.module_ready(&node.module_id)
            && node
                .prerequisite_node_ids
                .iter()
                .all(|id| self.input.unlocked_node_ids.contains(id))
    }

    fn module_ready(&self, module_id: &str) -> bool {
        self.module_prereqs
            .get(module_id)
            .map(|prereqs| {
                prereqs
                    .iter()
                    .all(|id| self.input.completed_module_ids.contains(id))
            })
            .unwrap_or(true)
    }

    fn unmet_module_prereqs(&self, module_id: &str) -> Vec<String> {
        self.module_prereqs
            .get(module_id)
            .map(|prereqs| {
                prereqs
                    .iter()
                    .filter(|id| !self.input.completed_module_ids.contains(*id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Weakest learnable node in a module, by average weakness then id.
    fn weakest_node_in_module(&self, module_id: &str) -> Option<usize> {
        let indices = self.nodes_by_module.get(module_id)?;
        indices
            .iter()
            .copied()
            .filter(|index| {
                let node = &self.input.nodes[*index];
                !self.node_unlocked(node) && self.node_accessible(node) && self.node_has_weak(node)
            })
            .min_by(|a, b| {
                let wa = self.node_avg_weakness(&self.input.nodes[*a]);
                let wb = self.node_avg_weakness(&self.input.nodes[*b]);
                wb.partial_cmp(&wa)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| self.input.nodes[*a].id.cmp(&self.input.nodes[*b].id))
            })
    }

    /// Weighted per-mode weakness and exploration for a practice question.
    fn question_signal(&self, question: &PlannerQuestion) -> (f64, f64, bool) {
        let mut weight_sum = 0.0;
        let mut weakness = 0.0;
        let mut min_estimate: f64 = 1.0;
        let mut any_explored = false;

        for concept in &question.concepts {
            let weight = concept.weight.clamp(0.0, 1.0);
            if weight <= 0.0 {
                continue;
            }
            let summary = self.mode_summary(&concept.concept_id, question.assessment_mode);
            weight_sum += weight;
            weakness += weight * (1.0 - summary.estimate);
            min_estimate = min_estimate.min(summary.estimate);
            any_explored = any_explored || summary.explored;
        }

        if weight_sum <= 0.0 {
            // A question with no usable concept mapping is only actionable if
            // the learner has no other signal; treat it as neutral.
            return (0.5, PRIOR_ESTIMATE, false);
        }
        (weakness / weight_sum, min_estimate, any_explored)
    }

    fn choose(&self, candidates: Vec<Candidate>) -> Option<Recommendation> {
        let best = candidates.into_iter().max_by(|a, b| {
            a.score
                .partial_cmp(&b.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                // Higher score wins; ties resolve by smallest id, then domain.
                .then_with(|| b.tie_break_key().cmp(&a.tie_break_key()))
        })?;
        Some(self.to_recommendation(best))
    }

    fn to_recommendation(&self, candidate: Candidate) -> Recommendation {
        let domain_name = self.domain_name(&candidate.domain_id);
        let node_title = candidate.node_id.as_ref().and_then(|node_id| {
            self.node_index
                .get(node_id)
                .map(|index| self.input.nodes[*index].title.clone())
        });
        let title = match candidate.action {
            PlannerAction::LearnNode => {
                format!("Learn {}", node_title.as_deref().unwrap_or(&domain_name))
            }
            PlannerAction::ReviewNode => {
                format!("Review {}", node_title.as_deref().unwrap_or(&domain_name))
            }
            PlannerAction::PracticeQuestion => format!("Practice {domain_name}"),
            PlannerAction::PracticeDomain => format!("Take a {domain_name} review"),
        };

        Recommendation {
            action: candidate.action,
            reason: candidate.reason,
            track_id: self.input.track_id.clone(),
            domain_id: candidate.domain_id,
            domain_name,
            node_id: candidate.node_id,
            node_title,
            question_id: candidate.question_id,
            assessment_mode: candidate.assessment_mode,
            concept_ids: candidate.concept_ids,
            title,
        }
    }
}

/// Chooses the single best next action for a learning track.
///
/// Returns `None` only when the track has nothing actionable at all. The rules
/// are evaluated in a fixed order so the output is deterministic:
///
/// 1. cold start
/// 2. weak prerequisite before a weak dependent concept
/// 3. weak, unexplored learning node
/// 4. weak, already-explored concept -> retrieval practice
/// 5. strong but stale concept -> review node
/// 6. strong and fresh -> harder/applied practice or a domain review
pub fn recommend(input: &PlannerInput) -> Option<Recommendation> {
    if input.domains.is_empty() && input.nodes.is_empty() && input.questions.is_empty() {
        return None;
    }

    let model = Model::build(input);

    cold_start(&model)
        .or_else(|| prerequisite_first(&model))
        .or_else(|| learn_node(&model))
        .or_else(|| practice_question(&model))
        .or_else(|| review_node(&model))
        .or_else(|| advance(&model))
}

/// Cold start: nothing accepted yet. Discovery progress still wins if present,
/// because a revealed-but-unpracticed concept should be retrieved.
fn cold_start(model: &Model<'_>) -> Option<Recommendation> {
    if !model.input.states.is_empty() {
        return None;
    }

    if !model.discovered_concepts.is_empty() {
        let candidates: Vec<Candidate> = model
            .input
            .questions
            .iter()
            .filter_map(|question| {
                let (weakness, min_estimate, any_explored) = model.question_signal(question);
                (any_explored && min_estimate < WEAK_ESTIMATE).then(|| Candidate {
                    score: weakness + model.domain_weight(&question.domain_id) * WEIGHT_DOMAIN,
                    action: PlannerAction::PracticeQuestion,
                    reason: RecommendationReason::NeedsPractice,
                    domain_id: question.domain_id.clone(),
                    node_id: None,
                    question_id: Some(question.id.clone()),
                    assessment_mode: Some(question.assessment_mode),
                    concept_ids: concepts_of(question),
                })
            })
            .collect();
        if let Some(recommendation) = model.choose(candidates) {
            return Some(recommendation);
        }
    }

    if let Some(node) = first_ready_node(model) {
        return Some(cold_start_node(model, node));
    }
    if let Some(domain) = highest_weight_domain(model) {
        return Some(model.to_recommendation(Candidate {
            score: domain.weight,
            action: PlannerAction::PracticeDomain,
            reason: RecommendationReason::ColdStart,
            domain_id: domain.id.clone(),
            node_id: None,
            question_id: None,
            assessment_mode: None,
            concept_ids: Vec::new(),
        }));
    }
    model.input.questions.first().map(|question| {
        model.to_recommendation(Candidate {
            score: 0.0,
            action: PlannerAction::PracticeQuestion,
            reason: RecommendationReason::ColdStart,
            domain_id: question.domain_id.clone(),
            node_id: None,
            question_id: Some(question.id.clone()),
            assessment_mode: Some(question.assessment_mode),
            concept_ids: concepts_of(question),
        })
    })
}

fn cold_start_node(model: &Model<'_>, node: &PlannerNode) -> Recommendation {
    model.to_recommendation(Candidate {
        score: 0.0,
        action: PlannerAction::LearnNode,
        reason: RecommendationReason::ColdStart,
        domain_id: node.domain_id.clone(),
        node_id: Some(node.id.clone()),
        question_id: None,
        assessment_mode: None,
        concept_ids: node.concept_ids.clone(),
    })
}

/// Prerequisite-first: if a weak concept's prerequisite is also weak, learn the
/// prerequisite before the dependent concept.
fn prerequisite_first(model: &Model<'_>) -> Option<Recommendation> {
    let mut candidates: Vec<Candidate> = Vec::new();

    for node in &model.input.nodes {
        let Some((_target, target_summary)) = model.weakest_node_concept(node) else {
            continue;
        };
        if !target_summary.is_weak() {
            continue;
        }

        for prereq_id in &node.prerequisite_node_ids {
            // The node-prerequisite rule only applies when the owning module is
            // already available; otherwise the module rule below handles it.
            if !model.module_ready(&node.module_id) {
                break;
            }
            let Some(index) = model.node_index.get(prereq_id) else {
                continue;
            };
            let prereq = &model.input.nodes[*index];
            // Never point at a node the map still shows as locked, and never
            // re-teach a node whose prompts are already complete.
            if model.node_unlocked(prereq) || !model.node_accessible(prereq) {
                continue;
            }
            let Some((prereq_concept, prereq_summary)) = model.weakest_node_concept(prereq) else {
                continue;
            };
            if !prereq_summary.is_weak() {
                continue;
            }
            // The prerequisite must be at least as weak as the target, so this
            // rule never recommends a redundant prerequisite.
            if prereq_summary.estimate > target_summary.estimate + 0.05 {
                continue;
            }
            let score = (1.0 - prereq_summary.estimate)
                + (1.0 - target_summary.estimate)
                + model.domain_weight(&prereq.domain_id) * WEIGHT_DOMAIN
                + if model.node_explored(prereq) {
                    0.0
                } else {
                    UNSEEN_BONUS
                };
            candidates.push(Candidate {
                score,
                action: PlannerAction::LearnNode,
                reason: RecommendationReason::WeakPrerequisite,
                domain_id: prereq.domain_id.clone(),
                node_id: Some(prereq.id.clone()),
                question_id: None,
                assessment_mode: None,
                concept_ids: vec![prereq_concept.to_owned()],
            });
        }

        // Module prerequisites: an unavailable module means an earlier module
        // still has weak concepts to learn.
        for module_id in model.unmet_module_prereqs(&node.module_id) {
            let Some(index) = model.weakest_node_in_module(&module_id) else {
                continue;
            };
            let prereq = &model.input.nodes[index];
            let Some((prereq_concept, prereq_summary)) = model.weakest_node_concept(prereq) else {
                continue;
            };
            let score = (1.0 - prereq_summary.estimate)
                + (1.0 - target_summary.estimate)
                + model.domain_weight(&prereq.domain_id) * WEIGHT_DOMAIN
                + UNSEEN_BONUS;
            candidates.push(Candidate {
                score,
                action: PlannerAction::LearnNode,
                reason: RecommendationReason::WeakPrerequisite,
                domain_id: prereq.domain_id.clone(),
                node_id: Some(prereq.id.clone()),
                question_id: None,
                assessment_mode: None,
                concept_ids: vec![prereq_concept.to_owned()],
            });
        }
    }

    model.choose(candidates)
}

/// Weak, not-yet-explored concept with little evidence -> learn its node.
fn learn_node(model: &Model<'_>) -> Option<Recommendation> {
    let candidates: Vec<Candidate> = model
        .input
        .nodes
        .iter()
        .filter_map(|node| {
            if model.node_explored(node)
                || !model.node_accessible(node)
                || !model.node_has_weak(node)
            {
                return None;
            }
            let (_concept, summary) = model.weakest_node_concept(node)?;
            if summary.evidence_mass >= LITTLE_EVIDENCE_MASS {
                return None;
            }
            let score = model.node_avg_weakness(node)
                + model.domain_weight(&node.domain_id) * WEIGHT_DOMAIN
                + if summary.explored { 0.0 } else { UNSEEN_BONUS };
            Some(Candidate {
                score,
                action: PlannerAction::LearnNode,
                reason: RecommendationReason::WeakConcept,
                domain_id: node.domain_id.clone(),
                node_id: Some(node.id.clone()),
                question_id: None,
                assessment_mode: None,
                concept_ids: node.concept_ids.clone(),
            })
        })
        .collect();
    model.choose(candidates)
}

/// Weak, already-explored concept -> retrieval practice in its own mode.
fn practice_question(model: &Model<'_>) -> Option<Recommendation> {
    let candidates: Vec<Candidate> = model
        .input
        .questions
        .iter()
        .filter_map(|question| {
            let (weakness, min_estimate, any_explored) = model.question_signal(question);
            if !any_explored || min_estimate >= WEAK_ESTIMATE {
                return None;
            }
            let estimate = 1.0 - weakness;
            let fit = 1.0 - (question.difficulty_prior.clamp(0.0, 1.0) - estimate).abs();
            let repeat = if model.input.recent_question_ids.contains(&question.id) {
                REPEAT_PENALTY
            } else {
                0.0
            };
            Some(Candidate {
                score: weakness
                    + fit * WEIGHT_DIFFICULTY_FIT
                    + model.domain_weight(&question.domain_id) * WEIGHT_DOMAIN
                    + PRACTICE_TIE_BONUS
                    - repeat,
                action: PlannerAction::PracticeQuestion,
                reason: RecommendationReason::NeedsPractice,
                domain_id: question.domain_id.clone(),
                node_id: None,
                question_id: Some(question.id.clone()),
                assessment_mode: Some(question.assessment_mode),
                concept_ids: concepts_of(question),
            })
        })
        .collect();
    model.choose(candidates)
}

/// Strong but stale concept -> revisit its node.
fn review_node(model: &Model<'_>) -> Option<Recommendation> {
    let candidates: Vec<Candidate> = model
        .input
        .nodes
        .iter()
        .filter_map(|node| {
            if node.concept_ids.is_empty() || !model.node_accessible(node) {
                return None;
            }
            let summaries: Vec<ConceptSummary> = node
                .concept_ids
                .iter()
                .map(|concept_id| model.summary(concept_id))
                .collect();
            if !summaries.iter().all(|summary| summary.is_strong()) {
                return None;
            }
            let retrieval = summaries
                .iter()
                .map(|summary| summary.retrieval(model.input.now))
                .fold(1.0_f64, f64::min);
            if retrieval >= STALE_RETRIEVABILITY {
                return None;
            }
            Some(Candidate {
                score: (1.0 - retrieval) + model.domain_weight(&node.domain_id) * WEIGHT_DOMAIN,
                action: PlannerAction::ReviewNode,
                reason: RecommendationReason::StaleKnowledge,
                domain_id: node.domain_id.clone(),
                node_id: Some(node.id.clone()),
                question_id: None,
                assessment_mode: None,
                concept_ids: node.concept_ids.clone(),
            })
        })
        .collect();
    model.choose(candidates)
}

/// Strong and fresh: advance with harder/applied practice or a domain review.
fn advance(model: &Model<'_>) -> Option<Recommendation> {
    let mut candidates: Vec<Candidate> = Vec::new();

    for question in &model.input.questions {
        let summaries: Vec<ConceptSummary> = question
            .concepts
            .iter()
            .map(|concept| model.mode_summary(&concept.concept_id, question.assessment_mode))
            .collect();
        if summaries.is_empty()
            || !summaries.iter().all(|summary| {
                summary.is_strong() && summary.retrieval(model.input.now) >= FRESH_RETRIEVABILITY
            })
        {
            continue;
        }
        let repeat = if model.input.recent_question_ids.contains(&question.id) {
            REPEAT_PENALTY
        } else {
            0.0
        };
        let applied = if question.assessment_mode == AssessmentMode::Application {
            0.15
        } else {
            0.0
        };
        candidates.push(Candidate {
            score: question.difficulty_prior.clamp(0.0, 1.0)
                + applied
                + model.domain_weight(&question.domain_id) * WEIGHT_DOMAIN
                - repeat,
            action: PlannerAction::PracticeQuestion,
            reason: RecommendationReason::StrongAndFresh,
            domain_id: question.domain_id.clone(),
            node_id: None,
            question_id: Some(question.id.clone()),
            assessment_mode: Some(question.assessment_mode),
            concept_ids: concepts_of(question),
        });
    }

    if let Some(recommendation) = model.choose(candidates) {
        return Some(recommendation);
    }

    let domain = highest_weight_domain(model)?;
    Some(model.to_recommendation(Candidate {
        score: domain.weight,
        action: PlannerAction::PracticeDomain,
        reason: RecommendationReason::DomainReview,
        domain_id: domain.id.clone(),
        node_id: None,
        question_id: None,
        assessment_mode: None,
        concept_ids: Vec::new(),
    }))
}

fn first_ready_node<'a>(model: &'a Model<'a>) -> Option<&'a PlannerNode> {
    model
        .input
        .nodes
        .iter()
        .find(|node| model.node_accessible(node))
}

fn highest_weight_domain<'a>(model: &'a Model<'a>) -> Option<&'a PlannerDomain> {
    model.input.domains.iter().max_by(|a, b| {
        a.weight
            .partial_cmp(&b.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.id.cmp(&a.id))
    })
}

fn concepts_of(question: &PlannerQuestion) -> Vec<String> {
    question
        .concepts
        .iter()
        .map(|concept| concept.concept_id.clone())
        .collect()
}

fn max_time(
    existing: Option<DateTime<Utc>>,
    candidate: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    match (existing, candidate) {
        (Some(existing), Some(candidate)) => Some(existing.max(candidate)),
        (Some(existing), None) => Some(existing),
        (None, candidate) => candidate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn concept(concept_id: &str, weight: f64) -> ConceptWeight {
        ConceptWeight {
            concept_id: concept_id.to_owned(),
            weight,
        }
    }

    fn domain(id: &str, weight: f64) -> PlannerDomain {
        PlannerDomain {
            id: id.to_owned(),
            name: format!("Domain {id}"),
            weight,
        }
    }

    fn node(id: &str, domain_id: &str, module_id: &str, concepts: &[&str]) -> PlannerNode {
        PlannerNode {
            id: id.to_owned(),
            domain_id: domain_id.to_owned(),
            module_id: module_id.to_owned(),
            title: format!("Node {id}"),
            module_prerequisite_ids: Vec::new(),
            prerequisite_node_ids: Vec::new(),
            concept_ids: concepts.iter().map(|c| (*c).to_owned()).collect(),
        }
    }

    fn question(
        id: &str,
        domain_id: &str,
        mode: AssessmentMode,
        difficulty: f64,
        concepts: Vec<ConceptWeight>,
    ) -> PlannerQuestion {
        PlannerQuestion {
            id: id.to_owned(),
            domain_id: domain_id.to_owned(),
            task_id: format!("{domain_id}-task"),
            interaction_type: InteractionType::Ordering,
            assessment_mode: mode,
            difficulty_prior: difficulty,
            concepts,
        }
    }

    fn state(
        concept_id: &str,
        mode: AssessmentMode,
        estimate: f64,
        mass: f64,
        last: DateTime<Utc>,
    ) -> ConceptStateView {
        ConceptStateView {
            concept_id: concept_id.to_owned(),
            assessment_mode: mode,
            estimate,
            evidence_mass: mass,
            exposure_count: 1,
            last_practiced_at: Some(last),
        }
    }

    fn input(
        domains: Vec<PlannerDomain>,
        nodes: Vec<PlannerNode>,
        questions: Vec<PlannerQuestion>,
        states: Vec<ConceptStateView>,
    ) -> PlannerInput {
        PlannerInput {
            track_id: "python-fluency".to_owned(),
            track_version: "python-fluency-v1".to_owned(),
            now: now(),
            states,
            domains,
            nodes,
            questions,
            explored_node_ids: HashSet::new(),
            unlocked_node_ids: HashSet::new(),
            completed_module_ids: HashSet::new(),
            recent_question_ids: HashSet::new(),
        }
    }

    #[test]
    fn cold_start_learns_the_first_node() {
        let recommendation = recommend(&input(
            vec![domain("domain-1", 1.0)],
            vec![node("n1", "domain-1", "m1", &["python.loops"])],
            vec![question(
                "q1",
                "domain-1",
                AssessmentMode::Recall,
                0.5,
                vec![concept("python.loops", 1.0)],
            )],
            Vec::new(),
        ))
        .expect("recommendation");

        assert_eq!(recommendation.action, PlannerAction::LearnNode);
        assert_eq!(recommendation.reason, RecommendationReason::ColdStart);
        assert_eq!(recommendation.node_id.as_deref(), Some("n1"));
        assert_eq!(recommendation.title, "Learn Node n1");
    }

    #[test]
    fn cold_start_with_no_content_returns_none() {
        assert!(recommend(&input(Vec::new(), Vec::new(), Vec::new(), Vec::new())).is_none());
    }

    #[test]
    fn weak_unseen_concept_learns_its_node() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n-strong", "domain-1", "m1", &["python.strong"]),
                node("n-weak", "domain-1", "m1", &["python.weak"]),
            ],
            Vec::new(),
            vec![state(
                "python.strong",
                AssessmentMode::Recall,
                0.95,
                8.0,
                now(),
            )],
        );
        content.explored_node_ids.insert("n-strong".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::LearnNode);
        assert_eq!(recommendation.reason, RecommendationReason::WeakConcept);
        assert_eq!(recommendation.node_id.as_deref(), Some("n-weak"));
        assert_eq!(recommendation.concept_ids, vec!["python.weak".to_owned()]);
    }

    #[test]
    fn weak_prerequisite_is_learned_before_its_dependent() {
        let mut dependent = node("n-dependent", "domain-1", "m1", &["python.generators"]);
        dependent.prerequisite_node_ids = vec!["n-prereq".to_owned()];
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n-prereq", "domain-1", "m1", &["python.iterators"]),
                dependent,
            ],
            Vec::new(),
            Vec::new(),
        );
        // Some evidence on an unrelated concept makes this non-cold-start.
        content.states.push(state(
            "python.basics",
            AssessmentMode::Recall,
            0.9,
            8.0,
            now(),
        ));

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::LearnNode);
        assert_eq!(
            recommendation.reason,
            RecommendationReason::WeakPrerequisite
        );
        assert_eq!(recommendation.node_id.as_deref(), Some("n-prereq"));
    }

    #[test]
    fn weak_explored_concept_becomes_retrieval_practice() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            Vec::new(),
            vec![question(
                "q1",
                "domain-1",
                AssessmentMode::Recall,
                0.4,
                vec![concept("python.loops", 1.0)],
            )],
            vec![state(
                "python.loops",
                AssessmentMode::Recall,
                0.2,
                4.0,
                now(),
            )],
        );
        content.explored_node_ids.insert("n-loops".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::PracticeQuestion);
        assert_eq!(recommendation.reason, RecommendationReason::NeedsPractice);
        assert_eq!(recommendation.question_id.as_deref(), Some("q1"));
    }

    #[test]
    fn stale_strong_concept_is_reviewed() {
        let stale = state(
            "python.loops",
            AssessmentMode::Recall,
            0.95,
            3.0,
            now() - chrono::Duration::days(60),
        );
        let content = input(
            vec![domain("domain-1", 1.0)],
            vec![node("n-loops", "domain-1", "m1", &["python.loops"])],
            Vec::new(),
            vec![stale],
        );

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::ReviewNode);
        assert_eq!(recommendation.reason, RecommendationReason::StaleKnowledge);
        assert_eq!(recommendation.node_id.as_deref(), Some("n-loops"));
    }

    #[test]
    fn strong_fresh_concept_is_deprioritized_for_a_weaker_concept() {
        let content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n-fresh", "domain-1", "m1", &["python.fresh"]),
                node("n-weak", "domain-1", "m1", &["python.weak"]),
            ],
            vec![question(
                "q-weak",
                "domain-1",
                AssessmentMode::Recall,
                0.3,
                vec![concept("python.weak", 1.0)],
            )],
            vec![
                state("python.fresh", AssessmentMode::Recall, 0.95, 9.0, now()),
                state("python.weak", AssessmentMode::Recall, 0.15, 1.0, now()),
            ],
        );

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(
            recommendation.reason,
            RecommendationReason::NeedsPractice,
            "the strong, fresh concept must not be chosen first"
        );
        assert_eq!(recommendation.concept_ids, vec!["python.weak".to_owned()]);
        assert_ne!(recommendation.reason, RecommendationReason::StrongAndFresh);
    }

    #[test]
    fn assessment_modes_are_not_mixed() {
        // Strong recognition, weak application. The application question must win.
        let weak_application = question(
            "q-app",
            "domain-1",
            AssessmentMode::Application,
            0.6,
            vec![concept("python.loops", 1.0)],
        );
        let strong_recognition = question(
            "q-rec",
            "domain-1",
            AssessmentMode::Recognition,
            0.2,
            vec![concept("python.loops", 1.0)],
        );
        let content = input(
            vec![domain("domain-1", 1.0)],
            Vec::new(),
            vec![strong_recognition, weak_application],
            vec![
                state(
                    "python.loops",
                    AssessmentMode::Recognition,
                    0.97,
                    9.0,
                    now(),
                ),
                state("python.loops", AssessmentMode::Application, 0.1, 4.0, now()),
            ],
        );

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::PracticeQuestion);
        assert_eq!(
            recommendation.assessment_mode,
            Some(AssessmentMode::Application)
        );
        assert_eq!(recommendation.question_id.as_deref(), Some("q-app"));
    }

    #[test]
    fn deterministic_output_for_identical_input() {
        let content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n-b", "domain-1", "m1", &["python.b"]),
                node("n-a", "domain-1", "m1", &["python.a"]),
            ],
            Vec::new(),
            vec![state(
                "python.other",
                AssessmentMode::Recall,
                0.95,
                8.0,
                now(),
            )],
        );

        let first = recommend(&content).expect("first");
        for _ in 0..5 {
            let next = recommend(&content).expect("next");
            assert_eq!(first, next);
        }
        // Equal scores resolve to the smallest node id.
        assert_eq!(first.node_id.as_deref(), Some("n-a"));
    }

    #[test]
    fn weak_concept_without_a_node_falls_back_to_practice() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            Vec::new(),
            vec![question(
                "q1",
                "domain-1",
                AssessmentMode::Recall,
                0.5,
                vec![concept("python.orphan", 1.0)],
            )],
            vec![state(
                "python.orphan",
                AssessmentMode::Recall,
                0.25,
                3.0,
                now(),
            )],
        );
        content.explored_node_ids.insert("some-node".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::PracticeQuestion);
        assert_eq!(recommendation.reason, RecommendationReason::NeedsPractice);
    }

    #[test]
    fn strong_and_fresh_advances_to_applied_practice() {
        let content = input(
            vec![domain("domain-1", 1.0)],
            Vec::new(),
            vec![question(
                "q-app",
                "domain-1",
                AssessmentMode::Application,
                0.8,
                vec![concept("python.loops", 1.0)],
            )],
            vec![state(
                "python.loops",
                AssessmentMode::Application,
                0.95,
                9.0,
                now(),
            )],
        );

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::PracticeQuestion);
        assert_eq!(recommendation.reason, RecommendationReason::StrongAndFresh);
        assert_eq!(recommendation.question_id.as_deref(), Some("q-app"));
    }

    #[test]
    fn domain_review_is_the_last_resort() {
        let content = input(
            vec![domain("domain-1", 0.6), domain("domain-2", 0.4)],
            Vec::new(),
            Vec::new(),
            vec![state(
                "python.loops",
                AssessmentMode::Recall,
                0.5,
                1.0,
                now(),
            )],
        );

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::PracticeDomain);
        assert_eq!(recommendation.reason, RecommendationReason::DomainReview);
        assert_eq!(recommendation.domain_id, "domain-1");
    }

    #[test]
    fn non_certification_tracks_plan_the_same_way() {
        // A generic track with no vendor metadata still produces a node plan.
        let mut content = input(
            vec![domain("topic-1", 1.0)],
            vec![node("n1", "topic-1", "m1", &["python.comprehensions"])],
            Vec::new(),
            Vec::new(),
        );
        content.track_id = "python-fluency".to_owned();

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.track_id, "python-fluency");
        assert_eq!(recommendation.action, PlannerAction::LearnNode);
        assert_eq!(recommendation.reason, RecommendationReason::ColdStart);
    }

    fn with_module_prereqs(mut node: PlannerNode, prereqs: &[&str]) -> PlannerNode {
        node.module_prerequisite_ids = prereqs.iter().map(|id| (*id).to_owned()).collect();
        node
    }

    #[test]
    fn untouched_prerequisite_module_blocks_its_dependent() {
        let content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n1", "domain-1", "m1", &["python.a"]),
                with_module_prereqs(node("n2", "domain-1", "m2", &["python.b"]), &["m1"]),
            ],
            Vec::new(),
            Vec::new(),
        );

        // Cold start: the only accessible node is in the root module.
        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.node_id.as_deref(), Some("n1"));
        assert_ne!(recommendation.node_id.as_deref(), Some("n2"));
    }

    #[test]
    fn partially_completed_prerequisite_module_does_not_unlock_dependent() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n1", "domain-1", "m1", &["python.a"]),
                node("n2", "domain-1", "m1", &["python.b"]),
                with_module_prereqs(node("n3", "domain-1", "m2", &["python.c"]), &["m1"]),
            ],
            Vec::new(),
            Vec::new(),
        );
        // n1 is unlocked, but n2 is not, so m1 is not complete.
        content.unlocked_node_ids.insert("n1".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.action, PlannerAction::LearnNode);
        assert_ne!(recommendation.node_id.as_deref(), Some("n3"));
        assert!(
            matches!(recommendation.node_id.as_deref(), Some("n1" | "n2")),
            "expected a node from the available module: {recommendation:?}"
        );
    }

    #[test]
    fn completed_prerequisite_module_unlocks_dependent() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n1", "domain-1", "m1", &["python.a"]),
                with_module_prereqs(node("n3", "domain-1", "m2", &["python.c"]), &["m1"]),
            ],
            Vec::new(),
            vec![state("python.a", AssessmentMode::Recall, 0.95, 8.0, now())],
        );
        // Every node of m1 is unlocked, so m1 is complete.
        content.unlocked_node_ids.insert("n1".to_owned());
        content.completed_module_ids.insert("m1".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.node_id.as_deref(), Some("n3"));
        assert_eq!(recommendation.reason, RecommendationReason::WeakConcept);
    }

    #[test]
    fn planner_never_recommends_a_map_locked_node() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![
                node("n1", "domain-1", "m1", &["python.a"]),
                with_module_prereqs(node("n2", "domain-1", "m2", &["python.b"]), &["m1"]),
            ],
            Vec::new(),
            vec![
                // The only weak concept lives in the locked dependent module.
                state("python.a", AssessmentMode::Recall, 0.95, 8.0, now()),
                state("python.b", AssessmentMode::Recall, 0.1, 1.0, now()),
            ],
        );
        content.unlocked_node_ids.insert("n1".to_owned());

        let recommendation = recommend(&content).expect("recommendation");
        assert_ne!(
            recommendation.node_id.as_deref(),
            Some("n2"),
            "a locked node must never be recommended: {recommendation:?}"
        );
        assert_eq!(recommendation.action, PlannerAction::PracticeDomain);
    }

    #[test]
    fn node_prerequisite_must_be_unlocked_before_dependent() {
        let mut content = input(
            vec![domain("domain-1", 1.0)],
            vec![node("n1", "domain-1", "m1", &["python.a"]), {
                let mut dependent = node("n2", "domain-1", "m1", &["python.b"]);
                dependent.prerequisite_node_ids = vec!["n1".to_owned()];
                dependent
            }],
            Vec::new(),
            Vec::new(),
        );
        // The map shows n2 locked because n1 is not unlocked yet.
        content.explored_node_ids.insert("n1".to_owned());
        // Some accepted evidence keeps this out of cold start.
        content.states.push(state(
            "python.other",
            AssessmentMode::Recall,
            0.95,
            8.0,
            now(),
        ));

        let recommendation = recommend(&content).expect("recommendation");
        assert_eq!(recommendation.node_id.as_deref(), Some("n1"));
        assert_eq!(
            recommendation.reason,
            RecommendationReason::WeakPrerequisite
        );
    }
}
