//! Knowledge Signal derivation.
//!
//! "Knowledge Signal" is a coarse, non-judgmental visualization of learner
//! progress. It is explicitly **not** mastery: it never exposes raw model
//! probabilities, percentages, pass chances, or negative labels to the UI.
//!
//! Three independent dimensions are derived deterministically from existing
//! state:
//!
//! - **Discovery** (computed by the caller from discovery progress): whether the
//!   learner explored the node's learning content.
//! - **Evidence level**: how much scored evidence the node's concepts have
//!   accumulated, from evidence mass.
//! - **Freshness**: whether that evidence is still retrievable now, from
//!   `heuristic-v1` retrievability.
//!
//! Assessment modes stay separate: each mode contributes its own signal, so
//! strength in recognition never hides weakness in application.

use std::collections::BTreeMap;

use adaptive_learn_domain::{AssessmentMode, retrievability};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::planner::ConceptStateView;

/// Total evidence mass below which a node shows only an early signal.
const EARLY_EVIDENCE_MASS: f64 = 4.0;
/// Total evidence mass at or above which a node shows a substantial signal.
const DEVELOPING_EVIDENCE_MASS: f64 = 12.0;
/// Retrievability at or above which evidence counts as fresh.
const FRESH_RETRIEVABILITY: f64 = 0.8;
/// Retrievability at or below which review is likely useful.
const BECOMING_DUE_RETRIEVABILITY: f64 = 0.6;
/// Minimum evidence mass before a freshness judgement is meaningful.
const MIN_FRESHNESS_EVIDENCE_MASS: f64 = 2.0;

/// Coarse evidence level for a node or one assessment mode.
///
/// This is an amount-of-evidence signal, never a mastery claim. A node with
/// little evidence looks "early", not deficient.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLevel {
    /// No scored evidence yet.
    None,
    /// A small amount of scored evidence.
    Early,
    /// A developing amount of scored evidence.
    Developing,
    /// A substantial amount of scored evidence.
    Substantial,
}

/// Coarse freshness signal, used only for the outer ring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessState {
    /// Not enough evidence to judge, or no evidence at all.
    Unknown,
    /// Still easily retrievable.
    Fresh,
    /// Starting to decay; a review will soon be useful.
    BecomingDue,
    /// Retrieval is likely to have decayed; a review would help.
    Due,
}

/// One assessment mode's signal for a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModeSignal {
    /// Evidence mode this signal measures.
    pub assessment_mode: AssessmentMode,
    /// Amount-of-evidence level in this mode.
    pub evidence_level: EvidenceLevel,
    /// Freshness of the evidence in this mode.
    pub freshness_state: FreshnessState,
}

/// The combined signal for one knowledge node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct NodeSignal {
    /// Amount of scored evidence across the node's concepts.
    pub evidence_level: EvidenceLevel,
    /// Freshness of that evidence.
    pub freshness_state: FreshnessState,
    /// Per-assessment-mode signals, present only for modes with evidence.
    pub mode_signals: Vec<ModeSignal>,
}

impl NodeSignal {
    /// A neutral signal for a node with no evidence.
    pub const fn none() -> Self {
        Self {
            evidence_level: EvidenceLevel::None,
            freshness_state: FreshnessState::Unknown,
            mode_signals: Vec::new(),
        }
    }
}

/// Maps a total evidence mass to a coarse level.
fn evidence_level(mass: f64) -> EvidenceLevel {
    if mass <= 0.0 {
        EvidenceLevel::None
    } else if mass < EARLY_EVIDENCE_MASS {
        EvidenceLevel::Early
    } else if mass < DEVELOPING_EVIDENCE_MASS {
        EvidenceLevel::Developing
    } else {
        EvidenceLevel::Substantial
    }
}

/// Maps the weakest retrievability of a set of states to a freshness state.
fn freshness_state(states: &[&ConceptStateView], now: DateTime<Utc>) -> FreshnessState {
    let mut weakest: Option<f64> = None;
    for state in states {
        if state.evidence_mass < MIN_FRESHNESS_EVIDENCE_MASS {
            continue;
        }
        let retrieval = retrievability(state.evidence_mass, state.last_practiced_at, now);
        weakest = Some(weakest.map_or(retrieval, |current| current.min(retrieval)));
    }
    match weakest {
        None => FreshnessState::Unknown,
        Some(retrieval) if retrieval >= FRESH_RETRIEVABILITY => FreshnessState::Fresh,
        Some(retrieval) if retrieval > BECOMING_DUE_RETRIEVABILITY => FreshnessState::BecomingDue,
        Some(_) => FreshnessState::Due,
    }
}

/// Canonical display order for assessment modes (declaration order).
fn mode_order(mode: AssessmentMode) -> u8 {
    match mode {
        AssessmentMode::Recognition => 0,
        AssessmentMode::Recall => 1,
        AssessmentMode::Application => 2,
        AssessmentMode::StructuralReconstruction => 3,
        AssessmentMode::RelationshipRecall => 4,
        AssessmentMode::ProceduralRecall => 5,
    }
}

