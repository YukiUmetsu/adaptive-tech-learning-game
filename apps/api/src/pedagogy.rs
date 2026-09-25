//! Track-agnostic pedagogical fit for question selection (Phase 2).
//!
//! This module is the single source of the *teaching-policy* logic that turns
//! the optional authored [`adaptive_learn_domain::PedagogyMetadata`] into a
//! small, bounded ranking contribution. It is intentionally pure and
//! deterministic so every selector (quick quiz, domain quiz, full practice,
//! section quiz, recommended practice, study session, Daily Mission, and the
//! next-action planner) can share the same policy.
//!
//! Two things must stay separate:
//!
//! - the **student model** (`heuristic-v1`) answers "what does the learner
//!   probably know right now?" from concept estimates and evidence mass;
//! - this **teaching policy** answers "what form of activity is most useful
//!   next?" from authored pedagogy metadata plus the same state.
//!
//! Scaffold level is help embedded in an activity; it is not difficulty. This
//! module never changes [`adaptive_learn_domain::ConceptWeight::weight`],
//! difficulty, mastery, scoring, or rewards. It only adds a bounded preference.
//!
//! Every `*_id` and `surface_context` value is treated as an opaque authored
//! string. Nothing here branches on a track name, so DSA, Python, AWS,
//! Terraform, security, ML, and future tracks all use the same policy.
//!
//! When a question carries no pedagogy metadata the contribution is a constant
//! neutral value, so an all-old bank ranks exactly as it did before Phase 2.

use std::collections::{HashMap, HashSet};

use adaptive_learn_domain::{
    PEDAGOGY_MAX_SCAFFOLD_LEVEL, PEDAGOGY_STAGE_COUNT, PedagogyMetadata, PedagogyStage,
};

use crate::selection::HistoryEntry;

/// Highest authored scaffold level, as `f64` for distance math.
const MAX_SCAFFOLD: f64 = PEDAGOGY_MAX_SCAFFOLD_LEVEL as f64;
/// Highest pedagogy-stage ordinal, as `f64` for distance math.
const MAX_STAGE: f64 = (PEDAGOGY_STAGE_COUNT - 1) as f64;

/// Weight of scaffold appropriateness in the rank.
///
/// Small on purpose: scaffold fit nudges the ordering, it never overrides
/// concept weakness, forgetting, or difficulty.
pub const WEIGHT_SCAFFOLD_FIT: f64 = 0.08;
/// Weight of transfer-context novelty in the rank.
pub const WEIGHT_TRANSFER_CONTEXT: f64 = 0.05;
/// Weight of pedagogy-stage appropriateness in the rank.
pub const WEIGHT_STAGE_FIT: f64 = 0.04;
/// Penalty for repeating a surface context just practiced in the same group.
pub const PENALTY_SURFACE_REPEAT: f64 = 0.06;

/// How many scaffold levels a *clean* success may fade in one step.
///
/// After a first-attempt, unaided success the preferred support drops by at
/// most one level, so a learner never jumps from heavily guided to cold.
const SCAFFOLD_FADE_STEP: f64 = 1.0;
/// How many scaffold levels a recent failure raises the preferred support.
///
/// Asymmetric with fading: allowing support back in generously is supportive,
/// not punitive. It never resets concept mastery or repeats the same question.
const SCAFFOLD_SUPPORT_STEP: f64 = 2.0;
/// A score at or above this counts as a success (mirrors the domain threshold).
const SUCCESS_SCORE: f64 = 0.5;
/// How many recent attempts count as "recent practice" for context variety.
const CONTEXT_WINDOW: usize = 12;
/// Neutral fit used when the candidate is missing the relevant metadata.
///
/// Chosen at the midpoint so metadata-bearing and legacy questions are not
/// systematically rewarded or punished for having (or lacking) a field.
const NEUTRAL_FIT: f64 = 0.5;

/// The bounded pedagogical contribution to a candidate's rank.
///
/// Each component is in `[0, 1]` (components are never negative; repetition is
/// expressed as a penalty component). Use [`PedagogySignal::total`] for the
/// weighted, bounded contribution.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PedagogySignal {
    /// How well the authored scaffold level matches the learner's readiness.
    pub scaffold_fit: f64,
    /// Whether the candidate offers a novel surface context in its group.
    pub transfer_bonus: f64,
    /// Whether the candidate repeats a recently practiced surface context.
    pub surface_repeat_penalty: f64,
    /// How well the authored pedagogy stage matches the learner's readiness.
    pub stage_fit: f64,
}

