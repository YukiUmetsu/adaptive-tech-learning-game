//! Server-side question selection for the quiz modes.
//!
//! There is no trained student model yet, so this is an intentionally simple,
//! explainable heuristic that can be replaced later. It is deterministic:
//! ties break by question id, so selection is testable.
//!
//! The three learner-facing modes:
//! - `quick_adaptive`: a short cross-domain set with broad coverage.
//! - `domain_quiz`: one domain, spread across its tasks.
//! - `full_practice`: a weighted, full-length certification challenge.

use std::collections::{HashMap, HashSet};

use adaptive_learn_domain::{AssessmentMode, InteractionType, QuizMode};
use chrono::{DateTime, Utc};

/// Questions in a Quick Quiz.
pub const QUICK_QUIZ_LEN: usize = 10;
/// Questions in a Domain Quiz when the domain has enough content.
pub const DOMAIN_QUIZ_LEN: usize = 20;
/// Questions in a Full Practice set.
pub const FULL_PRACTICE_LEN: usize = 65;
/// How many recent events are treated as "just practiced".
const RECENT_WINDOW: usize = 12;

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
    /// Concept ids mapped to the question.
    pub concepts: Vec<String>,
}

/// One recent accepted attempt, used to adapt selection.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryEntry {
    /// Question that was answered.
    pub question_id: String,
    /// Accepted partial score in `[0, 1]`.
    pub score: f64,
    /// When the attempt occurred.
    pub occurred_at: DateTime<Utc>,
    /// Concept ids mapped to the question.
    pub concepts: Vec<String>,
}

/// Server policy for how many questions a mode requests.
pub const fn target_len(mode: QuizMode) -> usize {
    match mode {
        QuizMode::QuickAdaptive => QUICK_QUIZ_LEN,
        QuizMode::DomainQuiz => DOMAIN_QUIZ_LEN,
        QuizMode::FullPractice => FULL_PRACTICE_LEN,
        QuizMode::TaskPractice => 0,
    }
}

/// Summarizes recent history for ranking.
#[derive(Debug, Default)]
struct RecentHistory {
    /// Newest score/time per question, plus its recency index (0 = newest event).
    by_question: HashMap<String, (f64, DateTime<Utc>, usize)>,
    /// Newest score/time per concept.
    by_concept: HashMap<String, (f64, DateTime<Utc>)>,
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
                    .entry(concept.clone())
                    .or_insert((entry.score, entry.occurred_at));
            }
            if window.len() < RECENT_WINDOW || window.contains(&entry.question_id) {
                window.insert(entry.question_id.clone());
            }
        }

        summary.recently_practiced = window;
        summary
    }

    fn concept_weakness(&self, concepts: &[String]) -> Option<f64> {
        if concepts.is_empty() {
            return None;
        }
        let mut total = 0.0;
        let mut count = 0;
        for concept in concepts {
            if let Some((score, _)) = self.by_concept.get(concept) {
                total += 1.0 - score.clamp(0.0, 1.0);
                count += 1;
            }
        }
        (count > 0).then_some(total / count as f64)
    }

    fn last_practiced(&self, concepts: &[String]) -> Option<DateTime<Utc>> {
        concepts
            .iter()
            .filter_map(|concept| self.by_concept.get(concept).map(|(_, at)| *at))
            .max()
    }
}

/// Ranks one candidate. Higher is more useful to practice now.
fn rank(
    candidate: &Candidate,
    history: &RecentHistory,
    domain_weight: f64,
    now: DateTime<Utc>,
) -> f64 {
    let weakness = history.concept_weakness(&candidate.concepts).unwrap_or(0.5);
    let recency = match history.last_practiced(&candidate.concepts) {
        Some(at) => {
            let days = (now - at).num_hours() as f64 / 24.0;
            (days / 7.0).clamp(0.0, 1.0)
        }
        None => 1.0,
    };
    let novelty = if history.by_question.contains_key(&candidate.id) {
        0.0
    } else {
        1.0
    };
    let repeat_penalty = if history.recently_practiced.contains(&candidate.id) {
        0.75
    } else {
        0.0
    };

    0.40 * weakness + 0.25 * recency + 0.20 * domain_weight.clamp(0.0, 1.0) + 0.15 * novelty
        - repeat_penalty
}

/// Orders candidates best-first with a stable question-id tie-break.
fn ordered<'a>(
    candidates: &'a [Candidate],
    history: &RecentHistory,
    weights: &HashMap<&str, f64>,
    now: DateTime<Utc>,
) -> Vec<&'a Candidate> {
    let mut ranked: Vec<&Candidate> = candidates.iter().collect();
    ranked.sort_by(|a, b| {
        let wa = weights.get(a.domain_id.as_str()).copied().unwrap_or(0.0);
        let wb = weights.get(b.domain_id.as_str()).copied().unwrap_or(0.0);
        let ra = rank(a, history, wa, now);
        let rb = rank(b, history, wb, now);
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
/// `domain_filter` scopes domain quizzes. Returns at most `target_len(mode)`
/// unique ids; fewer when content is short.
pub fn select(
    candidates: &[Candidate],
    domains: &[(String, f64)],
    history: &[HistoryEntry],
    mode: QuizMode,
    domain_filter: Option<&str>,
    now: DateTime<Utc>,
) -> Vec<String> {
    let target = target_len(mode);
    if target == 0 || candidates.is_empty() {
        return Vec::new();
    }

    let summary = RecentHistory::build(history);
    let weights: HashMap<&str, f64> = domains
        .iter()
        .map(|(id, weight)| (id.as_str(), *weight))
        .collect();
    let ranked = ordered(candidates, &summary, &weights, now);

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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).unwrap()
    }

    fn candidate(
        id: &str,
        domain: &str,
        task: &str,
        interaction: InteractionType,
        concept: &str,
    ) -> Candidate {
        Candidate {
            id: id.to_owned(),
            domain_id: domain.to_owned(),
            task_id: task.to_owned(),
            interaction_type: interaction,
            assessment_mode: AssessmentMode::Application,
            difficulty_prior: 0.5,
            concepts: vec![concept.to_owned()],
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

    #[test]
    fn quick_quiz_selects_ten_and_covers_every_domain() {
        let selected = select(
            &corpus(8),
            &domains(),
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
        assert_eq!(domains_covered.len(), 5);
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
                occurred_at: now(),
                concepts: c.concepts.clone(),
            })
            .collect();

        let selected = select(
            &corpus,
            &domains(),
            &history,
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
    fn weak_history_lifts_a_question() {
        let corpus = corpus(8);
        // A stale, weak concept lifts d1-q0 (without marking the question itself
        // as a recent repeat).
        let history = vec![HistoryEntry {
            question_id: "d1-other".to_owned(),
            score: 0.0,
            occurred_at: now() - chrono::Duration::days(30),
            concepts: vec!["d1.concept0".to_owned()],
        }];

        let d1: Vec<Candidate> = corpus.into_iter().filter(|c| c.domain_id == "d1").collect();
        let selected = select(
            &d1,
            &[("d1".to_owned(), 1.0)],
            &history,
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
    fn domain_quiz_is_scoped_and_spreads_tasks() {
        let selected = select(
            &corpus(30),
            &domains(),
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
            QuizMode::FullPractice,
            None,
            now(),
        );
        assert_eq!(selected.len(), 10);
    }
}
