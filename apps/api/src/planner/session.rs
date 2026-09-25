//! Deterministic personalized study-session planner.
//!
//! A session is an ordered list of activities for one Learning Track. The core
//! is a pure function, [`plan_session`], that reuses the next-action planner's
//! concept-state model ([`super::Model`]) and the existing adaptive question
//! selector. It is track-agnostic and never mentions a specific exam or vendor.
//!
//! V1 is rule-based and deterministic: identical input produces an identical
//! session. It is optional — the frontend falls back to a standard,
//! non-adaptive session when planning is unavailable.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    ConceptSummary, LITTLE_EVIDENCE_MASS, Model, PlannerInput, PlannerQuestion,
    STALE_RETRIEVABILITY, UNSEEN_BONUS, WEAK_ESTIMATE, WEIGHT_DIFFICULTY_FIT, WEIGHT_DOMAIN,
};
use crate::selection::{self, Candidate, HistoryEntry};

/// Estimated minutes for one knowledge-node activity.
const NODE_MINUTES: u32 = 4;
/// Estimated minutes for one retrieval-practice question.
const QUESTION_MINUTES: u32 = 2;
/// Estimated minutes for a domain-level review activity.
const DOMAIN_REVIEW_MINUTES: u32 = 6;
/// Slack above the requested time before activities are trimmed.
const TIME_SLACK_MINUTES: u32 = 2;
/// Maximum activities in one session.
const MAX_ACTIVITIES: usize = 6;
/// Questions per retrieval-practice activity.
const PRACTICE_QUESTIONS: usize = 3;
/// Bonus for a node that is a prerequisite of another weak node.
const PREREQUISITE_BONUS: f64 = 0.25;
/// Coverage reviews added at the end when time and domains remain.
const MAX_COVERAGE_ACTIVITIES: usize = 2;

/// How the learner wants a session balanced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionPreference {
    /// A mix of learning and retrieval practice.
    #[default]
    Balanced,
    /// More retrieval practice, less new learning.
    MorePractice,
    /// More learning, less retrieval practice.
    MoreLearning,
}

impl SessionPreference {
    /// Canonical string used in the API and auxiliary logs.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Balanced => "balanced",
            Self::MorePractice => "more_practice",
            Self::MoreLearning => "more_learning",
        }
    }
}

/// What one session activity asks the learner to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionActivityKind {
    /// Study a knowledge-map node.
    LearnNode,
    /// Revisit a node for a strong but stale concept.
    ReviewNode,
    /// Answer server-selected retrieval-practice questions.
    Practice,
    /// Take a domain/topic review with the normal adaptive domain quiz.
    PracticeDomain,
}

/// One planned activity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SessionActivity {
    /// Activity kind.
    pub kind: SessionActivityKind,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Learner-facing domain name.
    pub domain_name: String,
    /// Knowledge node, for node activities.
    pub node_id: Option<String>,
    /// Learner-facing node title, for node activities.
    pub node_title: Option<String>,
    /// Server-selected questions, for `practice` activities. The client never
    /// supplies these; it only anchors the mission on the first one.
    pub question_ids: Vec<String>,
    /// Concepts the activity targets.
    pub concept_ids: Vec<String>,
    /// Short learner-facing title, for example `Review VPC route tables`.
    pub title: String,
    /// Estimated minutes for this activity.
    pub estimated_minutes: u32,
}

/// A planned study session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StudySession {
    /// Learning track the session belongs to.
    pub track_id: String,
    /// Estimated total minutes.
    pub estimated_minutes: u32,
    /// Ordered activities.
    pub activities: Vec<SessionActivity>,
}

