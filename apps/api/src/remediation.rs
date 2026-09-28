//! Recent structured-error remediation resolution (Phase 3).
//!
//! This module isolates one concern: turning authoritative, recent structured
//! errors into at most one *active remediation target*. Candidate ranking then
//! consumes that target as a small, bounded teaching-policy preference.
//!
//! The separation matters:
//!
//! ```text
//! structured error resolution  !=  candidate ranking
//! ```
//!
//! A structured error is **not** a permanent misconception label. It is local
//! evidence about how one attempt failed. It only influences selection while it
//! is recent and not superseded by a later success on the same target; nothing
//! here is persisted, and nothing here changes concept state, mastery, or
//! rewards.
//!
//! Only server-scored error codes reach this module: they are read from accepted
//! learning events, never from client input or free text. Authored remediation
//! metadata is opaque and track-agnostic, so the same resolver works for DSA,
//! Python, AWS, Terraform, security, ML, and future tracks without a
//! subject-specific branch.

use adaptive_learn_domain::{
    ConceptWeight, ErrorRemediation, PEDAGOGY_MAX_SCAFFOLD_LEVEL, PedagogyMetadata, PedagogyStage,
};

use crate::selection::HistoryEntry;

/// How many of the newest accepted attempts may surface a remediation signal.
///
/// Reuses the same small recent-history window convention as Phase 2: an error
/// from months ago must not steer current selection.
pub const REMEDIATION_WINDOW: usize = 12;

/// A score at or above this counts as a recovery success (mirrors the domain
/// success threshold used by `heuristic-v1`).
const SUCCESS_SCORE: f64 = 0.5;

/// Weight of a remediation match in the rank.
///
/// Bounded and deliberately below concept weakness and forgetting, so targeted
/// repair stays a strong preference rather than an unbreakable redirect.
pub const WEIGHT_REMEDIATION: f64 = 0.12;

/// Match weights for the parts of a remediation target. Summed and clamped.
///
/// Concept overlap is the strongest signal but does not saturate the fit on its
/// own, so a matching family or stage can still break a tie between candidates
/// that already share the target concept.
const CONCEPT_MATCH: f64 = 0.6;
const FAMILY_MATCH: f64 = 0.25;
const STAGE_MATCH: f64 = 0.15;
/// A node that teaches a target concept, but is not the exact authored node.
const NODE_CONCEPT_MATCH: f64 = 0.4;

/// The single highest-priority active remediation target.
///
/// Built from one authoritative structured error plus its authored remediation
/// metadata. `concept_ids` falls back to the errored question's own concepts
/// when the author supplied none, so a floor-only or stage-only remediation is
/// still usable.
#[derive(Debug, Clone, PartialEq)]
pub struct RemediationTarget {
    /// The authoritative error code that produced this target.
    pub error_code: String,
    /// The question whose attempt produced the error.
    pub question_id: String,
    /// Concepts the remediation should target (never empty in practice).
    pub concept_ids: Vec<String>,
    /// Authored learning node that addresses the mistake, if any.
    pub node_id: Option<String>,
    /// Authored reusable family the remediation should stay within, if any.
    pub family_id: Option<String>,
    /// Authored stage of the follow-up activity, if any.
    pub preferred_stage: Option<PedagogyStage>,
    /// Temporary scaffold floor for matching candidates, if any.
    pub min_scaffold_level: Option<u8>,
}

/// How well one candidate matches an active remediation target.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RemediationFit {
    /// Match strength in `[0, 1]`.
    pub bonus: f64,
    /// Temporary scaffold floor, only for matching candidates.
    pub scaffold_floor: Option<u8>,
}

