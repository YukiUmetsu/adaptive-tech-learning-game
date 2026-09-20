//! Pure evaluation metrics and `heuristic-v1` prediction aggregation.
//!
//! Two separate concerns live here, both pure and testable without a database:
//!
//! 1. [`predict_question`] turns pre-answer concept state into one predicted
//!    score per question. It never looks at the answer, the score, structured
//!    errors, response time, or post-answer state, so there is no target
//!    leakage.
//! 2. [`evaluate`] computes calibration metrics (Brier, log loss, means, and
//!    calibration buckets) over resolved prediction/outcome pairs.
//!
//! These metrics measure the model; they are not the model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::concept_state::{
    ConceptState, PRIOR_ESTIMATE, forgetting_risk, retrievability, uncertainty,
};
use crate::learning::{AssessmentMode, ConceptWeight};

/// Probability clamp for log loss so a perfectly wrong prediction stays finite.
const LOG_LOSS_EPSILON: f64 = 1e-15;

/// One resolved prediction/outcome pair.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PredictionSample {
    /// Predicted probability of success in `[0, 1]`.
    pub predicted: f64,
    /// Observed score in `[0, 1]`.
    pub observed: f64,
}

impl PredictionSample {
    /// Clamps both values into `[0, 1]`.
    pub fn new(predicted: f64, observed: f64) -> Self {
        Self {
            predicted: predicted.clamp(0.0, 1.0),
            observed: observed.clamp(0.0, 1.0),
        }
    }

    fn squared_error(self) -> f64 {
        let difference = self.predicted - self.observed;
        difference * difference
    }

    fn log_loss(self) -> f64 {
        let probability = self
            .predicted
            .clamp(LOG_LOSS_EPSILON, 1.0 - LOG_LOSS_EPSILON);
        -(self.observed * probability.ln() + (1.0 - self.observed) * (1.0 - probability).ln())
    }
}

/// Mean squared error between predicted probability and observed score.
pub fn brier_score(samples: &[PredictionSample]) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let total: f64 = samples.iter().map(|sample| sample.squared_error()).sum();
    Some(total / samples.len() as f64)
}

/// Mean binary log loss.
pub fn log_loss(samples: &[PredictionSample]) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let total: f64 = samples.iter().map(|sample| sample.log_loss()).sum();
    Some(total / samples.len() as f64)
}

/// Mean predicted probability.
pub fn mean_prediction(samples: &[PredictionSample]) -> Option<f64> {
    mean(samples, |sample| sample.predicted)
}

/// Mean observed score.
pub fn mean_observed(samples: &[PredictionSample]) -> Option<f64> {
    mean(samples, |sample| sample.observed)
}

fn mean(samples: &[PredictionSample], value: impl Fn(PredictionSample) -> f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let total: f64 = samples.iter().map(|sample| value(*sample)).sum();
    Some(total / samples.len() as f64)
}

/// One equal-width calibration bucket.
#[derive(Debug, Clone, PartialEq)]
pub struct CalibrationBucket {
    /// Inclusive lower bound.
    pub lower: f64,
    /// Exclusive upper bound, except for the final bucket.
    pub upper: f64,
    /// Number of samples in the bucket.
    pub count: usize,
    /// Mean predicted probability in the bucket.
    pub mean_prediction: f64,
    /// Mean observed score in the bucket.
    pub mean_observed: f64,
}

impl CalibrationBucket {
    /// Short label such as `0.6-0.7`.
    pub fn label(&self) -> String {
        format!("{:.1}-{:.1}", self.lower, self.upper)
    }
}

/// Equal-width calibration buckets over `[0, 1]`, omitting empty buckets.
pub fn calibration_buckets(
    samples: &[PredictionSample],
    bucket_count: usize,
) -> Vec<CalibrationBucket> {
    let buckets = bucket_count.max(1);
    let mut grouped: Vec<Vec<PredictionSample>> = vec![Vec::new(); buckets];

    for sample in samples {
        let mut index = (sample.predicted * buckets as f64).floor() as usize;
        if index >= buckets {
            index = buckets - 1;
        }
        grouped[index].push(*sample);
    }

    grouped
        .into_iter()
        .enumerate()
        .filter_map(|(index, group)| {
            if group.is_empty() {
                return None;
            }
            let width = 1.0 / buckets as f64;
            Some(CalibrationBucket {
                lower: index as f64 * width,
                upper: (index + 1) as f64 * width,
                count: group.len(),
                mean_prediction: mean(&group, |sample| sample.predicted).unwrap_or(0.0),
                mean_observed: mean(&group, |sample| sample.observed).unwrap_or(0.0),
            })
        })
        .collect()
}