/// Everything the session planner needs.
#[derive(Debug, Clone)]
pub struct SessionPlannerInput {
    /// Shared planner input (state, content, discovery, recency).
    pub planner: PlannerInput,
    /// Requested approximate session length.
    pub available_minutes: u32,
    /// Learner planning preference.
    pub preference: SessionPreference,
    /// Recent accepted attempts, used for repeat-aware related selection.
    pub history: Vec<HistoryEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeKind {
    Learn,
    Review,
}

#[derive(Debug, Clone)]
struct NodeActivity {
    kind: NodeKind,
    node_index: usize,
    score: f64,
}

#[derive(Debug, Clone)]
struct PracticeActivity {
    domain_id: String,
    question_ids: Vec<String>,
    concept_ids: Vec<String>,
    anchor_id: String,
}

/// Builds a deterministic study session, or `None` when nothing is actionable.
pub fn plan_session(input: &SessionPlannerInput) -> Option<StudySession> {
    if input.planner.domains.is_empty()
        && input.planner.nodes.is_empty()
        && input.planner.questions.is_empty()
    {
        return None;
    }

    let model = Model::build(&input.planner);
    let node_activities = node_activities(&model);
    let practice_activities = practice_activities(&model, &input.history);

    let (node_budget, practice_budget) = match input.preference {
        SessionPreference::Balanced => (2usize, 2usize),
        SessionPreference::MorePractice => (1usize, 3usize),
        SessionPreference::MoreLearning => (3usize, 1usize),
    };

    let learn_nodes: Vec<&NodeActivity> = node_activities
        .iter()
        .filter(|activity| activity.kind == NodeKind::Learn)
        .collect();
    let review_nodes: Vec<&NodeActivity> = node_activities
        .iter()
        .filter(|activity| activity.kind == NodeKind::Review)
        .collect();

    let chosen_nodes = choose_nodes(&learn_nodes, &review_nodes, node_budget);
    let chosen_practice = select_practice(practice_activities, practice_budget);

    let mut activities: Vec<SessionActivity> = Vec::new();

    // Learn/prerequisite first, then one practice, then remaining nodes, then
    // remaining practice so the session finishes with retrieval.
    let mut learn_iter = chosen_nodes
        .iter()
        .filter(|activity| activity.kind == NodeKind::Learn)
        .peekable();
    let review_iter = chosen_nodes
        .iter()
        .filter(|activity| activity.kind == NodeKind::Review);
    let mut practice_iter = chosen_practice.iter().peekable();

    if let Some(activity) = learn_iter.next() {
        activities.push(node_activity(&model, activity));
    }
    if let Some(practice) = practice_iter.next() {
        activities.push(practice_activity(&model, practice));
    }
    for activity in learn_iter {
        activities.push(node_activity(&model, activity));
    }
    for activity in review_iter {
        activities.push(node_activity(&model, activity));
    }
    for practice in practice_iter {
        activities.push(practice_activity(&model, practice));
    }

    // Fill remaining time with domain coverage, one per unused domain.
    let used_domains: HashSet<String> = activities
        .iter()
        .map(|activity| activity.domain_id.clone())
        .collect();
    if !input.planner.questions.is_empty() {
        let mut coverage_added = 0usize;
        for domain_id in coverage_domains(&model) {
            if activities.len() >= MAX_ACTIVITIES || coverage_added >= MAX_COVERAGE_ACTIVITIES {
                break;
            }
            if used_domains.contains(&domain_id) {
                continue;
            }
            let domain_name = model.domain_name(&domain_id);
            activities.push(SessionActivity {
                kind: SessionActivityKind::PracticeDomain,
                domain_id,
                title: format!("Take a {domain_name} review"),
                domain_name,
                node_id: None,
                node_title: None,
                question_ids: Vec::new(),
                concept_ids: Vec::new(),
                estimated_minutes: DOMAIN_REVIEW_MINUTES,
            });
            coverage_added += 1;
        }
    }

    let activities = trim_to_time(activities, input.available_minutes);
    if activities.is_empty() {
        return None;
    }

    let estimated_minutes = activities
        .iter()
        .map(|activity| activity.estimated_minutes)
        .sum();

    Some(StudySession {
        track_id: model.input.track_id.clone(),
        estimated_minutes,
        activities,
    })
}

/// Picks node activities: prefer one learning node, then a review, then fill.
fn choose_nodes<'a>(
    learn_nodes: &[&'a NodeActivity],
    review_nodes: &[&'a NodeActivity],
    budget: usize,
) -> Vec<&'a NodeActivity> {
    let mut chosen: Vec<&NodeActivity> = Vec::new();
    if let Some(node) = learn_nodes.first() {
        chosen.push(node);
    }
    if chosen.len() < budget {
        if let Some(node) = review_nodes.first() {
            chosen.push(node);
        }
    }
    for node in learn_nodes.iter().skip(1) {
        if chosen.len() >= budget {
            break;
        }
        chosen.push(node);
    }
    for node in review_nodes.iter().skip(1) {
        if chosen.len() >= budget {
            break;
        }
        chosen.push(node);
    }
    chosen
}

/// Keeps at most one activity per domain first, then fills remaining slots.
fn select_practice(activities: Vec<PracticeActivity>, budget: usize) -> Vec<PracticeActivity> {
    let mut selected: Vec<PracticeActivity> = Vec::new();
    let mut used_domains: HashSet<String> = HashSet::new();

    for activity in &activities {
        if selected.len() >= budget {
            break;
        }
        if used_domains.insert(activity.domain_id.clone()) {
            selected.push(activity.clone());
        }
    }
    for activity in activities {
        if selected.len() >= budget {
            break;
        }
        if selected
            .iter()
            .any(|chosen| chosen.anchor_id == activity.anchor_id)
        {
            continue;
        }
        selected.push(activity);
    }
    selected
}

fn node_activities(model: &Model<'_>) -> Vec<NodeActivity> {
    let mut activities: Vec<NodeActivity> = Vec::new();

    for (node_index, node) in model.input.nodes.iter().enumerate() {
        if !model.node_accessible(node) || model.node_unlocked(node) {
            continue;
        }
        if node.concept_ids.is_empty() {
            continue;
        }
        let summaries: Vec<ConceptSummary> = node
            .concept_ids
            .iter()
            .map(|concept_id| model.summary(concept_id))
            .collect();
        let prereq_bonus = if is_prerequisite_of_weak(model, &node.id) {
            PREREQUISITE_BONUS
        } else {
            0.0
        };
        let retrieval = summaries
            .iter()
            .map(|summary| summary.retrieval(model.input.now))
            .fold(1.0_f64, f64::min);

        if summaries.iter().all(|summary| summary.is_strong()) && retrieval < STALE_RETRIEVABILITY {
            activities.push(NodeActivity {
                kind: NodeKind::Review,
                node_index,
                score: (1.0 - retrieval)
                    + model.domain_weight(&node.domain_id) * WEIGHT_DOMAIN
                    + prereq_bonus,
            });
        } else if model.node_has_weak(node) && !model.node_explored(node) {
            let little_evidence = model
                .weakest_node_concept(node)
                .map(|(_, summary)| summary.evidence_mass < LITTLE_EVIDENCE_MASS)
                .unwrap_or(true);
            if little_evidence {
                activities.push(NodeActivity {
                    kind: NodeKind::Learn,
                    node_index,
                    score: model.node_avg_weakness(node)
                        + model.domain_weight(&node.domain_id) * WEIGHT_DOMAIN
                        + UNSEEN_BONUS
                        + prereq_bonus,
                });
            }
        }
    }

    activities.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                model.input.nodes[a.node_index]
                    .id
                    .cmp(&model.input.nodes[b.node_index].id)
            })
    });
    activities
}