impl PedagogySignal {
    /// The signal used when no pedagogy metadata is present or relevant.
    pub const NEUTRAL: PedagogySignal = PedagogySignal {
        scaffold_fit: NEUTRAL_FIT,
        transfer_bonus: 0.0,
        surface_repeat_penalty: 0.0,
        stage_fit: NEUTRAL_FIT,
    };

    /// Weighted, bounded contribution added to a candidate's rank.
    ///
    /// Bounded to `[-PENALTY_SURFACE_REPEAT, WEIGHT_SCAFFOLD_FIT +
    /// WEIGHT_TRANSFER_CONTEXT + WEIGHT_STAGE_FIT]`, which keeps existing
    /// weakness/forgetting/difficulty signals dominant.
    pub fn total(self) -> f64 {
        (WEIGHT_SCAFFOLD_FIT * self.scaffold_fit.clamp(0.0, 1.0)
            + WEIGHT_TRANSFER_CONTEXT * self.transfer_bonus.clamp(0.0, 1.0)
            + WEIGHT_STAGE_FIT * self.stage_fit.clamp(0.0, 1.0)
            - PENALTY_SURFACE_REPEAT * self.surface_repeat_penalty.clamp(0.0, 1.0))
        .clamp(
            -PENALTY_SURFACE_REPEAT,
            WEIGHT_SCAFFOLD_FIT + WEIGHT_TRANSFER_CONTEXT + WEIGHT_STAGE_FIT,
        )
    }
}

/// The most recent attempt seen in one authored `family_id`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct FamilyAttempt {
    scaffold_level: Option<u8>,
    success: bool,
    /// First attempt with no hints: the signal that may fade scaffolding.
    clean_success: bool,
}

/// Recently practiced surface contexts for one transfer group (or family).
#[derive(Debug, Clone, Default, PartialEq)]
struct GroupContext {
    /// Surface contexts seen in the recent window.
    recent_surfaces: HashSet<String>,
    /// At least one recent success in the group (any support level).
    recent_success: bool,
}

/// A deterministic summary of the pedagogy metadata and outcomes in recent
/// accepted history, built once per selection call.
#[derive(Debug, Clone, Default)]
pub struct RecentPedagogy {
    /// Newest attempt per authored family.
    family: HashMap<String, FamilyAttempt>,
    /// Newest-window context history per transfer group (falling back to family).
    groups: HashMap<String, GroupContext>,
}

impl RecentPedagogy {
    /// Summarizes the newest-first history.
    ///
    /// Only authored pedagogy metadata and the accepted score/attempt/hint
    /// fields are read; the join to canonical content happens before this call,
    /// so no duplicate metadata is persisted on learning events.
    pub fn build(history: &[HistoryEntry]) -> Self {
        let mut recent = RecentPedagogy::default();

        for (index, entry) in history.iter().enumerate() {
            let Some(pedagogy) = &entry.pedagogy else {
                continue;
            };
            let success = entry.score >= SUCCESS_SCORE;
            let clean_success = success && entry.attempt_number <= 1 && entry.hint_count <= 0;

            if let Some(family) = non_blank(pedagogy.family_id.as_deref()) {
                recent
                    .family
                    .entry(family.to_owned())
                    .or_insert(FamilyAttempt {
                        scaffold_level: pedagogy.scaffold_level,
                        success,
                        clean_success,
                    });
            }

            if index < CONTEXT_WINDOW {
                if let Some(group) = group_key(pedagogy) {
                    let context = recent.groups.entry(group.to_owned()).or_default();
                    if let Some(surface) = non_blank(pedagogy.surface_context.as_deref()) {
                        context.recent_surfaces.insert(surface.to_owned());
                    }
                    context.recent_success = context.recent_success || success;
                }
            }
        }

        recent
    }
}

/// The authored transfer group of a question, falling back to its family.
///
/// Both are opaque strings; the caller never inspects their contents.
fn group_key(pedagogy: &PedagogyMetadata) -> Option<&str> {
    non_blank(pedagogy.transfer_group_id.as_deref())
        .or_else(|| non_blank(pedagogy.family_id.as_deref()))
}

/// Returns a trimmed reference when a value carries real content.
fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// How ready the learner looks for less support, in `[0, 1]`.
///
/// An optimistic estimate is gated by confidence so "high estimate on thin
/// evidence" stays *developing* rather than *strong*. This reuses the existing
/// `heuristic-v1` estimate and evidence-derived uncertainty; it is not a new
/// mastery model.
fn readiness(estimate: f64, uncertainty: f64) -> f64 {
    let confidence = (1.0 - uncertainty).clamp(0.0, 1.0);
    (estimate.clamp(0.0, 1.0) * (0.5 + 0.5 * confidence)).clamp(0.0, 1.0)
}