/// Aggregate evaluation result over one set of samples.
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationSummary {
    /// Number of resolved samples.
    pub samples: usize,
    /// Brier score, when there is at least one sample.
    pub brier_score: Option<f64>,
    /// Log loss, when there is at least one sample.
    pub log_loss: Option<f64>,
    /// Mean predicted probability.
    pub mean_prediction: Option<f64>,
    /// Mean observed score.
    pub mean_observed: Option<f64>,
    /// Calibration buckets.
    pub calibration: Vec<CalibrationBucket>,
}

/// Computes the full evaluation summary.
pub fn evaluate(samples: &[PredictionSample], bucket_count: usize) -> EvaluationSummary {
    EvaluationSummary {
        samples: samples.len(),
        brier_score: brier_score(samples),
        log_loss: log_loss(samples),
        mean_prediction: mean_prediction(samples),
        mean_observed: mean_observed(samples),
        calibration: calibration_buckets(samples, bucket_count),
    }
}

/// Per-concept contribution to a question prediction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConceptPrediction {
    /// Concept identifier.
    pub concept_id: String,
    /// Authored share of the question attributed to this concept.
    pub weight: f64,
    /// Estimate used for this concept in the question's assessment mode.
    pub estimate: f64,
    /// Evidence mass used.
    pub evidence_mass: f64,
    /// Retrievability at prediction time.
    pub retrievability: f64,
    /// Uncertainty of the estimate.
    pub uncertainty: f64,
    /// Forgetting risk at prediction time.
    pub forgetting_risk: f64,
    /// Most recent practice, when known.
    pub last_practiced_at: Option<DateTime<Utc>>,
}

/// One question's pre-answer prediction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QuestionPrediction {
    /// Predicted probability of success in `[0, 1]`.
    pub predicted_score: f64,
    /// Per-concept detail used to build the prediction.
    pub concepts: Vec<ConceptPrediction>,
    /// Seconds since the most recent practice of any contributing concept.
    pub seconds_since_previous_practice: Option<i64>,
}