/// Resolves at most one active remediation target from recent accepted history.
///
/// Newest-first history is scanned within [`REMEDIATION_WINDOW`]. An error is
/// skipped when a later (by `occurred_at`), same-mode accepted success overlaps
/// its target concept(s) or family (see [`is_recovered`]). Among the remaining errors, the most specific
/// wins: an authored `node_id` first, then explicit target concepts, then a
/// family/stage preference; ties break newest-first, then by stable code.
pub fn resolve_active_remediation(history: &[HistoryEntry]) -> Option<RemediationTarget> {
    let mut best: Option<(u8, usize, String, RemediationTarget)> = None;

    for (index, entry) in history.iter().enumerate() {
        if index >= REMEDIATION_WINDOW {
            break;
        }
        for error in &entry.error_codes {
            let Some(remediation) = &error.remediation else {
                continue;
            };
            if remediation.is_empty() {
                continue;
            }
            if is_recovered(history, entry, remediation) {
                continue;
            }

            let specificity = specificity(remediation);
            let candidate = RemediationTarget::new(&error.code, entry, remediation);
            let better = match &best {
                None => true,
                Some((best_specificity, best_index, best_code, _)) => {
                    (specificity, index, error.code.as_str())
                        < (*best_specificity, *best_index, best_code.as_str())
                }
            };
            if better {
                best = Some((specificity, index, error.code.clone(), candidate));
            }
        }
    }

    best.map(|(_, _, _, target)| target)
}

impl RemediationTarget {
    /// Builds a target from an authoritative error and its authored metadata.
    fn new(error_code: &str, entry: &HistoryEntry, remediation: &ErrorRemediation) -> Self {
        let concept_ids = if remediation.concept_ids.is_empty() {
            // Fallback: the errored question's own concepts. This keeps a
            // floor-only or stage-only remediation actionable without asking
            // authors to repeat the whole concept list.
            entry
                .concepts
                .iter()
                .map(|concept| concept.concept_id.clone())
                .collect()
        } else {
            remediation.concept_ids.clone()
        };

        Self {
            error_code: error_code.to_owned(),
            question_id: entry.question_id.clone(),
            concept_ids,
            node_id: remediation.node_id.clone(),
            family_id: remediation.preferred_family_id.clone(),
            preferred_stage: remediation.preferred_stage,
            min_scaffold_level: remediation
                .min_scaffold_level
                .map(|level| level.min(PEDAGOGY_MAX_SCAFFOLD_LEVEL)),
        }
    }
}

/// Priority bucket from the authored fields only: lower is more specific.
fn specificity(remediation: &ErrorRemediation) -> u8 {
    if remediation.node_id.is_some() {
        0
    } else if !remediation.concept_ids.is_empty() {
        1
    } else {
        2
    }
}

/// Whether a later accepted success has superseded an error signal.
///
/// An error is suppressed only by an attempt that is **strictly later in
/// occurrence time** (`occurred_at`, not sync order), scored a success, is in
/// the **same assessment mode**, and overlaps the remediation's target
/// concepts (or its family). Keeping modes separate matters: a recognition
/// success must not hide a weak application attempt, mirroring the student
/// model's own mode separation. Scaffold comparison is still not enforced in
/// Phase 3.
fn is_recovered(
    history: &[HistoryEntry],
    errored: &HistoryEntry,
    remediation: &ErrorRemediation,
) -> bool {
    let target_concepts: Vec<&str> = if remediation.concept_ids.is_empty() {
        errored
            .concepts
            .iter()
            .map(|concept| concept.concept_id.as_str())
            .collect()
    } else {
        remediation.concept_ids.iter().map(String::as_str).collect()
    };
    let family = remediation.preferred_family_id.as_deref();

    for entry in history {
        if entry.score < SUCCESS_SCORE {
            continue;
        }
        // Same evidence mode: a different mode is not comparable recovery.
        if entry.assessment_mode != errored.assessment_mode {
            continue;
        }
        // Strictly later in time, so a late-synced older success cannot
        // suppress a newer error and an earlier success cannot either.
        if entry.occurred_at <= errored.occurred_at {
            continue;
        }
        let concept_hit = !target_concepts.is_empty()
            && entry
                .concepts
                .iter()
                .any(|concept| target_concepts.contains(&concept.concept_id.as_str()));
        let family_hit = family.is_some_and(|family| {
            entry
                .pedagogy
                .as_ref()
                .and_then(|pedagogy| pedagogy.family_id.as_deref())
                == Some(family)
        });
        if concept_hit || family_hit {
            return true;
        }
    }
    false
}

