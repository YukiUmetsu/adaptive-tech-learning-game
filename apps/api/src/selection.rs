//! Server-side question selection for the quiz modes.
//!
//! There is no trained student model yet, so this is an intentionally simple,
//! explainable heuristic that can be replaced later. It is deterministic:
//! ties break by question id, so selection is testable.
//!
//! Primary adaptation signal is the derived per-concept state produced by the
//! `heuristic-v1` model. Selection reads it alongside accepted history:
//!
//! - concept estimate and uncertainty from evidence mass,
//! - forgetting risk computed on read (never by mutating state over time),
//! - authored concept weights (never reduced to ids),
//! - domain weight, difficulty fit, novelty, and an immediate-repeat penalty.
//!
//! A learner with no derived state (cold start, or events that predate the
//! cache) falls back to accepted history, then to the neutral prior.
//!
//! Candidate concepts use the same concept ids as `KnowledgeNode::concept_ids`,
//! so later remediation work can join the two and prefer prerequisite concepts
//! without changing this module's contract.
//!
//! The three learner-facing modes:
//! - `quick_adaptive`: a short cross-domain set with broad coverage.
//! - `domain_quiz`: one domain, spread across its tasks.
//! - `full_practice`: a weighted, full-length certification challenge.

use std::collections::{HashMap, HashSet};

use adaptive_learn_domain::{
    AssessmentMode, ConceptWeight, InteractionType, PRIOR_ESTIMATE, PedagogyMetadata, QuizMode,
    retrievability, uncertainty,
};
use chrono::{DateTime, Utc};

/// Questions in a Quick Quiz.
pub const QUICK_QUIZ_LEN: usize = 3;
/// Questions in a Domain Quiz when the domain has enough content.
pub const DOMAIN_QUIZ_LEN: usize = 20;
/// Questions in a Full Practice set.
pub const FULL_PRACTICE_LEN: usize = 65;
/// Questions in a focused recommended-practice set (anchor + related).
pub const RECOMMENDED_PRACTICE_LEN: usize = 5;
/// Questions in a section quiz: exactly one, so a section ends with a single
/// retrieval check rather than a full practice set.
pub const SECTION_QUIZ_LEN: usize = 1;
/// How many recent events are treated as "just practiced".
const RECENT_WINDOW: usize = 12;
/// Immediate-repeat penalty subtracted from a candidate's rank.
const REPEAT_PENALTY: f64 = 0.75;
/// Number of days after which a practice is treated as fully stale.
const RECENCY_WINDOW_DAYS: f64 = 7.0;

/// Weight of concept weakness in the rank. Higher means "practice what is weak".
const WEIGHT_WEAKNESS: f64 = 0.32;
/// Weight of computed forgetting risk.
const WEIGHT_FORGETTING: f64 = 0.20;
/// Weight of the official domain/objective weight.
const WEIGHT_DOMAIN: f64 = 0.16;
/// Weight of estimate uncertainty (information gain).
const WEIGHT_UNCERTAINTY: f64 = 0.10;
/// Weight of difficulty fit for the learner's current estimate.
const WEIGHT_DIFFICULTY_FIT: f64 = 0.12;
/// Weight of never-seen questions.
const WEIGHT_NOVELTY: f64 = 0.10;

/// A question considered for selection, decoupled from content internals.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Question id.
    pub id: String,
    /// Owning domain.
    pub domain_id: String,
    /// Owning task.
    pub task_id: String,
    /// Interaction family.
    pub interaction_type: InteractionType,
    /// Assessment/evidence mode.
    pub assessment_mode: AssessmentMode,
    /// Prior difficulty in `[0, 1]`.
    pub difficulty_prior: f64,
    /// Authored concept mappings with their evidence weights.
    pub concepts: Vec<ConceptWeight>,
    /// Optional authored pedagogical metadata.
    ///
    /// Descriptive in Phase 1: selection ranking does not read it yet. It is
    /// carried so future scaffold fading, transfer-aware selection, and
    /// challenge sequencing can use it without another content-schema change.
    pub pedagogy: Option<PedagogyMetadata>,
}

/// One recent accepted attempt, used for novelty and cold-start fallback.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryEntry {
    /// Question that was answered.
    pub question_id: String,
    /// Accepted partial score in `[0, 1]`.
    pub score: f64,
    /// Evidence mode the attempt was collected in.
    pub assessment_mode: AssessmentMode,
    /// When the attempt occurred.
    pub occurred_at: DateTime<Utc>,
    /// Authored concept mappings with their evidence weights.
    pub concepts: Vec<ConceptWeight>,
}