fn practice_activities(model: &Model<'_>, history: &[HistoryEntry]) -> Vec<PracticeActivity> {
    let candidates: Vec<Candidate> = model.input.questions.iter().map(to_candidate).collect();

    let mut anchors: Vec<(f64, usize)> = Vec::new();
    for (index, question) in model.input.questions.iter().enumerate() {
        let (weakness, min_estimate, any_explored) = model.question_signal(question);
        if !any_explored || min_estimate >= WEAK_ESTIMATE {
            continue;
        }
        let estimate = 1.0 - weakness;
        let fit = 1.0 - (question.difficulty_prior.clamp(0.0, 1.0) - estimate).abs();
        let repeat = if model.input.recent_question_ids.contains(&question.id) {
            super::REPEAT_PENALTY
        } else {
            0.0
        };
        let score = weakness
            + fit * WEIGHT_DIFFICULTY_FIT
            + model.domain_weight(&question.domain_id) * WEIGHT_DOMAIN
            - repeat;
        anchors.push((score, index));
    }

    anchors.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                model.input.questions[a.1]
                    .id
                    .cmp(&model.input.questions[b.1].id)
            })
    });

    let mut activities: Vec<PracticeActivity> = Vec::new();
    let mut used_questions: HashSet<String> = HashSet::new();
    for (_, index) in anchors {
        let question = &model.input.questions[index];
        if used_questions.contains(&question.id) {
            continue;
        }
        let question_ids = selection::recommended_practice(
            &candidates[index],
            &candidates,
            history,
            PRACTICE_QUESTIONS,
        );
        if question_ids.is_empty() {
            continue;
        }
        for id in &question_ids {
            used_questions.insert(id.clone());
        }
        activities.push(PracticeActivity {
            domain_id: question.domain_id.clone(),
            concept_ids: question
                .concepts
                .iter()
                .map(|concept| concept.concept_id.clone())
                .collect(),
            anchor_id: question.id.clone(),
            question_ids,
        });
    }
    activities
}