/// The scaffold level best matched to the learner right now.
///
/// The base target comes from readiness (weak learners prefer more embedded
/// help, strong learners prefer less). Recent same-family evidence adjusts it:
///
/// - a clean success caps the drop to one level below what succeeded;
/// - a hinted/recovery success caps the drop at the level that succeeded, so it
///   fades less aggressively;
/// - a recent failure raises the target, allowing more support back in.
///
/// A missing `family_id` or missing scaffold level skips the adjustment and
/// uses the concept-based readiness target alone.
///
/// `scaffold_floor` is the temporary Phase 3 remediation minimum: when present
/// it raises the target so targeted repair keeps embedded support, without
/// permanently changing scaffold state. It is applied last so it wins over a
/// fade cap while the error signal is active.
fn scaffold_target(
    pedagogy: &PedagogyMetadata,
    readiness: f64,
    recent: &RecentPedagogy,
    scaffold_floor: Option<u8>,
) -> f64 {
    let mut target = (1.0 - readiness) * MAX_SCAFFOLD;

    if let Some(family) = non_blank(pedagogy.family_id.as_deref()) {
        if let Some(attempt) = recent.family.get(family) {
            if let Some(level) = attempt.scaffold_level {
                let level = level.min(PEDAGOGY_MAX_SCAFFOLD_LEVEL) as f64;
                if attempt.success {
                    let cap = if attempt.clean_success {
                        (level - SCAFFOLD_FADE_STEP).max(0.0)
                    } else {
                        level
                    };
                    target = target.min(cap);
                } else {
                    target = target.max((level + SCAFFOLD_SUPPORT_STEP).min(MAX_SCAFFOLD));
                }
            }
        }
    }

    if let Some(floor) = scaffold_floor {
        target = target.max(f64::from(floor.min(PEDAGOGY_MAX_SCAFFOLD_LEVEL)));
    }

    target.clamp(0.0, MAX_SCAFFOLD)
}

/// A `[0, 1]` fit for a value within `scale` of a target.
fn fit_distance(value: f64, target: f64, scale: f64) -> f64 {
    if scale <= 0.0 {
        return NEUTRAL_FIT;
    }
    (1.0 - (value - target).abs() / scale).clamp(0.0, 1.0)
}

/// Normalized authored stage ordinal in `[0, 1]`.
fn stage_position(stage: PedagogyStage) -> f64 {
    f64::from(stage.ordinal()) / MAX_STAGE
}

/// Computes the bounded pedagogical contribution for one candidate.
///
/// `estimate` and `uncertainty` are the candidate's aggregated concept signal
/// from the existing student model. `recent` is built once from accepted
/// history. A candidate with no metadata returns [`PedagogySignal::NEUTRAL`].
pub fn pedagogy_fit(
    pedagogy: Option<&PedagogyMetadata>,
    estimate: f64,
    uncertainty: f64,
    recent: &RecentPedagogy,
) -> PedagogySignal {
    pedagogy_fit_with_floor(pedagogy, estimate, uncertainty, recent, None)
}