/// One derived concept-state row, reduced to what selection needs.
#[derive(Debug, Clone, PartialEq)]
pub struct ConceptEvidence {
    /// Concept identifier.
    pub concept_id: String,
    /// Evidence mode the estimate measures.
    pub assessment_mode: AssessmentMode,
    /// Current estimate in `[0, 1]`.
    pub estimate: f64,
    /// Accumulated evidence mass; more mass decays more slowly.
    pub evidence_mass: f64,
    /// Most recent observation time.
    pub last_practiced_at: Option<DateTime<Utc>>,
}

/// Server policy for how many questions a mode requests.
pub const fn target_len(mode: QuizMode) -> usize {
    match mode {
        QuizMode::QuickAdaptive => QUICK_QUIZ_LEN,
        QuizMode::DomainQuiz => DOMAIN_QUIZ_LEN,
        QuizMode::FullPractice => FULL_PRACTICE_LEN,
        QuizMode::TaskPractice => 0,
        QuizMode::RecommendedPractice => RECOMMENDED_PRACTICE_LEN,
        QuizMode::SectionQuiz => SECTION_QUIZ_LEN,
    }
}

/// Aggregated state for one candidate across its authored concepts.
#[derive(Debug, Clone, Copy)]
struct Signal {
    estimate: f64,
    uncertainty: f64,
    forgetting_risk: f64,
}

impl Signal {
    const NEUTRAL: Signal = Signal {
        estimate: PRIOR_ESTIMATE,
        uncertainty: 1.0,
        forgetting_risk: 0.0,
    };
}

/// Summarizes recent history for ranking.
#[derive(Debug, Default)]
struct RecentHistory {
    /// Newest score/time per question, plus its recency index (0 = newest event).
    by_question: HashMap<String, (f64, DateTime<Utc>, usize)>,
    /// Newest score/time per `(concept, assessment mode)`.
    by_concept: HashMap<(String, AssessmentMode), (f64, DateTime<Utc>)>,
    /// Distinct question ids seen in the most recent window.
    recently_practiced: HashSet<String>,
}

impl RecentHistory {
    fn build(history: &[HistoryEntry]) -> Self {
        let mut summary = RecentHistory::default();
        let mut window: HashSet<String> = HashSet::new();

        for (index, entry) in history.iter().enumerate() {
            summary
                .by_question
                .entry(entry.question_id.clone())
                .or_insert((entry.score, entry.occurred_at, index));
            for concept in &entry.concepts {
                summary
                    .by_concept
                    .entry((concept.concept_id.clone(), entry.assessment_mode))
                    .or_insert((entry.score, entry.occurred_at));
            }
            if window.len() < RECENT_WINDOW || window.contains(&entry.question_id) {
                window.insert(entry.question_id.clone());
            }
        }

        summary.recently_practiced = window;
        summary
    }
}

/// Estimates how stale a practice time is, in `[0, 1]`.
fn recency(at: DateTime<Utc>, now: DateTime<Utc>) -> f64 {
    let days = (now - at).num_hours() as f64 / 24.0;
    (days / RECENCY_WINDOW_DAYS).clamp(0.0, 1.0)
}

impl RecentHistory {
    /// Derived state first, accepted history as a cold-start fallback, then the
    /// neutral prior.
    fn signal(
        &self,
        concept: &ConceptWeight,
        mode: AssessmentMode,
        states: &HashMap<(String, AssessmentMode), ConceptEvidence>,
        now: DateTime<Utc>,
    ) -> Signal {
        let key = (concept.concept_id.clone(), mode);
        if let Some(state) = states.get(&key) {
            let estimate = state.estimate.clamp(0.0, 1.0);
            let retrieval = retrievability(state.evidence_mass, state.last_practiced_at, now);
            return Signal {
                estimate,
                uncertainty: uncertainty(state.evidence_mass),
                forgetting_risk: (estimate * (1.0 - retrieval)).clamp(0.0, 1.0),
            };
        }

        // Cold-start fallback: an accepted score is a weak estimate, and an old
        // score is treated as more likely forgotten.
        if let Some((score, at)) = self.by_concept.get(&key) {
            let estimate = score.clamp(0.0, 1.0);
            return Signal {
                estimate,
                uncertainty: 1.0,
                forgetting_risk: (estimate * recency(*at, now)).clamp(0.0, 1.0),
            };
        }

        Signal::NEUTRAL
    }

    /// Weighted aggregate of a candidate's concepts, honoring authored weights.
    fn aggregate(
        &self,
        candidate: &Candidate,
        states: &HashMap<(String, AssessmentMode), ConceptEvidence>,
        now: DateTime<Utc>,
    ) -> Signal {
        let mut weight_sum = 0.0;
        let mut estimate = 0.0;
        let mut uncertainty = 0.0;
        let mut forgetting_risk = 0.0;

        for concept in &candidate.concepts {
            let weight = concept.weight.clamp(0.0, 1.0);
            if weight <= 0.0 {
                continue;
            }
            let signal = self.signal(concept, candidate.assessment_mode, states, now);
            weight_sum += weight;
            estimate += weight * signal.estimate;
            uncertainty += weight * signal.uncertainty;
            forgetting_risk += weight * signal.forgetting_risk;
        }

        if weight_sum <= 0.0 {
            return Signal::NEUTRAL;
        }
        Signal {
            estimate: estimate / weight_sum,
            uncertainty: uncertainty / weight_sum,
            forgetting_risk: forgetting_risk / weight_sum,
        }
    }
}

