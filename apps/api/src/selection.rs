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
    AssessmentMode, ConceptWeight, ErrorRemediation, InteractionType, PRIOR_ESTIMATE,
    PedagogyMetadata, QuizMode, retrievability, uncertainty,
};
use chrono::{DateTime, Utc};

use crate::pedagogy::{self, RecentPedagogy};
use crate::remediation::{self, RemediationTarget};

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
    /// Phase 2 uses it as a bounded teaching-policy signal (scaffold fit,
    /// transfer context, stage fit). It never changes mastery, scoring,
    /// difficulty, or rewards.
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
    /// Server-derived 1-based attempt number for the question.
    ///
    /// Lets the teaching policy treat a clean first-attempt success
    /// differently from a recovery.
    pub attempt_number: i32,
    /// Hints used before submitting.
    ///
    /// A hinted success fades scaffolding less aggressively than an unaided one.
    pub hint_count: i32,
    /// Authored pedagogy metadata of the answered question.
    ///
    /// Joined from canonical content by `question_id`; it is never stored on the
    /// learning event.
    pub pedagogy: Option<PedagogyMetadata>,
    /// Authoritative structured error codes the scorer produced for the attempt,
    /// each paired with the authored remediation metadata for that code.
    ///
    /// The code comes from the accepted learning event; the remediation is
    /// joined from canonical content by `question_id`. No remediation metadata
    /// is duplicated onto the event.
    pub error_codes: Vec<HistoryErrorCode>,
}