/// Derives the Knowledge Signal for a node from its concepts' state.
///
/// Unknown concepts contribute nothing. Modes are ordered by their canonical
/// declaration order so the result is deterministic.
pub fn derive_node_signal(
    concept_ids: &[String],
    states: &[ConceptStateView],
    now: DateTime<Utc>,
) -> NodeSignal {
    if concept_ids.is_empty() {
        return NodeSignal::none();
    }

    let relevant: Vec<&ConceptStateView> = states
        .iter()
        .filter(|state| concept_ids.iter().any(|id| id == &state.concept_id))
        .collect();
    if relevant.is_empty() {
        return NodeSignal::none();
    }

    let total_mass: f64 = relevant.iter().map(|state| state.evidence_mass).sum();

    let mut by_mode: BTreeMap<u8, Vec<&ConceptStateView>> = BTreeMap::new();
    for state in &relevant {
        by_mode
            .entry(mode_order(state.assessment_mode))
            .or_default()
            .push(state);
    }

    let mode_signals: Vec<ModeSignal> = by_mode
        .into_values()
        .map(|mode_states| {
            let mass: f64 = mode_states.iter().map(|state| state.evidence_mass).sum();
            ModeSignal {
                assessment_mode: mode_states[0].assessment_mode,
                evidence_level: evidence_level(mass),
                freshness_state: freshness_state(&mode_states, now),
            }
        })
        .collect();

    NodeSignal {
        evidence_level: evidence_level(total_mass),
        freshness_state: freshness_state(&relevant, now),
        mode_signals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adaptive_learn_domain::AssessmentMode;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn state(concept_id: &str, mode: AssessmentMode, mass: f64, days_ago: i64) -> ConceptStateView {
        ConceptStateView {
            concept_id: concept_id.to_owned(),
            assessment_mode: mode,
            estimate: 0.7,
            evidence_mass: mass,
            exposure_count: 1,
            last_practiced_at: Some(now() - chrono::Duration::days(days_ago)),
        }
    }

    #[test]
    fn no_state_is_a_neutral_signal() {
        let signal = derive_node_signal(&["c1".to_owned()], &[], now());
        assert_eq!(signal, NodeSignal::none());
        assert!(signal.mode_signals.is_empty());
    }

    #[test]
    fn unrelated_state_does_not_light_a_node() {
        let states = vec![state("other", AssessmentMode::Recall, 20.0, 0)];
        assert_eq!(
            derive_node_signal(&["c1".to_owned()], &states, now()),
            NodeSignal::none()
        );
    }

    #[test]
    fn evidence_level_grows_with_mass() {
        let early = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 1.5, 0)],
            now(),
        );
        let developing = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 6.0, 0)],
            now(),
        );
        let substantial = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 20.0, 0)],
            now(),
        );

        assert_eq!(early.evidence_level, EvidenceLevel::Early);
        assert_eq!(developing.evidence_level, EvidenceLevel::Developing);
        assert_eq!(substantial.evidence_level, EvidenceLevel::Substantial);
    }

    #[test]
    fn stale_strong_knowledge_keeps_its_evidence_level() {
        let signal = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 20.0, 120)],
            now(),
        );
        // The node still reads as substantial; only the outer freshness changes.
        assert_eq!(signal.evidence_level, EvidenceLevel::Substantial);
        assert_eq!(signal.freshness_state, FreshnessState::Due);
    }

    #[test]
    fn freshness_moves_from_fresh_to_due_over_time() {
        let fresh = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 6.0, 0)],
            now(),
        );
        let due = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 6.0, 120)],
            now(),
        );
        assert_eq!(fresh.freshness_state, FreshnessState::Fresh);
        assert_eq!(due.freshness_state, FreshnessState::Due);
    }

    #[test]
    fn low_evidence_has_no_freshness_judgement() {
        let signal = derive_node_signal(
            &["c1".to_owned()],
            &[state("c1", AssessmentMode::Recall, 1.0, 0)],
            now(),
        );
        assert_eq!(signal.freshness_state, FreshnessState::Unknown);
    }

    #[test]
    fn modes_stay_separate_and_ordered() {
        let states = vec![
            state("c1", AssessmentMode::Recall, 20.0, 0),
            state("c1", AssessmentMode::Recognition, 1.0, 0),
            state("c1", AssessmentMode::Application, 6.0, 0),
        ];
        let signal = derive_node_signal(&["c1".to_owned()], &states, now());

        let modes: Vec<_> = signal
            .mode_signals
            .iter()
            .map(|mode| (mode.assessment_mode, mode.evidence_level))
            .collect();
        assert_eq!(
            modes,
            vec![
                (AssessmentMode::Recognition, EvidenceLevel::Early),
                (AssessmentMode::Recall, EvidenceLevel::Substantial),
                (AssessmentMode::Application, EvidenceLevel::Developing),
            ]
        );
    }

    #[test]
    fn a_single_stale_mode_marks_the_node_due() {
        let states = vec![
            state("c1", AssessmentMode::Recall, 20.0, 0),
            state("c1", AssessmentMode::Application, 20.0, 200),
        ];
        let signal = derive_node_signal(&["c1".to_owned()], &states, now());
        assert_eq!(signal.freshness_state, FreshnessState::Due);
    }
}