/// Ranks one candidate. Higher is more useful to practice now.
fn rank(
    candidate: &Candidate,
    history: &RecentHistory,
    states: &HashMap<(String, AssessmentMode), ConceptEvidence>,
    domain_weight: f64,
    now: DateTime<Utc>,
) -> f64 {
    let signal = history.aggregate(candidate, states, now);
    let weakness = 1.0 - signal.estimate;
    // Weak concepts tend toward easier suitable questions, strong concepts may
    // get harder ones: fit peaks when difficulty matches the current estimate.
    let difficulty = candidate.difficulty_prior.clamp(0.0, 1.0);
    let difficulty_fit = 1.0 - (difficulty - signal.estimate).abs();
    let novelty = if history.by_question.contains_key(&candidate.id) {
        0.0
    } else {
        1.0
    };
    let repeat_penalty = if history.recently_practiced.contains(&candidate.id) {
        REPEAT_PENALTY
    } else {
        0.0
    };

    WEIGHT_WEAKNESS * weakness
        + WEIGHT_FORGETTING * signal.forgetting_risk
        + WEIGHT_DOMAIN * domain_weight.clamp(0.0, 1.0)
        + WEIGHT_UNCERTAINTY * signal.uncertainty
        + WEIGHT_DIFFICULTY_FIT * difficulty_fit
        + WEIGHT_NOVELTY * novelty
        - repeat_penalty
}

