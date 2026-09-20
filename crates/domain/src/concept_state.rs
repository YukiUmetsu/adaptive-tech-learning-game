//! Derived per-concept learner state for the deterministic `heuristic-v1`
//! student model.
//!
//! `user_concept_state` is a cache, never ground truth: accepted
//! `learning_events` remain the authoritative evidence. This module defines how
//! a newly accepted observation updates that cache, and how retrieval is
//! estimated at selection time. Both are pure and deterministic so they are
//! cheap to test and safe to recompute.
//!
//! This is intentionally not called mastery and not a trained model. Recognition,
//! recall, application, and structural reconstruction are tracked as separate
//! evidence modes; each `(concept, assessment_mode)` pair is its own state row.
//! Later work (HLR/FSRS/DAS3H, prerequisite remediation through `KnowledgeNode`
//! concept ids) can replace the update function without changing the storage
//! contract.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::learning::{AssessmentMode, ConceptWeight};

/// Version tag stored with every derived state row.
pub const MODEL_VERSION: &str = "heuristic-v1";

/// Estimate for a concept that has no accepted evidence yet.
pub const PRIOR_ESTIMATE: f64 = 0.5;
/// Pseudo-evidence carried by the prior, so one observation cannot saturate a
/// concept and so confidence starts at zero.
pub const PRIOR_EVIDENCE: f64 = 1.0;
/// Base learning rate for one unit of weighted evidence.
pub const LEARNING_RATE: f64 = 0.5;
/// A hinted success is less informative than an unaided one.
pub const HINT_DISCOUNT: f64 = 0.2;
/// A recovery attempt after failure is worth less evidence than a first attempt.
pub const RECOVERY_DISCOUNT: f64 = 0.5;
/// Hard cap on how far a single observation can move an estimate.
pub const MAX_STEP: f64 = 0.4;
/// Evidence mass is capped so a derived row stays numerically well behaved.
pub const MAX_EVIDENCE_MASS: f64 = 100.0;
/// Hints above this are ignored, matching the API's accepted hint range.
pub const MAX_HINTS: i32 = 20;
/// A score at or above this counts as a success for the exposure counters.
pub const SUCCESS_THRESHOLD: f64 = 0.5;
/// Retention stability with no evidence mass, in days.
pub const BASE_STABILITY_DAYS: f64 = 2.0;
/// Extra retention stability contributed by each unit of evidence mass, in days.
pub const EVIDENCE_STABILITY_DAYS: f64 = 4.0;

/// Derived learner state for one `(user, certification version, concept,
/// assessment mode)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConceptState {
    /// Owning learner.
    pub user_id: Uuid,
    /// Certification version the concept belongs to.
    pub certification_version: String,
    /// Concept identifier, for example `aws.monitoring_vs_logging`.
    pub concept_id: String,
    /// Evidence mode this row measures.
    pub assessment_mode: AssessmentMode,
    /// Current estimate in `[0, 1]`.
    pub estimate: f64,
    /// Accumulated evidence mass. More mass means slower forgetting.
    pub evidence_mass: f64,
    /// Number of accepted observations applied, including recoveries.
    pub exposure_count: i32,
    /// Accepted observations at or above [`SUCCESS_THRESHOLD`].
    pub success_count: i32,
    /// Accepted observations below [`SUCCESS_THRESHOLD`].
    pub failure_count: i32,
    /// Most recent observation time.
    pub last_practiced_at: Option<DateTime<Utc>>,
    /// Most recent successful observation time.
    pub last_success_at: Option<DateTime<Utc>>,
    /// Update-model version that produced this row.
    pub model_version: String,
    /// Monotonic revision of this row.
    pub state_version: i32,
    /// Time this derived row was last written.
    pub updated_at: DateTime<Utc>,
}