/// Domains that have questions, highest weight first, then id.
fn coverage_domains(model: &Model<'_>) -> Vec<String> {
    let mut domains: Vec<(&str, f64)> = model
        .input
        .domains
        .iter()
        .filter(|domain| {
            model
                .input
                .questions
                .iter()
                .any(|question| question.domain_id == domain.id)
        })
        .map(|domain| (domain.id.as_str(), domain.weight))
        .collect();
    domains.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(b.0))
    });
    domains.into_iter().map(|(id, _)| id.to_owned()).collect()
}

fn node_activity(model: &Model<'_>, activity: &NodeActivity) -> SessionActivity {
    let node = &model.input.nodes[activity.node_index];
    let title = match activity.kind {
        NodeKind::Learn => format!("Learn {}", node.title),
        NodeKind::Review => format!("Review {}", node.title),
    };
    SessionActivity {
        kind: match activity.kind {
            NodeKind::Learn => SessionActivityKind::LearnNode,
            NodeKind::Review => SessionActivityKind::ReviewNode,
        },
        domain_id: node.domain_id.clone(),
        domain_name: model.domain_name(&node.domain_id),
        node_id: Some(node.id.clone()),
        node_title: Some(node.title.clone()),
        question_ids: Vec::new(),
        concept_ids: node.concept_ids.clone(),
        title,
        estimated_minutes: NODE_MINUTES,
    }
}

fn practice_activity(model: &Model<'_>, activity: &PracticeActivity) -> SessionActivity {
    let domain_name = model.domain_name(&activity.domain_id);
    SessionActivity {
        kind: SessionActivityKind::Practice,
        domain_id: activity.domain_id.clone(),
        title: format!("Practice {domain_name}"),
        domain_name,
        node_id: None,
        node_title: None,
        question_ids: activity.question_ids.clone(),
        concept_ids: activity.concept_ids.clone(),
        estimated_minutes: (activity.question_ids.len() as u32) * QUESTION_MINUTES,
    }
}

/// Trims activities so the estimated total stays near the requested time.
fn trim_to_time(activities: Vec<SessionActivity>, available_minutes: u32) -> Vec<SessionActivity> {
    let mut kept: Vec<SessionActivity> = Vec::new();
    let mut total = 0u32;
    for activity in activities {
        if kept.len() >= MAX_ACTIVITIES {
            break;
        }
        if !kept.is_empty()
            && total + activity.estimated_minutes > available_minutes + TIME_SLACK_MINUTES
        {
            break;
        }
        total += activity.estimated_minutes;
        kept.push(activity);
    }
    kept
}

fn is_prerequisite_of_weak(model: &Model<'_>, node_id: &str) -> bool {
    model.input.nodes.iter().any(|candidate| {
        candidate
            .prerequisite_node_ids
            .iter()
            .any(|prerequisite| prerequisite == node_id)
            && model.node_has_weak(candidate)
            && model.node_accessible(candidate)
    })
}