/// How well one question candidate matches an active remediation target.
pub fn fit(
    target: &RemediationTarget,
    pedagogy: Option<&PedagogyMetadata>,
    concepts: &[ConceptWeight],
) -> RemediationFit {
    let mut bonus = 0.0;

    if !target.concept_ids.is_empty()
        && concepts
            .iter()
            .any(|concept| target.concept_ids.contains(&concept.concept_id))
    {
        bonus += CONCEPT_MATCH;
    }
    if target.family_id.as_deref().is_some_and(|family| {
        pedagogy.and_then(|pedagogy| pedagogy.family_id.as_deref()) == Some(family)
    }) {
        bonus += FAMILY_MATCH;
    }
    if target
        .preferred_stage
        .is_some_and(|stage| pedagogy.and_then(|pedagogy| pedagogy.stage) == Some(stage))
    {
        bonus += STAGE_MATCH;
    }

    let bonus = bonus.clamp(0.0, 1.0);
    // The scaffold floor is temporary and only applies to a matching candidate;
    // it disappears as soon as the error signal is recovered.
    let scaffold_floor = (bonus > 0.0)
        .then_some(target.min_scaffold_level)
        .flatten()
        .map(|level| level.min(PEDAGOGY_MAX_SCAFFOLD_LEVEL));

    RemediationFit {
        bonus,
        scaffold_floor,
    }
}