/// One authoritative structured error on an accepted attempt, with its
/// authored remediation metadata when the content provides it.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryErrorCode {
    /// Stable server-scored error code.
    pub code: String,
    /// Authored remediation target for this code, when present.
    pub remediation: Option<ErrorRemediation>,
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
        // A challenge is composed from its authored definition, never by the
        // adaptive selector.
        QuizMode::Challenge => 0,
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
    /// Bounded pedagogy summary (scaffold/transfer/stage) built once.
    pedagogy: RecentPedagogy,
    /// Highest-priority active remediation target, if any.
    ///
    /// Resolved once from the authoritative recent error signals; ranking then
    /// reads it as a bounded preference.
    remediation: Option<RemediationTarget>,
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
        summary.pedagogy = RecentPedagogy::build(history);
        summary.remediation = remediation::resolve_active_remediation(history);
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

    /// Estimate and uncertainty for a candidate from accepted history alone.
    ///
    /// `recommended_practice` receives no derived concept-state rows, so the
    /// teaching policy falls back to the newest accepted score per concept and
    /// treats it as low-confidence evidence.
    fn pedagogy_context(&self, candidate: &Candidate) -> (f64, f64) {
        let mut weight_sum = 0.0;
        let mut estimate = 0.0;
        for concept in &candidate.concepts {
            let weight = concept.weight.clamp(0.0, 1.0);
            if weight <= 0.0 {
                continue;
            }
            weight_sum += weight;
            let key = (concept.concept_id.clone(), candidate.assessment_mode);
            let score = self
                .by_concept
                .get(&key)
                .map(|(score, _)| score.clamp(0.0, 1.0))
                .unwrap_or(PRIOR_ESTIMATE);
            estimate += weight * score;
        }
        if weight_sum <= 0.0 {
            return (PRIOR_ESTIMATE, 1.0);
        }
        (estimate / weight_sum, 1.0)
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
    // Bounded teaching-policy preference derived from optional authored
    // pedagogy metadata. It stays small so weakness, forgetting, difficulty,
    // and variety remain the dominant signals.
    let remediation = history
        .remediation
        .as_ref()
        .map(|target| remediation::fit(target, candidate.pedagogy.as_ref(), &candidate.concepts));
    let scaffold_floor = remediation.and_then(|fit| fit.scaffold_floor);
    let pedagogy = pedagogy::pedagogy_fit_with_floor(
        candidate.pedagogy.as_ref(),
        signal.estimate,
        signal.uncertainty,
        &history.pedagogy,
        scaffold_floor,
    );
    let remediation_bonus =
        remediation.map_or(0.0, |fit| remediation::WEIGHT_REMEDIATION * fit.bonus);

    WEIGHT_WEAKNESS * weakness
        + WEIGHT_FORGETTING * signal.forgetting_risk
        + WEIGHT_DOMAIN * domain_weight.clamp(0.0, 1.0)
        + WEIGHT_UNCERTAINTY * signal.uncertainty
        + WEIGHT_DIFFICULTY_FIT * difficulty_fit
        + WEIGHT_NOVELTY * novelty
        + pedagogy.total()
        + remediation_bonus
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

    let mut summary = RecentHistory::build(history);
    if mode == QuizMode::FullPractice {
        // Full Practice is an exam simulation. Structured errors are still
        // recorded, but targeted remediation must not reshape the weighted exam
        // composition; it happens after the session instead.
        summary.remediation = None;
    }
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
        // A challenge is composed from its authored definition by the challenge
        // service, not by the general selector.
        QuizMode::Challenge => Vec::new(),
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
            // Same bounded teaching-policy preference as the general selector so
            // related practice also fades support, varies surface context, and
            // honours an active remediation target.
            let (estimate, uncertainty) = summary.pedagogy_context(candidate);
            let remediation = summary.remediation.as_ref().map(|target| {
                remediation::fit(target, candidate.pedagogy.as_ref(), &candidate.concepts)
            });
            let scaffold_floor = remediation.and_then(|fit| fit.scaffold_floor);
            let pedagogy = pedagogy::pedagogy_fit_with_floor(
                candidate.pedagogy.as_ref(),
                estimate,
                uncertainty,
                &summary.pedagogy,
                scaffold_floor,
            );
            let remediation_bonus =
                remediation.map_or(0.0, |fit| remediation::WEIGHT_REMEDIATION * fit.bonus);
            Some((
                candidate,
                shared + mode_bonus + pedagogy.total() + remediation_bonus - repeat,
            ))
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
    use adaptive_learn_domain::PedagogyStage;
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
                attempt_number: 1,
                hint_count: 0,
                pedagogy: c.pedagogy.clone(),
                error_codes: Vec::new(),
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
            attempt_number: 1,
            hint_count: 0,
            pedagogy: None,
            error_codes: Vec::new(),
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
            attempt_number: 1,
            hint_count: 0,
            pedagogy: None,
            error_codes: Vec::new(),
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

    // --- Phase 2: adaptive scaffold fading and transfer-aware selection ---

    fn ped_meta(
        family: Option<&str>,
        stage: Option<PedagogyStage>,
        scaffold: Option<u8>,
        group: Option<&str>,
        surface: Option<&str>,
    ) -> PedagogyMetadata {
        PedagogyMetadata {
            family_id: family.map(str::to_owned),
            stage,
            scaffold_level: scaffold,
            transfer_group_id: group.map(str::to_owned),
            surface_context: surface.map(str::to_owned),
            challenge_group_id: None,
        }
    }

    fn with_ped(mut candidate: Candidate, pedagogy: PedagogyMetadata) -> Candidate {
        candidate.pedagogy = Some(pedagogy);
        candidate
    }

    fn scaffolded(id: &str, family: &str, level: u8) -> Candidate {
        with_ped(
            candidate(
                id,
                "d1",
                &format!("{id}-task"),
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(Some(family), None, Some(level), None, None),
        )
    }

    fn recent(
        question_id: &str,
        pedagogy: PedagogyMetadata,
        score: f64,
        attempt_number: i32,
        hint_count: i32,
    ) -> HistoryEntry {
        HistoryEntry {
            question_id: question_id.to_owned(),
            score,
            assessment_mode: AssessmentMode::Application,
            occurred_at: now(),
            concepts: vec![concept("c1")],
            attempt_number,
            hint_count,
            pedagogy: Some(pedagogy),
            error_codes: Vec::new(),
        }
    }

    fn d1() -> Vec<(String, f64)> {
        vec![("d1".to_owned(), 1.0)]
    }

    fn domain_quiz(
        candidates: &[Candidate],
        history: &[HistoryEntry],
        states: &[ConceptEvidence],
    ) -> Vec<String> {
        select(
            candidates,
            &d1(),
            history,
            states,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        )
    }

    #[test]
    fn no_pedagogy_metadata_leaves_ranking_unchanged() {
        // Two otherwise identical candidates with no pedagogy metadata: the
        // new teaching-policy term is a constant, so the existing id tie-break
        // still decides.
        let first = candidate("d1-a", "d1", "d1-ta", InteractionType::Ordering, "c1");
        let second = candidate("d1-b", "d1", "d1-tb", InteractionType::Ordering, "c1");
        let states = vec![evidence("c1", 0.8, 4.0, now())];

        let selected = domain_quiz(&[second, first], &[], &states);
        assert_eq!(selected, vec!["d1-a".to_owned(), "d1-b".to_owned()]);
    }

    #[test]
    fn weak_learner_prefers_more_scaffolding() {
        // The low-scaffold candidate sorts first by id, so only the policy can
        // put the supported candidate ahead of it for a weak learner.
        let high = scaffolded("d1-z-high", "generic.family", 4);
        let low = scaffolded("d1-a-low", "generic.family", 1);
        let states = vec![evidence("c1", 0.15, 4.0, now())];

        let selected = domain_quiz(&[low, high], &[], &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-high"),
            "a weak learner should receive embedded support: {selected:?}"
        );
    }

    #[test]
    fn strong_learner_prefers_less_scaffolding() {
        // The high-scaffold candidate sorts first by id, so only the policy can
        // put the lean candidate ahead of it for a strong learner.
        let high = scaffolded("d1-a-high", "generic.family", 4);
        let low = scaffolded("d1-z-low", "generic.family", 1);
        let states = vec![evidence("c1", 0.95, 8.0, now())];

        let selected = domain_quiz(&[high, low], &[], &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-low"),
            "a strong learner should receive less support: {selected:?}"
        );
    }

    #[test]
    fn success_fades_one_step_rather_than_jumping_to_zero() {
        // A developing learner whose readiness target sits between 2 and 3, with
        // a recent clean success at scaffold 4. The intermediate candidate must
        // beat a cold scaffold-0 candidate.
        let intermediate = scaffolded("d1-mid", "generic.family", 3);
        let cold = scaffolded("d1-cold", "generic.family", 0);
        let states = vec![evidence("c1", 0.65, 4.0, now())];
        let history = vec![recent(
            "recent",
            ped_meta(Some("generic.family"), None, Some(4), None, None),
            1.0,
            1,
            0,
        )];

        let selected = domain_quiz(&[cold, intermediate], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-mid"),
            "support should fade gradually, not collapse to zero: {selected:?}"
        );
    }

    #[test]
    fn recent_failure_allows_more_support_back_in() {
        let supported = scaffolded("d1-supported", "generic.family", 2);
        let cold = scaffolded("d1-cold", "generic.family", 0);
        let states = vec![evidence("c1", 0.95, 8.0, now())];

        // Without failure history the strong learner gets the cold candidate.
        let without = domain_quiz(&[cold.clone(), supported.clone()], &[], &states);
        assert_eq!(without.first().map(String::as_str), Some("d1-cold"));

        // A recent failure at scaffold 0 permits more embedded support.
        let failed = vec![recent(
            "recent",
            ped_meta(Some("generic.family"), None, Some(0), None, None),
            0.0,
            1,
            0,
        )];
        let with = domain_quiz(&[cold, supported], &failed, &states);
        assert_eq!(
            with.first().map(String::as_str),
            Some("d1-supported"),
            "a recent failure should allow support to increase: {with:?}"
        );
    }

    #[test]
    fn hinted_success_fades_less_than_a_clean_success() {
        let high = scaffolded("d1-high", "generic.family", 5);
        let mid = scaffolded("d1-mid", "generic.family", 4);
        let states = vec![evidence("c1", 0.25, 8.0, now())];

        let clean = vec![recent(
            "recent",
            ped_meta(Some("generic.family"), None, Some(5), None, None),
            1.0,
            1,
            0,
        )];
        let clean_selected = domain_quiz(&[high.clone(), mid.clone()], &clean, &states);
        assert_eq!(
            clean_selected.first().map(String::as_str),
            Some("d1-mid"),
            "a clean success may fade one step: {clean_selected:?}"
        );

        let hinted = vec![recent(
            "recent",
            ped_meta(Some("generic.family"), None, Some(5), None, None),
            1.0,
            2,
            2,
        )];
        let hinted_selected = domain_quiz(&[high, mid], &hinted, &states);
        assert_eq!(
            hinted_selected.first().map(String::as_str),
            Some("d1-high"),
            "a hinted/recovery success must fade less aggressively: {hinted_selected:?}"
        );
    }

    #[test]
    fn difficulty_still_beats_an_ideal_scaffold_level() {
        // The weakest-fit difficulty must not win just because its scaffold is
        // ideal: a strong learner should not receive a trivially easy item.
        let mut ideal_scaffold_hard_mismatch = scaffolded("d1-mismatch", "generic.family", 1);
        ideal_scaffold_hard_mismatch.difficulty_prior = 0.0;
        let mut right_difficulty_wrong_scaffold = scaffolded("d1-right", "generic.family", 5);
        right_difficulty_wrong_scaffold.difficulty_prior = 0.9;
        let states = vec![evidence("c1", 0.9, 8.0, now())];

        let selected = domain_quiz(
            &[
                ideal_scaffold_hard_mismatch,
                right_difficulty_wrong_scaffold,
            ],
            &[],
            &states,
        );
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-right"),
            "difficulty fit must remain dominant over scaffold fit: {selected:?}"
        );
    }

    #[test]
    fn transfer_prefers_a_new_surface_context_after_success() {
        // The repeated-context candidate sorts first by id, so only the
        // transfer policy can put the novel context ahead of it.
        let api = with_ped(
            candidate(
                "d1-z-api",
                "d1",
                "d1-api-task",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_api"),
            ),
        );
        let strings = with_ped(
            candidate(
                "d1-a-strings",
                "d1",
                "d1-str-task",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_strings"),
            ),
        );
        let states = vec![evidence("c1", 0.8, 6.0, now())];
        // Recent success in the strings context of the same transfer group.
        let history = vec![recent(
            "recent",
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_strings"),
            ),
            1.0,
            1,
            0,
        )];

        let selected = domain_quiz(&[strings, api], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-api"),
            "a new surface context should be preferred after success: {selected:?}"
        );
    }

    #[test]
    fn context_novelty_does_not_override_concept_weakness() {
        let weak_strings = with_ped(
            candidate(
                "d1-weak",
                "d1",
                "d1-weak-task",
                InteractionType::Ordering,
                "c-weak",
            ),
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_strings"),
            ),
        );
        let strong_api = with_ped(
            candidate(
                "d1-strong",
                "d1",
                "d1-str-task",
                InteractionType::Ordering,
                "c-strong",
            ),
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_api"),
            ),
        );
        let states = vec![
            evidence("c-weak", 0.1, 4.0, now()),
            evidence("c-strong", 0.95, 8.0, now()),
        ];
        let history = vec![recent(
            "recent",
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_strings"),
            ),
            1.0,
            1,
            0,
        )];

        let selected = domain_quiz(&[strong_api, weak_strings], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-weak"),
            "concept weakness must remain dominant over context novelty: {selected:?}"
        );
    }

    #[test]
    fn selector_works_with_a_single_surface_context() {
        let a = with_ped(
            candidate("d1-a", "d1", "d1-ta", InteractionType::Ordering, "c1"),
            ped_meta(
                None,
                None,
                Some(2),
                Some("generic.transfer"),
                Some("context_strings"),
            ),
        );
        let b = with_ped(
            candidate("d1-b", "d1", "d1-tb", InteractionType::Ordering, "c1"),
            ped_meta(
                None,
                None,
                Some(2),
                Some("generic.transfer"),
                Some("context_strings"),
            ),
        );
        let states = vec![evidence("c1", 0.5, 4.0, now())];
        let history = vec![recent(
            "recent",
            ped_meta(
                None,
                None,
                None,
                Some("generic.transfer"),
                Some("context_strings"),
            ),
            1.0,
            1,
            0,
        )];

        let selected = domain_quiz(&[b, a], &history, &states);
        assert_eq!(selected.len(), 2, "both candidates remain selectable");
    }

    #[test]
    fn transfer_stage_can_lead_for_a_strong_learner() {
        let transfer = with_ped(
            candidate(
                "d1-transfer",
                "d1",
                "d1-tt",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(None, Some(PedagogyStage::Transfer), Some(0), None, None),
        );
        let recognition = with_ped(
            candidate(
                "d1-recognize",
                "d1",
                "d1-tr",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(None, Some(PedagogyStage::Recognize), Some(5), None, None),
        );
        let states = vec![evidence("c1", 0.95, 8.0, now())];

        let selected = domain_quiz(&[recognition, transfer], &[], &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-transfer"),
            "a strong learner should be able to reach transfer work: {selected:?}"
        );
    }

    #[test]
    fn cold_learner_is_not_pushed_into_transfer() {
        // The transfer candidate sorts first by id, so only the policy can put
        // the supported recognition item ahead of it for a cold learner.
        let transfer = with_ped(
            candidate(
                "d1-a-transfer",
                "d1",
                "d1-tt",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(None, Some(PedagogyStage::Transfer), Some(0), None, None),
        );
        let recognition = with_ped(
            candidate(
                "d1-z-recognize",
                "d1",
                "d1-tr",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(None, Some(PedagogyStage::Recognize), Some(5), None, None),
        );

        // No states and no history: a cold learner.
        let selected = domain_quiz(&[transfer, recognition], &[], &[]);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-recognize"),
            "a cold learner should begin with supported recognition: {selected:?}"
        );
    }

    #[test]
    fn direct_repeat_penalty_still_dominates_context_novelty() {
        // The repeated candidate sorts first by id and carries the novel
        // `context_b`, yet the existing repeat penalty must still beat variety.
        let repeated = with_ped(
            candidate(
                "d1-a-repeat",
                "d1",
                "d1-tr",
                InteractionType::Ordering,
                "c1",
            ),
            ped_meta(None, None, None, Some("g"), Some("context_a")),
        );
        let novel = with_ped(
            candidate("d1-z-novel", "d1", "d1-tn", InteractionType::Ordering, "c1"),
            ped_meta(None, None, None, Some("g"), Some("context_b")),
        );
        let states = vec![evidence("c1", 0.8, 6.0, now())];
        let repeat_entry = recent(
            "d1-a-repeat",
            ped_meta(None, None, None, Some("g"), Some("context_a")),
            1.0,
            1,
            0,
        );
        let history = vec![repeat_entry];

        let selected = domain_quiz(&[repeated, novel], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-novel"),
            "the same recently answered question must not win on novelty: {selected:?}"
        );
    }

    #[test]
    fn scaffold_policy_is_domain_neutral() {
        // The same metadata shape under very different subject names must behave
        // identically: the core never inspects `family_id` contents.
        let families = [
            "dsa.sliding_window.variable",
            "aws.messaging.decoupling",
            "python.async.task_lifecycle",
            "security.authz.misconfiguration",
            "ml.data_leakage",
        ];
        let states = vec![evidence("c1", 0.15, 4.0, now())];
        for family in families {
            // The low-scaffold id sorts first, so the policy must flip it.
            let high = scaffolded("d1-z-high", family, 4);
            let low = scaffolded("d1-a-low", family, 1);
            let selected = domain_quiz(&[low, high], &[], &states);
            assert_eq!(
                selected.first().map(String::as_str),
                Some("d1-z-high"),
                "family {family} should behave like every other family"
            );
        }
    }

    #[test]
    fn pedagogy_ranking_is_deterministic() {
        let high = scaffolded("d1-high", "generic.family", 4);
        let low = scaffolded("d1-low", "generic.family", 1);
        let states = vec![evidence("c1", 0.2, 4.0, now())];
        let first = domain_quiz(&[low.clone(), high.clone()], &[], &states);
        for _ in 0..5 {
            assert_eq!(
                domain_quiz(&[low.clone(), high.clone()], &[], &states),
                first
            );
        }
    }

    // --- Phase 3: structured-error remediation ---

    fn errored(
        question_id: &str,
        concept_id: &str,
        score: f64,
        remediation: ErrorRemediation,
    ) -> HistoryEntry {
        HistoryEntry {
            question_id: question_id.to_owned(),
            score,
            assessment_mode: AssessmentMode::Application,
            occurred_at: now(),
            concepts: vec![concept(concept_id)],
            attempt_number: 1,
            hint_count: 0,
            pedagogy: None,
            error_codes: vec![HistoryErrorCode {
                code: "generic_error".to_owned(),
                remediation: Some(remediation),
            }],
        }
    }

    fn recovered(question_id: &str, concept_id: &str) -> HistoryEntry {
        HistoryEntry {
            question_id: question_id.to_owned(),
            score: 1.0,
            assessment_mode: AssessmentMode::Application,
            // Strictly later in occurrence time, so it supersedes the error.
            occurred_at: now() + chrono::Duration::minutes(1),
            concepts: vec![concept(concept_id)],
            attempt_number: 1,
            hint_count: 0,
            pedagogy: None,
            error_codes: Vec::new(),
        }
    }

    fn concept_remediation(concept_id: &str, floor: Option<u8>) -> ErrorRemediation {
        ErrorRemediation {
            concept_ids: vec![concept_id.to_owned()],
            node_id: None,
            preferred_stage: None,
            preferred_family_id: None,
            min_scaffold_level: floor,
        }
    }

    #[test]
    fn remediation_floor_keeps_support_for_a_strong_learner() {
        let high = scaffolded("d1-z-high", "generic.family", 3);
        let low = scaffolded("d1-a-low", "generic.family", 0);
        let states = vec![evidence("c1", 0.95, 8.0, now())];
        let history = vec![errored(
            "err-q",
            "c1",
            0.0,
            concept_remediation("c1", Some(3)),
        )];

        let selected = domain_quiz(&[low, high], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-z-high"),
            "a recent error's scaffold floor should keep embedded support: {selected:?}"
        );
    }

    #[test]
    fn recovery_resumes_normal_scaffold_fading() {
        let high = scaffolded("d1-high", "generic.family", 4);
        let low = scaffolded("d1-low", "generic.family", 1);
        let states = vec![evidence("c1", 0.95, 8.0, now())];
        // A newer success on the target concept supersedes the older error.
        let history = vec![
            recovered("success-q", "c1"),
            errored("err-q", "c1", 0.0, concept_remediation("c1", Some(3))),
        ];

        let selected = domain_quiz(&[high, low], &history, &states);
        assert_eq!(
            selected.first().map(String::as_str),
            Some("d1-low"),
            "after recovery, normal Phase 2 fading resumes: {selected:?}"
        );
    }

    #[test]
    fn remediation_does_not_reshape_full_practice() {
        let matching = with_ped(
            candidate("d1-z-match", "d1", "d1-tz", InteractionType::Ordering, "c1"),
            ped_meta(None, None, None, None, None),
        );
        let other = with_ped(
            candidate("d1-a-other", "d1", "d1-ta", InteractionType::Ordering, "c2"),
            ped_meta(None, None, None, None, None),
        );
        let states = vec![
            evidence("c1", 0.5, 4.0, now()),
            evidence("c2", 0.5, 4.0, now()),
        ];
        let history = vec![errored("err-q", "c1", 0.0, concept_remediation("c1", None))];
        let domains = d1();

        let domain_selected = select(
            &[other.clone(), matching.clone()],
            &domains,
            &history,
            &states,
            QuizMode::DomainQuiz,
            Some("d1"),
            now(),
        );
        assert_eq!(
            domain_selected.first().map(String::as_str),
            Some("d1-z-match"),
            "an ordinary quiz targets the remediation concept"
        );

        let full_selected = select(
            &[other, matching],
            &domains,
            &history,
            &states,
            QuizMode::FullPractice,
            None,
            now(),
        );
        assert_eq!(
            full_selected.first().map(String::as_str),
            Some("d1-a-other"),
            "Full Practice keeps its exam composition and ignores remediation"
        );
    }

    #[test]
    fn remediation_matching_is_domain_neutral() {
        // The resolver/ranking only sees metadata shape, never subject names.
        for concept_id in [
            "dsa.sliding_window.interval",
            "aws.messaging.queue_vs_pubsub",
            "python.async.execution",
            "security.authn_vs_authz",
            "ml.data_leakage",
        ] {
            let matching = candidate(
                "d1-z-match",
                "d1",
                "d1-tz",
                InteractionType::Ordering,
                concept_id,
            );
            let other = candidate(
                "d1-a-other",
                "d1",
                "d1-ta",
                InteractionType::Ordering,
                "unrelated",
            );
            let states = vec![
                evidence(concept_id, 0.5, 4.0, now()),
                evidence("unrelated", 0.5, 4.0, now()),
            ];
            let history = vec![errored(
                "err-q",
                concept_id,
                0.0,
                concept_remediation(concept_id, None),
            )];

            let selected = domain_quiz(&[other, matching], &history, &states);
            assert_eq!(
                selected.first().map(String::as_str),
                Some("d1-z-match"),
                "concept {concept_id} should behave like every other concept"
            );
        }
    }
}