/// Orders candidates best-first with a stable question-id tie-break.
fn ordered<'a>(
    candidates: &'a [Candidate],
    history: &RecentHistory,
    states: &HashMap<(String, AssessmentMode), ConceptEvidence>,
    weights: &HashMap<&str, f64>,
    now: DateTime<Utc>,
) -> Vec<&'a Candidate> {
    let mut ranked: Vec<&Candidate> = candidates.iter().collect();
    ranked.sort_by(|a, b| {
        let wa = weights.get(a.domain_id.as_str()).copied().unwrap_or(0.0);
        let wb = weights.get(b.domain_id.as_str()).copied().unwrap_or(0.0);
        let ra = rank(a, history, states, wa, now);
        let rb = rank(b, history, states, wb, now);
        rb.partial_cmp(&ra)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    ranked
}

/// Deterministic largest-remainder allocation across weighted domains.
///
/// Domains capped by their available capacity give their deficit back, which is
/// then redistributed to domains that still have room.
pub fn allocate(
    total: usize,
    weights: &[(String, f64)],
    capacity: &HashMap<String, usize>,
) -> Vec<(String, usize)> {
    let mut assigned: HashMap<&str, usize> = HashMap::new();
    let mut fractions: HashMap<&str, f64> = HashMap::new();
    let mut remaining = total;

    for (id, weight) in weights {
        let cap = capacity.get(id).copied().unwrap_or(0);
        let ideal = total as f64 * weight.clamp(0.0, 1.0);
        let base = ideal.floor() as usize;
        let take = base.min(cap);
        assigned.insert(id.as_str(), take);
        fractions.insert(id.as_str(), ideal - base as f64);
        remaining -= take;
    }

    while remaining > 0 {
        let mut order: Vec<(&str, f64, f64)> = weights
            .iter()
            .filter_map(|(id, weight)| {
                let cap = capacity.get(id).copied().unwrap_or(0);
                let used = assigned.get(id.as_str()).copied().unwrap_or(0);
                (used < cap).then_some((
                    id.as_str(),
                    fractions.get(id.as_str()).copied().unwrap_or(0.0),
                    *weight,
                ))
            })
            .collect();
        order.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
                .then_with(|| a.0.cmp(b.0))
        });

        let mut progressed = false;
        for (id, _, _) in order {
            if remaining == 0 {
                break;
            }
            let cap = capacity.get(id).copied().unwrap_or(0);
            let used = assigned.get(id).copied().unwrap_or(0);
            if used < cap {
                assigned.insert(id, used + 1);
                remaining -= 1;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }

    weights
        .iter()
        .map(|(id, _)| (id.clone(), assigned.get(id.as_str()).copied().unwrap_or(0)))
        .collect()
}

struct Selector {
    selected: Vec<String>,
    used_questions: HashSet<String>,
    used_interactions: HashSet<InteractionType>,
    used_tasks: HashSet<String>,
}

impl Selector {
    fn new() -> Self {
        Self {
            selected: Vec::new(),
            used_questions: HashSet::new(),
            used_interactions: HashSet::new(),
            used_tasks: HashSet::new(),
        }
    }

    fn push(&mut self, candidate: &Candidate) {
        self.selected.push(candidate.id.clone());
        self.used_questions.insert(candidate.id.clone());
        self.used_interactions.insert(candidate.interaction_type);
        self.used_tasks.insert(candidate.task_id.clone());
    }

    fn is_full(&self, target: usize) -> bool {
        self.selected.len() >= target
    }

    /// Prefer new interaction families first, then anything better-ranked.
    fn fill_variety(&mut self, ordered: &[&Candidate], target: usize) {
        for candidate in ordered {
            if self.is_full(target) {
                return;
            }
            if self.used_questions.contains(&candidate.id)
                || self.used_interactions.contains(&candidate.interaction_type)
            {
                continue;
            }
            self.push(candidate);
        }
        for candidate in ordered {
            if self.is_full(target) {
                return;
            }
            if self.used_questions.contains(&candidate.id) {
                continue;
            }
            self.push(candidate);
        }
    }

    /// Prefer unseen tasks first, then fill by rank.
    fn fill_task_spread(&mut self, ordered: &[&Candidate], target: usize) {
        for candidate in ordered {
            if self.is_full(target) {
                return;
            }
            if self.used_questions.contains(&candidate.id)
                || self.used_tasks.contains(&candidate.task_id)
            {
                continue;
            }
            self.push(candidate);
        }
        self.fill_variety(ordered, target);
    }
}

/// Selects question ids for a mode.
///
/// `domains` is the certification's `(domain_id, weight)` in authored order.
/// `states` is the learner's derived concept state; it may be empty for a cold
/// start. `domain_filter` scopes domain quizzes. Returns at most
/// `target_len(mode)` unique ids; fewer when content is short.
pub fn select(
    candidates: &[Candidate],
    domains: &[(String, f64)],
    history: &[HistoryEntry],
    states: &[ConceptEvidence],
    mode: QuizMode,
    domain_filter: Option<&str>,
    now: DateTime<Utc>,
) -> Vec<String> {
    let target = target_len(mode);
    if target == 0 || candidates.is_empty() {
        return Vec::new();
    }

    let summary = RecentHistory::build(history);
    let state_map: HashMap<(String, AssessmentMode), ConceptEvidence> = states
        .iter()
        .map(|state| {
            (
                (state.concept_id.clone(), state.assessment_mode),
                state.clone(),
            )
        })
        .collect();
    let weights: HashMap<&str, f64> = domains
        .iter()
        .map(|(id, weight)| (id.as_str(), *weight))
        .collect();
    let ranked = ordered(candidates, &summary, &state_map, &weights, now);

    match mode {
        QuizMode::DomainQuiz => {
            let scoped: Vec<&Candidate> = ranked
                .into_iter()
                .filter(|candidate| Some(candidate.domain_id.as_str()) == domain_filter)
                .collect();
            let mut selector = Selector::new();
            selector.fill_task_spread(&scoped, target);
            selector.selected
        }
        QuizMode::QuickAdaptive => {
            let mut selector = Selector::new();
            // 1) Broad coverage: best candidate from each domain, by weight.
            let mut by_weight = domains.to_vec();
            by_weight.sort_by(|a, b| {
                b.1.partial_cmp(&a.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.0.cmp(&b.0))
            });
            for (domain_id, _) in by_weight {
                if selector.is_full(target) {
                    break;
                }
                if selector.selected.iter().any(|id| {
                    ranked
                        .iter()
                        .any(|c| &c.id == id && c.domain_id == domain_id)
                }) {
                    continue;
                }
                if let Some(best) = ranked
                    .iter()
                    .find(|candidate| candidate.domain_id == domain_id)
                {
                    selector.push(best);
                }
            }
            // 2) Fill the rest adaptively with interaction variety.
            selector.fill_variety(&ranked, target);
            selector.selected
        }
        QuizMode::FullPractice => {
            let mut capacity: HashMap<String, usize> = HashMap::new();
            for candidate in candidates {
                *capacity.entry(candidate.domain_id.clone()).or_insert(0) += 1;
            }
            let allocation = allocate(target, domains, &capacity);
            let mut per_domain: Vec<(String, Vec<String>)> = Vec::new();
            let mut used = HashSet::new();
            for (domain_id, count) in allocation {
                if count == 0 {
                    continue;
                }
                let scoped: Vec<&Candidate> = ranked
                    .iter()
                    .copied()
                    .filter(|candidate| candidate.domain_id == domain_id)
                    .collect();
                let mut selector = Selector::new();
                // Seed shared state so cross-domain duplicates cannot occur.
                selector.used_questions = used.clone();
                selector.fill_task_spread(&scoped, count);
                for id in &selector.selected {
                    used.insert(id.clone());
                }
                per_domain.push((domain_id, selector.selected));
            }
            interleave(per_domain)
        }
        QuizMode::TaskPractice => Vec::new(),
        // Section quiz candidates are already scoped to the module by the
        // caller and chosen by `section_quiz`, not by the general selector.
        QuizMode::SectionQuiz => Vec::new(),
        // Recommended practice is anchored on a specific question and built by
        // `recommended_practice`, not by the general selector.
        QuizMode::RecommendedPractice => Vec::new(),
    }
}

/// Round-robins domain selections so a full practice set is not grouped by domain.
fn interleave(per_domain: Vec<(String, Vec<String>)>) -> Vec<String> {
    let mut result = Vec::new();
    let mut index = 0;
    loop {
        let mut added = false;
        for (_, ids) in &per_domain {
            if let Some(id) = ids.get(index) {
                result.push(id.clone());
                added = true;
            }
        }
        if !added {
            break;
        }
        index += 1;
    }
    result
}

/// Builds a focused set anchored on a recommended question.
///
/// The anchor is always first. Related questions are chosen server-side from
/// authored concept overlap (highest overlap first), with a small same-mode
/// bonus and a penalty for recently practiced questions, then a stable
/// question-id tie-break. The learner never supplies the related ids; only the
/// anchor is validated by the caller.
pub fn recommended_practice(
    anchor: &Candidate,
    candidates: &[Candidate],
    history: &[HistoryEntry],
    target: usize,
) -> Vec<String> {
    let mut selected = vec![anchor.id.clone()];
    if target <= 1 {
        return selected;
    }

    let summary = RecentHistory::build(history);
    let anchor_concepts: HashSet<&str> = anchor
        .concepts
        .iter()
        .map(|concept| concept.concept_id.as_str())
        .collect();

    let mut related: Vec<(&Candidate, f64)> = candidates
        .iter()
        .filter(|candidate| candidate.id != anchor.id)
        .filter_map(|candidate| {
            let shared: f64 = candidate
                .concepts
                .iter()
                .filter(|concept| anchor_concepts.contains(concept.concept_id.as_str()))
                .map(|concept| concept.weight.clamp(0.0, 1.0))
                .sum();
            if shared <= 0.0 {
                return None;
            }
            let mode_bonus = if candidate.assessment_mode == anchor.assessment_mode {
                0.1
            } else {
                0.0
            };
            let repeat = if summary.recently_practiced.contains(&candidate.id) {
                REPEAT_PENALTY
            } else {
                0.0
            };
            Some((candidate, shared + mode_bonus - repeat))
        })
        .collect();

    related.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.id.cmp(&b.0.id))
    });

    for (candidate, _) in related {
        if selected.len() >= target {
            break;
        }
        selected.push(candidate.id.clone());
    }

    selected
}