/// One newly accepted piece of evidence about a single concept.
#[derive(Debug, Clone, PartialEq)]
pub struct ConceptObservation<'a> {
    /// Owning learner. Anonymous attempts never produce derived state.
    pub user_id: Uuid,
    /// Certification version the concept belongs to.
    pub certification_version: &'a str,
    /// Authored concept mapping, including its share of the question.
    pub concept: &'a ConceptWeight,
    /// Evidence mode this observation was collected in.
    pub assessment_mode: AssessmentMode,
    /// Server-scored partial score in `[0, 1]`.
    pub score: f64,
    /// Server-derived 1-based attempt number for the question.
    pub attempt_number: i32,
    /// Hints used before submitting.
    pub hint_count: i32,
    /// Server-recorded attempt time.
    pub occurred_at: DateTime<Utc>,
}

/// Applies one accepted observation to the derived state.
///
/// The update is a bounded, weighted move from the prior estimate toward the
/// observed score. Authored [`ConceptWeight`] scales how much evidence a
/// question contributes; hints discount a success; recovery attempts after a
/// failure contribute less. Duplicate suppression happens in persistence, not
/// here, because this function is pure.
pub fn update_concept_state(
    previous: Option<&ConceptState>,
    observation: &ConceptObservation<'_>,
) -> ConceptState {
    let weight = observation.concept.weight.clamp(0.0, 1.0);
    let hints = observation.hint_count.clamp(0, MAX_HINTS) as f64;
    let hint_factor = 1.0 / (1.0 + HINT_DISCOUNT * hints);
    let recovery_steps = (observation.attempt_number.max(1) - 1) as f64;
    let recovery_factor = 1.0 / (1.0 + RECOVERY_DISCOUNT * recovery_steps);

    // A hinted success is worth less than an unaided one, but a hinted failure
    // still counts as a failure.
    let observed = (observation.score.clamp(0.0, 1.0) * hint_factor).clamp(0.0, 1.0);
    let delta = (weight * hint_factor * recovery_factor).clamp(0.0, 1.0);
    let step = (LEARNING_RATE * delta).clamp(0.0, MAX_STEP);

    let prior_estimate = previous.map_or(PRIOR_ESTIMATE, |state| state.estimate);
    let prior_mass = previous.map_or(PRIOR_EVIDENCE, |state| state.evidence_mass);
    let estimate = (prior_estimate + step * (observed - prior_estimate)).clamp(0.0, 1.0);
    let evidence_mass = (prior_mass + delta).clamp(0.0, MAX_EVIDENCE_MASS);

    let success = observation.score >= SUCCESS_THRESHOLD;
    let exposure_count = previous
        .map_or(0, |state| state.exposure_count)
        .saturating_add(1);
    let mut success_count = previous.map_or(0, |state| state.success_count);
    let mut failure_count = previous.map_or(0, |state| state.failure_count);
    if success {
        success_count = success_count.saturating_add(1);
    } else {
        failure_count = failure_count.saturating_add(1);
    }

    let last_practiced_at = Some(latest(
        previous.and_then(|state| state.last_practiced_at),
        observation.occurred_at,
    ));
    let last_success_at = if success {
        Some(latest(
            previous.and_then(|state| state.last_success_at),
            observation.occurred_at,
        ))
    } else {
        previous.and_then(|state| state.last_success_at)
    };
    let updated_at = latest(
        previous.map(|state| state.updated_at),
        observation.occurred_at,
    );

    ConceptState {
        user_id: observation.user_id,
        certification_version: observation.certification_version.to_owned(),
        concept_id: observation.concept.concept_id.clone(),
        assessment_mode: observation.assessment_mode,
        estimate,
        evidence_mass,
        exposure_count,
        success_count,
        failure_count,
        last_practiced_at,
        last_success_at,
        model_version: MODEL_VERSION.to_owned(),
        state_version: previous.map_or(1, |state| state.state_version.saturating_add(1)),
        updated_at,
    }
}

/// Retention stability in days for an evidence mass.
///
/// More evidence decays more slowly. The value is monotonic in `evidence_mass`
/// and bounded by the evidence cap.
pub fn stability_days(evidence_mass: f64) -> f64 {
    let mass = evidence_mass.clamp(0.0, MAX_EVIDENCE_MASS);
    BASE_STABILITY_DAYS + EVIDENCE_STABILITY_DAYS * mass
}