/// How well a learning node matches an active remediation target.
///
/// Used by the session planner's node scoring; the next-action planner handles
/// the exact node directly and falls back to practice when it is unavailable.
pub fn node_fit(target: &RemediationTarget, node_id: &str, concept_ids: &[String]) -> f64 {
    if target.node_id.as_deref() == Some(node_id) {
        return 1.0;
    }
    if !target.concept_ids.is_empty()
        && concept_ids
            .iter()
            .any(|concept| target.concept_ids.contains(concept))
    {
        return NODE_CONCEPT_MATCH;
    }
    0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use adaptive_learn_domain::AssessmentMode;
    use chrono::{DateTime, TimeZone, Utc};

    use crate::selection::{HistoryEntry, HistoryErrorCode};

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn concept(concept_id: &str) -> ConceptWeight {
        ConceptWeight {
            concept_id: concept_id.to_owned(),
            weight: 1.0,
        }
    }

    fn remediation(
        concepts: &[&str],
        node: Option<&str>,
        stage: Option<PedagogyStage>,
        family: Option<&str>,
        floor: Option<u8>,
    ) -> ErrorRemediation {
        ErrorRemediation {
            concept_ids: concepts.iter().map(|c| (*c).to_owned()).collect(),
            node_id: node.map(str::to_owned),
            preferred_stage: stage,
            preferred_family_id: family.map(str::to_owned),
            min_scaffold_level: floor,
        }
    }

    fn entry(
        question_id: &str,
        concepts: &[&str],
        error: Option<(&str, ErrorRemediation)>,
        score: f64,
    ) -> HistoryEntry {
        HistoryEntry {
            question_id: question_id.to_owned(),
            score,
            assessment_mode: AssessmentMode::Application,
            occurred_at: now(),
            concepts: concepts.iter().map(|c| concept(c)).collect(),
            attempt_number: 1,
            hint_count: 0,
            pedagogy: None,
            error_codes: error
                .map(|(code, remediation)| HistoryErrorCode {
                    code: code.to_owned(),
                    remediation: Some(remediation),
                })
                .into_iter()
                .collect(),
        }
    }

    /// Marks an entry as strictly later in occurrence time than `now()`.
    fn later(mut entry: HistoryEntry) -> HistoryEntry {
        entry.occurred_at = now() + chrono::Duration::minutes(1);
        entry
    }

    fn with_mode(mut entry: HistoryEntry, mode: AssessmentMode) -> HistoryEntry {
        entry.assessment_mode = mode;
        entry
    }

    #[test]
    fn recent_error_becomes_active() {
        let history = vec![entry(
            "q1",
            &["c1"],
            Some((
                "boundary_no_progress",
                remediation(&["c1"], None, None, None, None),
            )),
            0.0,
        )];
        let target = resolve_active_remediation(&history).expect("active target");
        assert_eq!(target.error_code, "boundary_no_progress");
        assert_eq!(target.concept_ids, vec!["c1".to_owned()]);
    }

    #[test]
    fn old_error_outside_the_window_is_ignored() {
        // Newest-first: fillers fill the whole window, then the old error sits
        // just outside it.
        let mut history: Vec<HistoryEntry> = (0..REMEDIATION_WINDOW)
            .map(|index| entry(&format!("filler-{index}"), &["c-other"], None, 1.0))
            .collect();
        history.push(entry(
            "q-old",
            &["c1"],
            Some((
                "boundary_no_progress",
                remediation(&["c1"], None, None, None, None),
            )),
            0.0,
        ));
        assert!(resolve_active_remediation(&history).is_none());

        // Move the error to the newest entry: now it is inside the window.
        let error = history.pop().expect("error entry");
        history.insert(0, error);
        assert!(resolve_active_remediation(&history).is_some());
    }

    #[test]
    fn later_relevant_success_suppresses_the_error() {
        // A success on the target concept that occurred after the error.
        let history = vec![
            later(entry("q-success", &["c1"], None, 1.0)),
            entry(
                "q-error",
                &["c1"],
                Some((
                    "boundary_no_progress",
                    remediation(&["c1"], None, None, None, None),
                )),
                0.0,
            ),
        ];
        assert!(resolve_active_remediation(&history).is_none());
    }

    #[test]
    fn a_different_mode_success_does_not_suppress_the_error() {
        // Recognition success must not hide a weak application attempt.
        let history = vec![
            with_mode(
                later(entry("q-recognize", &["c1"], None, 1.0)),
                AssessmentMode::Recognition,
            ),
            entry(
                "q-error",
                &["c1"],
                Some((
                    "boundary_no_progress",
                    remediation(&["c1"], None, None, None, None),
                )),
                0.0,
            ),
        ];
        assert!(
            resolve_active_remediation(&history).is_some(),
            "a recognition success must not suppress an application error"
        );
    }

    #[test]
    fn an_earlier_success_does_not_suppress_a_later_error() {
        // The success is newer in sync order but older in occurrence time, as
        // happens when an offline attempt syncs after the error.
        let history = vec![
            entry("q-success", &["c1"], None, 1.0),
            later(entry(
                "q-error",
                &["c1"],
                Some((
                    "boundary_no_progress",
                    remediation(&["c1"], None, None, None, None),
                )),
                0.0,
            )),
        ];
        assert!(
            resolve_active_remediation(&history).is_some(),
            "an earlier-in-time success must not suppress a later error"
        );
    }

    #[test]
    fn unrelated_success_does_not_suppress_the_error() {
        let history = vec![
            entry("q-unrelated", &["c-other"], None, 1.0),
            entry(
                "q-error",
                &["c1"],
                Some((
                    "boundary_no_progress",
                    remediation(&["c1"], None, None, None, None),
                )),
                0.0,
            ),
        ];
        assert!(resolve_active_remediation(&history).is_some());
    }

    #[test]
    fn most_specific_error_wins() {
        let history = vec![
            entry(
                "q-generic",
                &["c1"],
                Some((
                    "aaa_generic",
                    remediation(&["c1"], None, Some(PedagogyStage::Trace), None, None),
                )),
                0.0,
            ),
            entry(
                "q-node",
                &["c1"],
                Some((
                    "zzz_node",
                    remediation(&["c1"], Some("node-x"), None, None, None),
                )),
                0.0,
            ),
        ];
        let target = resolve_active_remediation(&history).expect("target");
        assert_eq!(
            target.error_code, "zzz_node",
            "an authored node target outranks a generic one"
        );
    }

    #[test]
    fn newest_wins_among_equally_specific_errors() {
        let history = vec![
            entry(
                "q-new",
                &["c1"],
                Some(("zzz_code", remediation(&["c1"], None, None, None, None))),
                0.0,
            ),
            entry(
                "q-old",
                &["c1"],
                Some(("aaa_code", remediation(&["c1"], None, None, None, None))),
                0.0,
            ),
        ];
        let target = resolve_active_remediation(&history).expect("target");
        assert_eq!(target.error_code, "zzz_code");
    }

    #[test]
    fn error_without_remediation_metadata_is_ignored() {
        let mut history = vec![entry("q1", &["c1"], None, 0.0)];
        history[0].error_codes = vec![HistoryErrorCode {
            code: "generic_failure".to_owned(),
            remediation: None,
        }];
        assert!(resolve_active_remediation(&history).is_none());
    }

    #[test]
    fn duplicate_entries_do_not_multiply_policy_effects() {
        let one = entry(
            "q1",
            &["c1"],
            Some((
                "boundary_no_progress",
                remediation(&["c1"], None, None, None, None),
            )),
            0.0,
        );
        let history = vec![one.clone(), one];
        let target = resolve_active_remediation(&history).expect("target");
        assert_eq!(target.error_code, "boundary_no_progress");
    }

    #[test]
    fn fit_scores_concept_family_and_stage_matches() {
        let target = RemediationTarget {
            error_code: "e".to_owned(),
            question_id: "q".to_owned(),
            concept_ids: vec!["c1".to_owned()],
            node_id: None,
            family_id: Some("family-x".to_owned()),
            preferred_stage: Some(PedagogyStage::Trace),
            min_scaffold_level: Some(3),
        };
        let pedagogy = PedagogyMetadata {
            family_id: Some("family-x".to_owned()),
            stage: Some(PedagogyStage::Trace),
            scaffold_level: Some(0),
            transfer_group_id: None,
            surface_context: None,
            challenge_group_id: None,
        };

        let matching = fit(&target, Some(&pedagogy), &[concept("c1")]);
        assert!(matching.bonus >= 1.0);
        assert_eq!(matching.scaffold_floor, Some(3));

        let unrelated = fit(&target, None, &[concept("other")]);
        assert_eq!(unrelated.bonus, 0.0);
        assert_eq!(unrelated.scaffold_floor, None);
    }

    #[test]
    fn floor_only_remediation_falls_back_to_question_concepts() {
        let history = vec![entry(
            "q1",
            &["c1"],
            Some(("e", remediation(&[], None, None, None, Some(2)))),
            0.0,
        )];
        let target = resolve_active_remediation(&history).expect("target");
        assert_eq!(target.concept_ids, vec!["c1".to_owned()]);
        let fit = fit(&target, None, &[concept("c1")]);
        assert_eq!(fit.scaffold_floor, Some(2));
    }

    #[test]
    fn recovery_via_family_also_suppresses() {
        let error = entry(
            "q-error",
            &["c1"],
            Some(("e", remediation(&[], None, None, Some("family-x"), None))),
            0.0,
        );
        let mut success = later(entry("q-success", &["c-other"], None, 1.0));
        success.pedagogy = Some(PedagogyMetadata {
            family_id: Some("family-x".to_owned()),
            stage: None,
            scaffold_level: None,
            transfer_group_id: None,
            surface_context: None,
            challenge_group_id: None,
        });
        let history = vec![success, error];
        assert!(resolve_active_remediation(&history).is_none());
    }
}