/// Chooses the single best question for a section (module) quiz.
///
/// Candidates are already scoped to the section by the caller. Ranking reuses
/// the same adaptive signal as every other mode (weakness, forgetting risk,
/// difficulty fit, novelty, and a repeat penalty), so the section quiz favors
/// what the learner is most likely to need. Returns at most
/// [`SECTION_QUIZ_LEN`] ids; empty when the section has no questions.
pub fn section_quiz(
    candidates: &[Candidate],
    domains: &[(String, f64)],
    history: &[HistoryEntry],
    states: &[ConceptEvidence],
    now: DateTime<Utc>,
) -> Vec<String> {
    if candidates.is_empty() {
        return Vec::new();
    }

    let summary = RecentHistory::build(history);
    let state_map: HashMap<(String, AssessmentMode), ConceptEvidence> = states
        .iter()
        .map(|state| {
            (
                (state.concept_id.clone(), state.assessment_mode),
                state.clone(),
            )
        })
        .collect();
    let weights: HashMap<&str, f64> = domains
        .iter()
        .map(|(id, weight)| (id.as_str(), *weight))
        .collect();

    ordered(candidates, &summary, &state_map, &weights, now)
        .into_iter()
        .take(SECTION_QUIZ_LEN)
        .map(|candidate| candidate.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).unwrap()
    }

    fn concept(id: &str) -> ConceptWeight {
        ConceptWeight {
            concept_id: id.to_owned(),
            weight: 1.0,
        }
    }

    fn candidate(
        id: &str,
        domain: &str,
        task: &str,
        interaction: InteractionType,
        concept_id: &str,
    ) -> Candidate {
        Candidate {
            id: id.to_owned(),
            domain_id: domain.to_owned(),
            task_id: task.to_owned(),
            interaction_type: interaction,
            assessment_mode: AssessmentMode::Application,
            difficulty_prior: 0.5,
            concepts: vec![concept(concept_id)],
            pedagogy: None,
        }
    }

    fn domains() -> Vec<(String, f64)> {
        vec![
            ("d1".to_owned(), 0.22),
            ("d2".to_owned(), 0.22),
            ("d3".to_owned(), 0.22),
            ("d4".to_owned(), 0.16),
            ("d5".to_owned(), 0.18),
        ]
    }

    fn corpus(per_domain: usize) -> Vec<Candidate> {
        let interactions = [
            InteractionType::Classification,
            InteractionType::Ordering,
            InteractionType::Reconstruction,
        ];
        let mut candidates = Vec::new();
        for (d, domain) in ["d1", "d2", "d3", "d4", "d5"].iter().enumerate() {
            for i in 0..per_domain {
                candidates.push(candidate(
                    &format!("{domain}-q{i}"),
                    domain,
                    &format!("{domain}-t{}", i % 3),
                    interactions[(d + i) % interactions.len()],
                    &format!("{domain}.concept{}", i % 4),
                ));
            }
        }
        candidates
    }

    fn evidence(concept_id: &str, estimate: f64, mass: f64, at: DateTime<Utc>) -> ConceptEvidence {
        ConceptEvidence {
            concept_id: concept_id.to_owned(),
            assessment_mode: AssessmentMode::Application,
            estimate,
            evidence_mass: mass,
            last_practiced_at: Some(at),
        }
    }

    #[test]
    fn section_quiz_returns_exactly_one_best_question() {
        let candidates = vec![
            candidate(
                "s-strong",
                "d1",
                "t1",
                InteractionType::Ordering,
                "c-strong",
            ),
            candidate("s-weak", "d1", "t1", InteractionType::Ordering, "c-weak"),
        ];
        // The learner is strong on `c-strong` and weak on `c-weak`, so the weak
        // concept's question is the better single retrieval check.
        let states = vec![
            evidence("c-strong", 0.95, 5.0, now()),
            evidence("c-weak", 0.05, 5.0, now()),
        ];

        let selected = section_quiz(&candidates, &[("d1".to_owned(), 1.0)], &[], &states, now());

        assert_eq!(selected, vec!["s-weak".to_owned()]);
    }

    #[test]
    fn section_quiz_is_empty_without_questions() {
        let selected = section_quiz(&[], &[("d1".to_owned(), 1.0)], &[], &[], now());
        assert!(selected.is_empty());
    }

    #[test]
    fn quick_quiz_is_short_and_covers_top_domains() {
        let selected = select(
            &corpus(8),
            &domains(),
            &[],
            &[],
            QuizMode::QuickAdaptive,
            None,
            now(),
        );
        assert_eq!(selected.len(), QUICK_QUIZ_LEN);
        let mut domains_covered: HashSet<&str> = HashSet::new();
        for id in &selected {
            domains_covered.insert(id.split('-').next().unwrap());
        }
        // Three questions cover three distinct domains (broad but short).
        assert_eq!(domains_covered.len(), QUICK_QUIZ_LEN);
        assert_eq!(
            selected.iter().collect::<HashSet<_>>().len(),
            selected.len()
        );
    }

    #[test]
    fn quick_quiz_avoids_recent_repeats_when_alternatives_exist() {
        let corpus = corpus(8);
        // Everything in d1 was just practiced.
        let history: Vec<HistoryEntry> = corpus
            .iter()
            .filter(|c| c.domain_id == "d1")
            .map(|c| HistoryEntry {
                question_id: c.id.clone(),
                score: 0.0,
                assessment_mode: c.assessment_mode,
                occurred_at: now(),
                concepts: c.concepts.clone(),
            })
            .collect();

        let selected = select(
            &corpus,
            &domains(),
            &history,
            &[],
            QuizMode::QuickAdaptive,
            None,
            now(),
        );
        assert_eq!(selected.len(), QUICK_QUIZ_LEN);
        // d1 still gets one coverage slot, but the rest avoids the recent set.
        let d1_count = selected.iter().filter(|id| id.starts_with("d1-")).count();
        assert!(d1_count <= 2, "unexpected d1 repeats: {selected:?}");
    }

    #[test]
    fn weak_history_lifts_a_question_on_cold_start() {
        let corpus = corpus(8);
        // A stale, weak concept lifts d1-q0 (without marking the question itself
        // as a recent repeat).
        let history = vec![HistoryEntry {
            question_id: "d1-other".to_owned(),
            score: 0.0,
            assessment_mode: AssessmentMode::Application,
            occurred_at: now() - chrono::Duration::days(30),
            concepts: vec![concept("d1.concept0")],
        }];

        let d1: Vec<Candidate> = corpus.into_iter().filter(|c| c.domain_id == "d1").collect();
        let selected = select(
            &d1,
            &[("d1".to_owned(), 1.0)],
            &history,
            &[],
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert!(!selected.is_empty());
        assert!(
            selected.iter().take(2).any(|id| id == "d1-q0"),
            "weak question not prioritised: {selected:?}"
        );
    }

    #[test]
    fn concept_state_lifts_a_weak_concept() {
        let corpus = corpus(8);
        // Derived state says concept0 is weak; the fallback history is silent.
        let states = vec![evidence("d1.concept0", 0.1, 4.0, now())];

        let d1: Vec<Candidate> = corpus.into_iter().filter(|c| c.domain_id == "d1").collect();
        let selected = select(
            &d1,
            &[("d1".to_owned(), 1.0)],
            &[],
            &states,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert!(
            selected.iter().take(2).any(|id| id == "d1-q0"),
            "weak concept state was not prioritised: {selected:?}"
        );
    }

    #[test]
    fn adaptive_selection_uses_authored_concept_weights() {
        // Two questions in one domain. The first maps a weak concept at full
        // weight; the second maps the same weak concept at a tiny weight plus a
        // strong concept. The heavy mapping must rank higher.
        let weak = ConceptWeight {
            concept_id: "d1.weak".to_owned(),
            weight: 1.0,
        };
        let light = ConceptWeight {
            concept_id: "d1.weak".to_owned(),
            weight: 0.05,
        };
        let strong = ConceptWeight {
            concept_id: "d1.strong".to_owned(),
            weight: 0.95,
        };
        let mut heavy = candidate("d1-heavy", "d1", "d1-t0", InteractionType::Ordering, "x");
        heavy.concepts = vec![weak];
        let mut mixed = candidate("d1-mixed", "d1", "d1-t1", InteractionType::Ordering, "x");
        mixed.concepts = vec![light, strong];

        let states = vec![
            evidence("d1.weak", 0.05, 4.0, now()),
            evidence("d1.strong", 0.98, 8.0, now()),
        ];
        let selected = select(
            &[heavy, mixed],
            &[("d1".to_owned(), 1.0)],
            &[],
            &states,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert_eq!(selected.first().map(String::as_str), Some("d1-heavy"));
    }

    #[test]
    fn difficulty_fit_prefers_easier_for_weak_learners() {
        let mut easy = candidate(
            "d1-easy",
            "d1",
            "d1-t0",
            InteractionType::Ordering,
            "d1.concept0",
        );
        easy.difficulty_prior = 0.1;
        let mut hard = candidate(
            "d1-hard",
            "d1",
            "d1-t1",
            InteractionType::Ordering,
            "d1.concept0",
        );
        hard.difficulty_prior = 0.9;

        let weak = vec![evidence("d1.concept0", 0.1, 4.0, now())];
        let selected = select(
            &[hard.clone(), easy.clone()],
            &[("d1".to_owned(), 1.0)],
            &[],
            &weak,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-easy"),
            "a weak learner should receive the easier item: {selected:?}"
        );

        let strong = vec![evidence("d1.concept0", 0.95, 8.0, now())];
        let selected = select(
            &[easy, hard],
            &[("d1".to_owned(), 1.0)],
            &[],
            &strong,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-hard"),
            "a strong learner may receive the harder item: {selected:?}"
        );
    }

    #[test]
    fn stale_strong_state_ranks_above_fresh_strong_state() {
        let stale = candidate(
            "d1-a",
            "d1",
            "d1-t0",
            InteractionType::Ordering,
            "d1.concept0",
        );
        let fresh = candidate(
            "d1-b",
            "d1",
            "d1-t1",
            InteractionType::Ordering,
            "d1.concept1",
        );
        let states = vec![
            evidence("d1.concept0", 0.9, 8.0, now() - chrono::Duration::days(60)),
            evidence("d1.concept1", 0.9, 8.0, now()),
        ];
        let selected = select(
            &[fresh, stale],
            &[("d1".to_owned(), 1.0)],
            &[],
            &states,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-a"),
            "a stale but strong concept should be revisited: {selected:?}"
        );
    }

    #[test]
    fn cold_start_selects_without_any_state_or_history() {
        let selected = select(
            &corpus(4),
            &domains(),
            &[],
            &[],
            QuizMode::FullPractice,
            None,
            now(),
        );
        assert_eq!(selected.len(), 20);
        assert_eq!(
            selected.iter().collect::<HashSet<_>>().len(),
            selected.len()
        );
    }

    #[test]
    fn domain_quiz_is_scoped_and_spreads_tasks() {
        let selected = select(
            &corpus(30),
            &domains(),
            &[],
            &[],
            QuizMode::DomainQuiz,
            Some("d3"),
            now(),
        );
        assert_eq!(selected.len(), DOMAIN_QUIZ_LEN);
        assert!(selected.iter().all(|id| id.starts_with("d3-")));
        let tasks: HashSet<&str> = selected
            .iter()
            .map(|id| id.split('-').nth(1).unwrap())
            .collect();
        assert!(tasks.len() >= 3, "expected multiple tasks: {tasks:?}");
    }

    #[test]
    fn full_practice_hits_the_target_and_respects_weights() {
        let selected = select(
            &corpus(20),
            &domains(),
            &[],
            &[],
            QuizMode::FullPractice,
            None,
            now(),
        );
        assert_eq!(selected.len(), FULL_PRACTICE_LEN);
        assert_eq!(
            selected.iter().collect::<HashSet<_>>().len(),
            selected.len(),
            "no duplicate question ids"
        );

        let mut counts: HashMap<&str, usize> = HashMap::new();
        for id in &selected {
            *counts.entry(id.split('-').next().unwrap()).or_insert(0) += 1;
        }
        assert!(counts["d1"] >= 12 && counts["d1"] <= 16, "{counts:?}");
        assert!(counts["d4"] >= 8 && counts["d4"] <= 13, "{counts:?}");
    }

    #[test]
    fn allocation_redistributes_when_a_domain_is_short() {
        let weights = domains();
        let capacity = HashMap::from([
            ("d1".to_owned(), 2), // short
            ("d2".to_owned(), 100),
            ("d3".to_owned(), 100),
            ("d4".to_owned(), 100),
            ("d5".to_owned(), 100),
        ]);
        let allocation = allocate(65, &weights, &capacity);
        let total: usize = allocation.iter().map(|(_, n)| n).sum();
        assert_eq!(total, 65);
        let d1 = allocation.iter().find(|(id, _)| id == "d1").unwrap().1;
        assert_eq!(d1, 2);
    }

    #[test]
    fn full_practice_returns_fewer_when_content_is_short() {
        let selected = select(
            &corpus(2),
            &domains(),
            &[],
            &[],
            QuizMode::FullPractice,
            None,
            now(),
        );
        assert_eq!(selected.len(), 10);
    }

    fn weighted(
        id: &str,
        domain: &str,
        task: &str,
        interaction: InteractionType,
        weights: &[(&str, f64)],
    ) -> Candidate {
        let mut candidate = candidate(id, domain, task, interaction, "unused");
        candidate.concepts = weights
            .iter()
            .map(|(concept_id, weight)| ConceptWeight {
                concept_id: (*concept_id).to_owned(),
                weight: *weight,
            })
            .collect();
        candidate
    }

    #[test]
    fn recommended_practice_anchors_and_orders_by_concept_overlap() {
        let anchor = weighted(
            "anchor",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 1.0)],
        );
        let strong = weighted(
            "strong",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 1.0)],
        );
        let weak = weighted(
            "weak",
            "d1",
            "t1",
            InteractionType::Classification,
            &[("d1.core", 0.4)],
        );
        let unrelated = weighted(
            "unrelated",
            "d1",
            "t1",
            InteractionType::Classification,
            &[("d1.other", 1.0)],
        );

        let selected = recommended_practice(&anchor, &[unrelated, weak, strong], &[], 3);
        assert_eq!(selected, vec!["anchor", "strong", "weak"]);
    }

    #[test]
    fn recommended_practice_is_deterministic_and_avoids_recent_repeats() {
        let anchor = weighted(
            "anchor",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 1.0)],
        );
        let recent = weighted(
            "recent",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 1.0)],
        );
        let fresh = weighted(
            "fresh",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 0.5)],
        );
        let history = vec![HistoryEntry {
            question_id: "recent".to_owned(),
            score: 0.0,
            assessment_mode: AssessmentMode::Application,
            occurred_at: now(),
            concepts: vec![ConceptWeight {
                concept_id: "d1.core".to_owned(),
                weight: 1.0,
            }],
        }];

        let candidates = [recent.clone(), fresh.clone()];
        let first = recommended_practice(&anchor, &candidates, &history, 2);
        let second = recommended_practice(&anchor, &candidates, &history, 2);
        assert_eq!(first, second);
        assert_eq!(first, vec!["anchor", "fresh"]);
    }

    #[test]
    fn recommended_practice_returns_only_the_anchor_without_related_content() {
        let anchor = weighted(
            "anchor",
            "d1",
            "t1",
            InteractionType::Ordering,
            &[("d1.core", 1.0)],
        );
        let unrelated = weighted(
            "unrelated",
            "d1",
            "t1",
            InteractionType::Classification,
            &[("d1.other", 1.0)],
        );
        assert_eq!(
            recommended_practice(&anchor, &[unrelated], &[], 5),
            vec!["anchor"]
        );
    }
}