/// Estimated probability the concept is still retrievable at `now`.
///
/// Decay is computed on read, never by mutating stored state over time. A row
/// with no practice time is treated as fully retrievable so a partial legacy
/// row is not penalized.
pub fn retrievability(
    evidence_mass: f64,
    last_practiced_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> f64 {
    let Some(last) = last_practiced_at else {
        return 1.0;
    };
    let elapsed_days = (now - last).num_minutes().max(0) as f64 / (60.0 * 24.0);
    let stability = stability_days(evidence_mass);
    (-elapsed_days / stability).exp().clamp(0.0, 1.0)
}

/// Probability mass the learner may have forgotten a previously learned
/// concept. Zero for a concept with no estimated knowledge.
pub fn forgetting_risk(
    estimate: f64,
    evidence_mass: f64,
    last_practiced_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> f64 {
    (estimate.clamp(0.0, 1.0) * (1.0 - retrievability(evidence_mass, last_practiced_at, now)))
        .clamp(0.0, 1.0)
}

/// Confidence in an estimate, in `[0, 1)`, derived from evidence mass.
pub fn confidence(evidence_mass: f64) -> f64 {
    let mass = evidence_mass.max(0.0);
    (mass / (mass + PRIOR_EVIDENCE)).clamp(0.0, 1.0)
}

/// Uncertainty in an estimate, in `(0, 1]`. More evidence means less
/// uncertainty.
pub fn uncertainty(evidence_mass: f64) -> f64 {
    (1.0 - confidence(evidence_mass)).clamp(0.0, 1.0)
}

/// Returns the later of an existing time and a new one.
fn latest(existing: Option<DateTime<Utc>>, candidate: DateTime<Utc>) -> DateTime<Utc> {
    match existing {
        Some(existing) if existing > candidate => existing,
        _ => candidate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hours_ago: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).unwrap() - chrono::Duration::hours(hours_ago)
    }

    fn concept(id: &str, weight: f64) -> ConceptWeight {
        ConceptWeight {
            concept_id: id.to_owned(),
            weight,
        }
    }

    fn observation<'a>(
        user_id: Uuid,
        concept: &'a ConceptWeight,
        mode: AssessmentMode,
        score: f64,
        attempt: i32,
        hints: i32,
        occurred_at: DateTime<Utc>,
    ) -> ConceptObservation<'a> {
        ConceptObservation {
            user_id,
            certification_version: "soa-c03",
            concept,
            assessment_mode: mode,
            score,
            attempt_number: attempt,
            hint_count: hints,
            occurred_at,
        }
    }

    #[test]
    fn cold_start_success_lands_above_and_failure_below_the_prior() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);

        let success = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );
        assert!(success.estimate > PRIOR_ESTIMATE);
        assert_eq!(success.exposure_count, 1);
        assert_eq!(success.success_count, 1);
        assert_eq!(success.failure_count, 0);
        assert_eq!(success.state_version, 1);
        assert_eq!(success.model_version, MODEL_VERSION);
        assert_eq!(success.assessment_mode, AssessmentMode::Recall);

        let failure = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 0.0, 1, 0, at(0)),
        );
        assert!(failure.estimate < PRIOR_ESTIMATE);
        assert_eq!(failure.failure_count, 1);
        assert_eq!(failure.success_count, 0);
    }

    #[test]
    fn concept_weight_scales_the_update() {
        let user = Uuid::new_v4();
        let full = concept("aws.route_tables", 1.0);
        let minor = concept("aws.route_tables", 0.25);

        let full_state = update_concept_state(
            None,
            &observation(user, &full, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );
        let minor_state = update_concept_state(
            None,
            &observation(user, &minor, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );

        assert!(
            full_state.estimate > minor_state.estimate,
            "a heavier concept weight must move the estimate further"
        );
        assert!(full_state.evidence_mass > minor_state.evidence_mass);
        // A zero-weight mapping contributes nothing.
        let zero = concept("aws.route_tables", 0.0);
        let zero_state = update_concept_state(
            None,
            &observation(user, &zero, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );
        assert_eq!(zero_state.estimate, PRIOR_ESTIMATE);
        assert_eq!(zero_state.evidence_mass, PRIOR_EVIDENCE);
    }

    #[test]
    fn hints_discount_a_success() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);
        let unaided = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );
        let hinted = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 3, at(0)),
        );
        assert!(
            hinted.estimate < unaided.estimate,
            "hints must reduce the value of a success"
        );
        assert!(hinted.evidence_mass < unaided.evidence_mass);
    }

    #[test]
    fn recovery_attempts_are_discounted() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);
        let first = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );
        let recovery = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 3, 0, at(0)),
        );
        assert!(
            recovery.estimate < first.estimate,
            "recovery evidence must be weaker than first-attempt evidence"
        );
        assert!(recovery.evidence_mass < first.evidence_mass);
    }

    #[test]
    fn assessment_modes_keep_separate_state() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);

        let recognition = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recognition, 1.0, 1, 0, at(0)),
        );
        let recall = update_concept_state(
            Some(&recognition),
            &observation(user, &c, AssessmentMode::Recall, 0.0, 1, 0, at(1)),
        );

        // The recall row mirrors the recognition estimate but is a distinct row.
        assert_eq!(recall.assessment_mode, AssessmentMode::Recall);
        assert_eq!(recognition.assessment_mode, AssessmentMode::Recognition);
        // A failure in recall must not have been applied to the recognition row.
        assert!(recognition.estimate > PRIOR_ESTIMATE);
        assert!(recall.estimate < recognition.estimate);
        assert_eq!(recall.concept_id, recognition.concept_id);
    }

    #[test]
    fn estimates_and_evidence_mass_stay_bounded() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);
        let mut state = None;

        for step in 0..500 {
            let score = if step % 2 == 0 { 1.0 } else { 0.0 };
            let next = update_concept_state(
                state.as_ref(),
                &observation(user, &c, AssessmentMode::Recall, score, 1, 0, at(step)),
            );
            assert!((0.0..=1.0).contains(&next.estimate));
            assert!(next.evidence_mass >= 0.0);
            assert!(next.evidence_mass <= MAX_EVIDENCE_MASS);
            state = Some(next);
        }
    }

    #[test]
    fn more_evidence_decays_more_slowly() {
        let user = Uuid::new_v4();
        let c = concept("aws.route_tables", 1.0);
        let now = at(-24 * 20); // twenty days after the observations below.

        let thin = update_concept_state(
            None,
            &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 0, at(0)),
        );

        let mut fat = Some(thin.clone());
        for step in 1..10 {
            fat = Some(update_concept_state(
                fat.as_ref(),
                &observation(user, &c, AssessmentMode::Recall, 1.0, 1, 0, at(step)),
            ));
        }
        let fat = fat.expect("state");

        assert!(fat.evidence_mass > thin.evidence_mass);
        assert!(
            retrievability(fat.evidence_mass, fat.last_practiced_at, now)
                > retrievability(thin.evidence_mass, thin.last_practiced_at, now),
            "more evidence must decay more slowly"
        );
    }

    #[test]
    fn retrievability_and_risk_move_in_the_expected_directions() {
        let now = at(-24 * 10);
        let fresh = retrievability(5.0, Some(at(0)), at(0));
        let stale = retrievability(5.0, Some(at(24 * 9)), now);
        assert_eq!(fresh, 1.0);
        assert!(stale < fresh);
        assert!(stale > 0.0);

        let just_practiced = forgetting_risk(0.9, 5.0, Some(at(0)), at(0));
        let long_delayed = forgetting_risk(0.9, 5.0, Some(at(24 * 60)), at(0));
        assert_eq!(just_practiced, 0.0);
        assert!(long_delayed > just_practiced);
        assert!(long_delayed <= 0.9);
    }

    #[test]
    fn confidence_grows_with_evidence() {
        assert_eq!(uncertainty(0.0), 1.0);
        assert!(uncertainty(1.0) < uncertainty(0.1));
        assert!(uncertainty(20.0) < 0.1);
        assert_eq!(confidence(0.0), 0.0);
    }
}