/// [`pedagogy_fit`] with a temporary scaffold floor.
///
/// Phase 3 remediation passes the authored `min_scaffold_level` here for
/// candidates that match an active error target. The floor only affects the
/// scaffold target while the error signal is active; normal fading resumes once
/// the learner recovers.
pub fn pedagogy_fit_with_floor(
    pedagogy: Option<&PedagogyMetadata>,
    estimate: f64,
    uncertainty: f64,
    recent: &RecentPedagogy,
    scaffold_floor: Option<u8>,
) -> PedagogySignal {
    let Some(pedagogy) = pedagogy else {
        return PedagogySignal::NEUTRAL;
    };

    let readiness = readiness(estimate, uncertainty);
    let target = scaffold_target(pedagogy, readiness, recent, scaffold_floor);

    let scaffold_fit = pedagogy.scaffold_level.map_or(NEUTRAL_FIT, |level| {
        fit_distance(level as f64, target, MAX_SCAFFOLD)
    });

    let stage_fit = pedagogy.stage.map_or(NEUTRAL_FIT, |stage| {
        fit_distance(stage_position(stage), readiness, 1.0)
    });

    // Context variety is scoped to the question's own transfer group (or
    // family). A different surface context is rewarded once the learner has
    // shown some success in the group; repeating a recent one is lightly
    // penalized. A question with no group gets no context signal at all.
    let mut transfer_bonus = 0.0;
    let mut surface_repeat_penalty = 0.0;
    if let Some(surface) = non_blank(pedagogy.surface_context.as_deref()) {
        if let Some(context) = group_key(pedagogy).and_then(|group| recent.groups.get(group)) {
            if context.recent_surfaces.contains(surface) {
                surface_repeat_penalty = 1.0;
            } else if context.recent_success && !context.recent_surfaces.is_empty() {
                transfer_bonus = 1.0;
            }
        }
    }

    PedagogySignal {
        scaffold_fit,
        transfer_bonus,
        surface_repeat_penalty,
        stage_fit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adaptive_learn_domain::ConceptWeight;
    use chrono::{DateTime, TimeZone, Utc};

    use crate::selection::HistoryEntry;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn pedagogy(
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

    fn attempt(
        pedagogy: Option<PedagogyMetadata>,
        score: f64,
        attempt_number: i32,
        hint_count: i32,
    ) -> HistoryEntry {
        HistoryEntry {
            question_id: "recent".to_owned(),
            score,
            assessment_mode: adaptive_learn_domain::AssessmentMode::Application,
            occurred_at: now(),
            concepts: vec![ConceptWeight {
                concept_id: "c1".to_owned(),
                weight: 1.0,
            }],
            attempt_number,
            hint_count,
            pedagogy,
            error_codes: Vec::new(),
        }
    }

    #[test]
    fn missing_metadata_is_neutral_and_constant() {
        let signal = pedagogy_fit(None, 0.9, 0.1, &RecentPedagogy::default());
        assert_eq!(signal, PedagogySignal::NEUTRAL);
        // The neutral contribution is a constant, so a bank without any
        // pedagogy metadata ranks exactly as it did before Phase 2.
        assert_eq!(signal.total(), PedagogySignal::NEUTRAL.total());
    }

    #[test]
    fn weak_learner_prefers_more_support() {
        let recent = RecentPedagogy::default();
        let low = pedagogy_fit(
            Some(&pedagogy(None, None, Some(1), None, None)),
            0.15,
            0.8,
            &recent,
        );
        let high = pedagogy_fit(
            Some(&pedagogy(None, None, Some(4), None, None)),
            0.15,
            0.8,
            &recent,
        );
        assert!(
            high.scaffold_fit > low.scaffold_fit,
            "weak learner should prefer more support: {high:?} vs {low:?}"
        );
    }

    #[test]
    fn strong_learner_prefers_less_support() {
        let recent = RecentPedagogy::default();
        let low = pedagogy_fit(
            Some(&pedagogy(None, None, Some(1), None, None)),
            0.95,
            0.1,
            &recent,
        );
        let high = pedagogy_fit(
            Some(&pedagogy(None, None, Some(4), None, None)),
            0.95,
            0.1,
            &recent,
        );
        assert!(
            low.scaffold_fit > high.scaffold_fit,
            "strong learner should prefer less support: {low:?} vs {high:?}"
        );
    }

    #[test]
    fn clean_success_fades_one_step_and_hinted_success_fades_less() {
        // A weak-ish learner so the readiness target is above the fade cap and
        // the recent family success actually constrains the target.
        let family = "generic.family";
        let candidate = pedagogy(Some(family), None, Some(5), None, None);
        let weak = (0.3, 0.5);

        let clean = RecentPedagogy::build(&[attempt(
            Some(pedagogy(Some(family), None, Some(5), None, None)),
            1.0,
            1,
            0,
        )]);
        let hinted = RecentPedagogy::build(&[attempt(
            Some(pedagogy(Some(family), None, Some(5), None, None)),
            1.0,
            3,
            2,
        )]);

        let clean_target = scaffold_target(&candidate, readiness(weak.0, weak.1), &clean, None);
        let hinted_target = scaffold_target(&candidate, readiness(weak.0, weak.1), &hinted, None);
        assert!(
            hinted_target > clean_target,
            "hinted/recovery success must fade less: hinted {hinted_target} <= clean {clean_target}"
        );
        // Clean success drops at most one level below what succeeded.
        assert_eq!(clean_target, 4.0);
    }

    #[test]
    fn remediation_floor_raises_the_scaffold_target_temporarily() {
        let candidate = pedagogy(Some("generic.family"), None, Some(0), None, None);
        let strong = (0.95, 0.1);
        let recent = RecentPedagogy::default();

        let base = scaffold_target(&candidate, readiness(strong.0, strong.1), &recent, None);
        let floored = scaffold_target(&candidate, readiness(strong.0, strong.1), &recent, Some(3));
        assert_eq!(floored, 3.0, "the floor raises the target for repair");
        assert!(
            floored > base,
            "without the floor a strong learner fades lower"
        );
    }

    #[test]
    fn recent_failure_allows_more_support() {
        let family = "generic.family";
        let candidate = pedagogy(Some(family), None, Some(0), None, None);
        let strong = (0.95, 0.1);

        let no_failure = RecentPedagogy::default();
        let failure = RecentPedagogy::build(&[attempt(
            Some(pedagogy(Some(family), None, Some(0), None, None)),
            0.0,
            1,
            0,
        )]);

        let base = scaffold_target(&candidate, readiness(strong.0, strong.1), &no_failure, None);
        let recovered = scaffold_target(&candidate, readiness(strong.0, strong.1), &failure, None);
        assert!(
            recovered > base,
            "a recent failure should raise the support target: {recovered} vs {base}"
        );
    }

    #[test]
    fn different_context_is_bonused_and_repeat_is_penalized() {
        let group = "generic.transfer";
        let history = vec![attempt(
            Some(pedagogy(None, None, None, Some(group), Some("context_a"))),
            1.0,
            1,
            0,
        )];
        let recent = RecentPedagogy::build(&history);

        let novel = pedagogy_fit(
            Some(&pedagogy(None, None, None, Some(group), Some("context_b"))),
            0.8,
            0.2,
            &recent,
        );
        let repeated = pedagogy_fit(
            Some(&pedagogy(None, None, None, Some(group), Some("context_a"))),
            0.8,
            0.2,
            &recent,
        );

        assert_eq!(novel.transfer_bonus, 1.0);
        assert_eq!(novel.surface_repeat_penalty, 0.0);
        assert_eq!(repeated.transfer_bonus, 0.0);
        assert_eq!(repeated.surface_repeat_penalty, 1.0);
        assert!(novel.total() > repeated.total());
    }

    #[test]
    fn no_transfer_group_applies_no_context_signal() {
        let recent = RecentPedagogy::default();
        let signal = pedagogy_fit(
            Some(&pedagogy(None, None, None, None, Some("context_b"))),
            0.8,
            0.2,
            &recent,
        );
        assert_eq!(signal.transfer_bonus, 0.0);
        assert_eq!(signal.surface_repeat_penalty, 0.0);
    }

    #[test]
    fn no_success_in_group_gives_no_transfer_bonus() {
        let group = "generic.transfer";
        let recent = RecentPedagogy::build(&[attempt(
            Some(pedagogy(None, None, None, Some(group), Some("context_a"))),
            0.0,
            1,
            0,
        )]);
        let signal = pedagogy_fit(
            Some(&pedagogy(None, None, None, Some(group), Some("context_b"))),
            0.8,
            0.2,
            &recent,
        );
        assert_eq!(
            signal.transfer_bonus, 0.0,
            "a cold or failing learner should not be pushed into transfer"
        );
    }

    #[test]
    fn contribution_is_bounded() {
        let signal = PedagogySignal {
            scaffold_fit: 10.0,
            transfer_bonus: 10.0,
            surface_repeat_penalty: 10.0,
            stage_fit: 10.0,
        };
        let total = signal.total();
        assert!(total <= WEIGHT_SCAFFOLD_FIT + WEIGHT_TRANSFER_CONTEXT + WEIGHT_STAGE_FIT);
        assert!(total >= -PENALTY_SURFACE_REPEAT);
    }

    #[test]
    fn strong_learner_prefers_later_stages() {
        let recent = RecentPedagogy::default();
        let early = pedagogy_fit(
            Some(&pedagogy(
                None,
                Some(PedagogyStage::Recognize),
                None,
                None,
                None,
            )),
            0.95,
            0.1,
            &recent,
        );
        let late = pedagogy_fit(
            Some(&pedagogy(
                None,
                Some(PedagogyStage::Transfer),
                None,
                None,
                None,
            )),
            0.95,
            0.1,
            &recent,
        );
        assert!(late.stage_fit > early.stage_fit);
    }

    #[test]
    fn policy_ignores_track_specific_names() {
        // The same metadata *shape* under different subject names must produce
        // identical signals: the policy never inspects the strings.
        let recent = RecentPedagogy::default();
        let names = [
            "dsa.sliding_window.variable",
            "aws.messaging.decoupling",
            "python.async.task_lifecycle",
            "security.authz.misconfiguration",
            "ml.data_leakage",
        ];
        let signals: Vec<PedagogySignal> = names
            .iter()
            .map(|name| {
                pedagogy_fit(
                    Some(&pedagogy(
                        Some(name),
                        Some(PedagogyStage::Construct),
                        Some(2),
                        Some("group"),
                        Some("surface"),
                    )),
                    0.6,
                    0.3,
                    &recent,
                )
            })
            .collect();
        assert!(signals.windows(2).all(|pair| pair[0] == pair[1]));
    }
}