/// Predicts one question's score from pre-answer concept state.
///
/// Aggregation is deterministic: the predicted score is the authored-weight
/// average of the mode-specific concept estimates. A concept with no state in
/// the question's assessment mode contributes the neutral prior, which keeps
/// recognition and recall evidence separate. Only information available before
/// the answer is read.
pub fn predict_question(
    concepts: &[ConceptWeight],
    mode: AssessmentMode,
    states: &[ConceptState],
    now: DateTime<Utc>,
) -> QuestionPrediction {
    let mut weight_sum = 0.0;
    let mut weighted_estimate = 0.0;
    let mut detail = Vec::with_capacity(concepts.len());
    let mut seconds_since: Option<i64> = None;

    for concept in concepts {
        let weight = concept.weight.clamp(0.0, 1.0);
        if weight <= 0.0 {
            continue;
        }
        let state = states
            .iter()
            .find(|state| state.concept_id == concept.concept_id && state.assessment_mode == mode);

        let (estimate, mass, last, retrieval, uncertain, risk) = match state {
            Some(state) => {
                let retrieval = retrievability(state.evidence_mass, state.last_practiced_at, now);
                let risk = forgetting_risk(
                    state.estimate,
                    state.evidence_mass,
                    state.last_practiced_at,
                    now,
                );
                (
                    state.estimate.clamp(0.0, 1.0),
                    state.evidence_mass,
                    state.last_practiced_at,
                    retrieval,
                    uncertainty(state.evidence_mass),
                    risk,
                )
            }
            None => (PRIOR_ESTIMATE, 0.0, None, 1.0, 1.0, 0.0),
        };

        if let Some(last) = last {
            let elapsed = (now - last).num_seconds().max(0);
            seconds_since = Some(seconds_since.map_or(elapsed, |current| current.min(elapsed)));
        }

        weight_sum += weight;
        weighted_estimate += weight * estimate;
        detail.push(ConceptPrediction {
            concept_id: concept.concept_id.clone(),
            weight,
            estimate,
            evidence_mass: mass,
            retrievability: retrieval,
            uncertainty: uncertain,
            forgetting_risk: risk,
            last_practiced_at: last,
        });
    }

    let predicted_score = if weight_sum > 0.0 {
        (weighted_estimate / weight_sum).clamp(0.0, 1.0)
    } else {
        PRIOR_ESTIMATE
    };

    QuestionPrediction {
        predicted_score,
        concepts: detail,
        seconds_since_previous_practice: seconds_since,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn state(concept_id: &str, mode: AssessmentMode, estimate: f64, mass: f64) -> ConceptState {
        ConceptState {
            user_id: uuid::Uuid::nil(),
            certification_version: "v1".to_owned(),
            concept_id: concept_id.to_owned(),
            assessment_mode: mode,
            estimate,
            evidence_mass: mass,
            exposure_count: 1,
            success_count: 1,
            failure_count: 0,
            last_practiced_at: Some(now() - chrono::Duration::days(10)),
            last_success_at: Some(now() - chrono::Duration::days(10)),
            model_version: "heuristic-v1".to_owned(),
            state_version: 1,
            updated_at: now() - chrono::Duration::days(10),
        }
    }

    #[test]
    fn brier_and_log_loss_are_correct() {
        let samples = vec![
            PredictionSample::new(0.8, 1.0),
            PredictionSample::new(0.2, 0.0),
            PredictionSample::new(0.5, 1.0),
        ];
        // (0.04 + 0.04 + 0.25) / 3
        assert!((brier_score(&samples).unwrap() - 0.11).abs() < 1e-9);
        assert!(log_loss(&samples).unwrap() > 0.0);
        assert_eq!(mean_prediction(&samples).unwrap(), 0.5);
        assert!((mean_observed(&samples).unwrap() - 2.0 / 3.0).abs() < 1e-9);
        assert!(brier_score(&[]).is_none());
        assert!(log_loss(&[]).is_none());
    }

    #[test]
    fn calibration_buckets_group_by_prediction() {
        let samples = vec![
            PredictionSample::new(0.05, 0.0),
            PredictionSample::new(0.65, 1.0),
            PredictionSample::new(0.67, 0.0),
        ];
        let buckets = calibration_buckets(&samples, 5);
        assert_eq!(buckets.len(), 2);
        let low = &buckets[0];
        assert_eq!(low.count, 1);
        let mid = &buckets[1];
        assert_eq!(mid.count, 2);
        assert!((mid.mean_prediction - 0.66).abs() < 1e-9);
        assert!((mid.mean_observed - 0.5).abs() < 1e-9);
        assert_eq!(mid.label(), "0.6-0.8");
    }

    #[test]
    fn prediction_is_weighted_and_mode_specific() {
        let concepts = vec![
            ConceptWeight {
                concept_id: "a".to_owned(),
                weight: 0.75,
            },
            ConceptWeight {
                concept_id: "b".to_owned(),
                weight: 0.25,
            },
        ];
        let states = vec![
            state("a", AssessmentMode::Recall, 0.9, 6.0),
            state("b", AssessmentMode::Recognition, 0.1, 6.0),
        ];

        // In recall, only `a` has mode-specific evidence; `b` falls back to prior.
        let recall = predict_question(&concepts, AssessmentMode::Recall, &states, now());
        let expected = 0.75 * 0.9 + 0.25 * PRIOR_ESTIMATE;
        assert!((recall.predicted_score - expected).abs() < 1e-9);
        assert_eq!(recall.concepts.len(), 2);
        assert_eq!(recall.concepts[1].estimate, PRIOR_ESTIMATE);
        assert!(recall.seconds_since_previous_practice.is_some());
    }

    #[test]
    fn prediction_without_state_uses_prior() {
        let concepts = vec![ConceptWeight {
            concept_id: "unknown".to_owned(),
            weight: 1.0,
        }];
        let prediction = predict_question(&concepts, AssessmentMode::Application, &[], now());
        assert_eq!(prediction.predicted_score, PRIOR_ESTIMATE);
        assert!(prediction.seconds_since_previous_practice.is_none());
    }

    #[test]
    fn prediction_is_deterministic() {
        let concepts = vec![ConceptWeight {
            concept_id: "a".to_owned(),
            weight: 1.0,
        }];
        let states = vec![state("a", AssessmentMode::Recall, 0.4, 3.0)];
        let first = predict_question(&concepts, AssessmentMode::Recall, &states, now());
        for _ in 0..5 {
            assert_eq!(
                predict_question(&concepts, AssessmentMode::Recall, &states, now()),
                first
            );
        }
    }
}