fn to_candidate(question: &PlannerQuestion) -> Candidate {
    Candidate {
        id: question.id.clone(),
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: question.concepts.clone(),
        pedagogy: question.pedagogy.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adaptive_learn_domain::{
        AssessmentMode, ConceptWeight, InteractionType, PedagogyMetadata, PedagogyStage,
    };
    use chrono::{DateTime, TimeZone, Utc};

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn concept(concept_id: &str) -> ConceptWeight {
        ConceptWeight {
            concept_id: concept_id.to_owned(),
            weight: 1.0,
        }
    }

    fn domain(id: &str, weight: f64) -> super::super::PlannerDomain {
        super::super::PlannerDomain {
            id: id.to_owned(),
            name: format!("Domain {id}"),
            weight,
        }
    }

    fn node(
        id: &str,
        domain_id: &str,
        module_id: &str,
        concepts: &[&str],
    ) -> super::super::PlannerNode {
        super::super::PlannerNode {
            id: id.to_owned(),
            domain_id: domain_id.to_owned(),
            module_id: module_id.to_owned(),
            title: format!("Node {id}"),
            module_prerequisite_ids: Vec::new(),
            prerequisite_node_ids: Vec::new(),
            concept_ids: concepts.iter().map(|c| (*c).to_owned()).collect(),
        }
    }

    fn question(id: &str, domain_id: &str, concepts: &[&str]) -> super::super::PlannerQuestion {
        super::super::PlannerQuestion {
            id: id.to_owned(),
            domain_id: domain_id.to_owned(),
            task_id: format!("{domain_id}-task"),
            interaction_type: InteractionType::Ordering,
            assessment_mode: AssessmentMode::Application,
            difficulty_prior: 0.5,
            concepts: concepts.iter().map(|c| concept(c)).collect(),
            pedagogy: None,
        }
    }

    fn state(
        concept_id: &str,
        estimate: f64,
        mass: f64,
        last: DateTime<Utc>,
    ) -> super::super::ConceptStateView {
        super::super::ConceptStateView {
            concept_id: concept_id.to_owned(),
            assessment_mode: AssessmentMode::Application,
            estimate,
            evidence_mass: mass,
            exposure_count: 1,
            last_practiced_at: Some(last),
        }
    }

    fn session_input(
        domains: Vec<super::super::PlannerDomain>,
        nodes: Vec<super::super::PlannerNode>,
        questions: Vec<super::super::PlannerQuestion>,
        states: Vec<super::super::ConceptStateView>,
    ) -> SessionPlannerInput {
        SessionPlannerInput {
            planner: PlannerInput {
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
            },
            available_minutes: 20,
            preference: SessionPreference::Balanced,
            history: Vec::new(),
        }
    }

    fn kinds(session: &StudySession) -> Vec<SessionActivityKind> {
        session.activities.iter().map(|a| a.kind).collect()
    }

    #[test]
    fn weak_prerequisite_appears_before_dependent_practice() {
        let mut dependent = node("n-dependent", "d1", "m1", &["c.dependent"]);
        dependent.prerequisite_node_ids = vec!["n-prereq".to_owned()];
        let mut input = session_input(
            vec![domain("d1", 1.0)],
            vec![node("n-prereq", "d1", "m1", &["c.prereq"]), dependent],
            vec![question("q-dependent", "d1", &["c.dependent"])],
            vec![state("c.dependent", 0.2, 4.0, now())],
        );
        input.available_minutes = 20;

        let session = plan_session(&input).expect("session");
        let learn_index = session
            .activities
            .iter()
            .position(|a| a.node_id.as_deref() == Some("n-prereq"))
            .expect("prerequisite activity");
        let practice_index = session
            .activities
            .iter()
            .position(|a| a.kind == SessionActivityKind::Practice)
            .expect("practice activity");
        assert!(
            learn_index < practice_index,
            "prerequisite must come before dependent practice: {:?}",
            kinds(&session)
        );
    }

    #[test]
    fn weak_explored_concept_becomes_practice() {
        let input = session_input(
            vec![domain("d1", 1.0)],
            Vec::new(),
            vec![question("q1", "d1", &["c1"])],
            vec![state("c1", 0.2, 4.0, now())],
        );

        let session = plan_session(&input).expect("session");
        let practice = session
            .activities
            .iter()
            .find(|a| a.kind == SessionActivityKind::Practice)
            .expect("practice activity");
        assert_eq!(practice.question_ids, vec!["q1".to_owned()]);
    }

    #[test]
    fn stale_strong_concept_gets_review() {
        let input = session_input(
            vec![domain("d1", 1.0)],
            vec![node("n1", "d1", "m1", &["c1"])],
            Vec::new(),
            vec![state("c1", 0.95, 3.0, now() - chrono::Duration::days(60))],
        );

        let session = plan_session(&input).expect("session");
        let review = session
            .activities
            .iter()
            .find(|a| a.kind == SessionActivityKind::ReviewNode)
            .expect("review activity");
        assert_eq!(review.node_id.as_deref(), Some("n1"));
    }

    #[test]
    fn strong_fresh_concept_is_deprioritized() {
        let input = session_input(
            vec![domain("d1", 1.0)],
            vec![
                node("n-fresh", "d1", "m1", &["c.fresh"]),
                node("n-weak", "d1", "m1", &["c.weak"]),
            ],
            Vec::new(),
            vec![state("c.fresh", 0.95, 9.0, now())],
        );

        let session = plan_session(&input).expect("session");
        assert!(
            session
                .activities
                .iter()
                .any(|a| a.node_id.as_deref() == Some("n-weak")),
            "weak node should be planned: {:?}",
            kinds(&session)
        );
        assert!(
            !session
                .activities
                .iter()
                .any(|a| a.node_id.as_deref() == Some("n-fresh")),
            "strong, fresh node must not be planned: {:?}",
            kinds(&session)
        );
    }

    #[test]
    fn available_minutes_affects_plan_length() {
        let build = || {
            session_input(
                vec![domain("d1", 0.34), domain("d2", 0.33), domain("d3", 0.33)],
                vec![
                    node("n1", "d1", "m1", &["c1"]),
                    node("n2", "d2", "m1", &["c2"]),
                    node("n3", "d3", "m1", &["c3"]),
                ],
                vec![
                    question("q1", "d1", &["p1"]),
                    question("q2", "d2", &["p2"]),
                    question("q3", "d3", &["p3"]),
                ],
                vec![
                    state("p1", 0.2, 4.0, now()),
                    state("p2", 0.2, 4.0, now()),
                    state("p3", 0.2, 4.0, now()),
                ],
            )
        };

        let mut short = build();
        short.available_minutes = 10;
        let mut long = build();
        long.available_minutes = 60;

        let short = plan_session(&short).expect("short session");
        let long = plan_session(&long).expect("long session");
        assert!(
            long.estimated_minutes > short.estimated_minutes,
            "longer request should plan more time: {} vs {}",
            long.estimated_minutes,
            short.estimated_minutes
        );
        assert!(long.activities.len() >= short.activities.len());
    }

    #[test]
    fn preference_changes_session_composition() {
        let build = |preference: SessionPreference| {
            let mut input = session_input(
                vec![domain("d1", 0.34), domain("d2", 0.33), domain("d3", 0.33)],
                vec![
                    node("n1", "d1", "m1", &["c1"]),
                    node("n2", "d2", "m1", &["c2"]),
                    node("n3", "d3", "m1", &["c3"]),
                ],
                vec![
                    question("q1", "d1", &["p1"]),
                    question("q2", "d2", &["p2"]),
                    question("q3", "d3", &["p3"]),
                ],
                vec![
                    state("p1", 0.2, 4.0, now()),
                    state("p2", 0.2, 4.0, now()),
                    state("p3", 0.2, 4.0, now()),
                ],
            );
            input.available_minutes = 60;
            input.preference = preference;
            plan_session(&input).expect("session")
        };

        let count_practice = |session: &StudySession| {
            session
                .activities
                .iter()
                .filter(|a| a.kind == SessionActivityKind::Practice)
                .count()
        };
        let count_learning = |session: &StudySession| {
            session
                .activities
                .iter()
                .filter(|a| {
                    a.kind == SessionActivityKind::LearnNode
                        || a.kind == SessionActivityKind::ReviewNode
                })
                .count()
        };

        let balanced = build(SessionPreference::Balanced);
        let more_practice = build(SessionPreference::MorePractice);
        let more_learning = build(SessionPreference::MoreLearning);

        assert!(
            count_practice(&more_practice) > count_practice(&balanced),
            "more_practice should add retrieval"
        );
        assert!(
            count_learning(&more_learning) > count_learning(&balanced),
            "more_learning should add learning"
        );
        assert!(
            count_practice(&more_learning) < count_practice(&balanced),
            "more_learning should reduce retrieval"
        );
    }

    #[test]
    fn planning_is_deterministic() {
        let input = session_input(
            vec![domain("d1", 1.0)],
            vec![node("n1", "d1", "m1", &["c1"])],
            vec![question("q1", "d1", &["p1"])],
            vec![state("p1", 0.2, 4.0, now())],
        );
        let first = plan_session(&input).expect("session");
        for _ in 0..5 {
            assert_eq!(plan_session(&input).expect("session"), first);
        }
    }

    #[test]
    fn session_has_no_duplicate_targets() {
        let input = session_input(
            vec![domain("d1", 0.5), domain("d2", 0.5)],
            vec![
                node("n1", "d1", "m1", &["c1"]),
                node("n2", "d2", "m1", &["c2"]),
            ],
            vec![question("q1", "d1", &["p1"]), question("q2", "d2", &["p2"])],
            vec![state("p1", 0.2, 4.0, now()), state("p2", 0.2, 4.0, now())],
        );

        let session = plan_session(&input).expect("session");
        let mut nodes = HashSet::new();
        let mut questions = HashSet::new();
        for activity in &session.activities {
            if let Some(node_id) = &activity.node_id {
                assert!(nodes.insert(node_id.clone()), "duplicate node {node_id}");
            }
            for question_id in &activity.question_ids {
                assert!(
                    questions.insert(question_id.clone()),
                    "duplicate question {question_id}"
                );
            }
        }
    }

    #[test]
    fn practice_groups_related_questions_and_uses_server_content() {
        let input = session_input(
            vec![domain("d1", 1.0)],
            Vec::new(),
            vec![
                question("q1", "d1", &["shared"]),
                question("q2", "d1", &["shared"]),
                question("q3", "d1", &["shared"]),
                question("q-unrelated", "d1", &["other"]),
            ],
            vec![state("shared", 0.2, 4.0, now())],
        );

        let session = plan_session(&input).expect("session");
        let practice = session
            .activities
            .iter()
            .find(|a| a.kind == SessionActivityKind::Practice)
            .expect("practice activity");
        assert!(
            practice.question_ids.len() >= 2,
            "related questions should be grouped: {:?}",
            practice.question_ids
        );
        let known: HashSet<&str> = input
            .planner
            .questions
            .iter()
            .map(|question| question.id.as_str())
            .collect();
        for question_id in &practice.question_ids {
            assert!(
                known.contains(question_id.as_str()),
                "question must come from server content"
            );
        }
    }

    #[test]
    fn empty_track_has_no_session() {
        let input = session_input(Vec::new(), Vec::new(), Vec::new(), Vec::new());
        assert!(plan_session(&input).is_none());
    }

    #[test]
    fn non_certification_track_plans_the_same_way() {
        let mut input = session_input(
            vec![domain("topic-1", 1.0)],
            vec![node("n1", "topic-1", "m1", &["python.comprehensions"])],
            Vec::new(),
            Vec::new(),
        );
        input.planner.track_id = "ai-python-fluency".to_owned();

        let session = plan_session(&input).expect("session");
        assert_eq!(session.track_id, "ai-python-fluency");
        assert!(!session.activities.is_empty());
    }

    #[test]
    fn planner_candidate_carries_pedagogy_metadata() {
        // Phase 1 plumbing only: the metadata must survive the
        // `PlannerQuestion -> Candidate` projection so future selector code can
        // read it. No ranking behavior is asserted or changed here.
        let mut planner_question = question("q1", "d1", &["c1"]);
        planner_question.pedagogy = Some(PedagogyMetadata {
            family_id: Some("python.async.task_lifecycle".to_owned()),
            stage: Some(PedagogyStage::Trace),
            scaffold_level: Some(1),
            transfer_group_id: Some("async_cancellation".to_owned()),
            surface_context: Some("background_worker".to_owned()),
            challenge_group_id: None,
        });

        let candidate = to_candidate(&planner_question);
        assert_eq!(candidate.pedagogy, planner_question.pedagogy);
    }
}
