//! Pure structural-comparison resolution (Phase 5).
//!
//! Phase 5 teaches that a **surface story** is not the same as the **deep
//! structure** behind it. It does this by connecting problems the learner has
//! really seen that share a Phase 1 `family_id` but differ in
//! `surface_context`.
//!
//! This module is the pure, deterministic core. It does no I/O and performs no
//! semantic similarity: grouping comes entirely from the authored
//! `family_id`, `transfer_group_id`, and `surface_context` metadata, never from
//! embeddings, text similarity, or an LLM. That keeps the feature cheap,
//! explainable, auditable, and safe.
//!
//! Two separate things must not be confused:
//!
//! ```text
//! family guide        = authored explanation of a reusable deep structure
//! structure comparison = post-exposure teaching view over *seen* examples
//! ```
//!
//! A comparison is only eligible once the learner has **seen at least two
//! distinct surface contexts** for one family (or transfer group). This is a
//! presentation/teaching aid: it is not evidence, mastery, or a score.

use std::collections::BTreeMap;

use adaptive_learn_content::{FamilyConfusion, FamilyExampleContext, FamilyGuide, SourceRef};
use chrono::{DateTime, Utc};

/// Minimum distinct surface contexts before a same-skeleton comparison is shown.
pub const MIN_DISTINCT_CONTEXTS: usize = 2;
/// Maximum examples shown in one comparison, newest first.
pub const MAX_COMPARISON_EXAMPLES: usize = 3;

/// One example of a family that the learner has actually seen.
///
/// Built only from accepted learning history joined to canonical content. Any
/// accepted attempt counts as "seen" (a failed attempt still shows the learner
/// met that example), but it never implies understanding.
#[derive(Debug, Clone, PartialEq)]
pub struct SeenExample {
    /// Authored family this example belongs to. Opaque.
    pub family_id: String,
    /// Question identifier that produced the example.
    pub question_id: String,
    /// Authored transfer group, when present. Opaque.
    pub transfer_group_id: Option<String>,
    /// Authored surface context. Opaque and non-blank to participate.
    pub surface_context: Option<String>,
    /// Learner-facing problem title.
    pub title: String,
    /// Learner-facing label for the example's surface context.
    ///
    /// Uses the authored guide label when one exists, otherwise the problem
    /// title, so a raw machine id is never shown.
    pub context_label: String,
    /// When the learner saw it.
    pub seen_at: DateTime<Utc>,
}

/// Which authored grouping a comparison was built from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComparisonScope {
    /// Examples that share one authored transfer group.
    TransferGroup(String),
    /// Examples that share the family but no single transfer group qualified.
    Family,
}

/// A learner-facing same-skeleton comparison over seen examples.
#[derive(Debug, Clone, PartialEq)]
pub struct StructureComparison {
    /// Authored family id. Opaque.
    pub family_id: String,
    /// Learner-facing family title.
    pub title: String,
    /// Plain-language deep-structure summary.
    pub summary: String,
    /// Structural clues shared by the examples.
    pub recognition_signals: Vec<String>,
    /// The rule(s) that make the family work.
    pub core_rules: Vec<String>,
    /// Optional reusable skeleton.
    pub structural_steps: Vec<String>,
    /// Seen examples, newest first. Always at least two, in distinct contexts.
    pub examples: Vec<SeenExample>,
    /// The authored grouping the examples came from.
    pub scope: ComparisonScope,
}

/// A comparison between two commonly confused families.
///
/// Both titles resolve from authored guides, so the learner never sees a raw
/// machine identifier.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfusionComparison {
    /// Authored family id. Opaque.
    pub family_id: String,
    /// Learner-facing title of the family being explained.
    pub family_title: String,
    /// Authored id of the neighboring family. Opaque.
    pub other_family_id: String,
    /// Learner-facing title of the neighboring family.
    pub other_family_title: String,
    /// Authored distinction between the two families.
    pub distinction: String,
}

/// One family exposure resolved from accepted history and canonical content.
///
/// This is the raw material for an insight; it is not persisted anywhere. It is
/// derived on read, so accepted learning events stay the single authoritative
/// history and no duplicate "family history" table is needed.
#[derive(Debug, Clone, PartialEq)]
pub struct SeenRecord {
    /// Authored family the exposure belongs to. Opaque.
    pub family_id: String,
    /// Question identifier that produced the exposure.
    pub question_id: String,
    /// Authored transfer group, when present. Opaque.
    pub transfer_group_id: Option<String>,
    /// Authored surface context, when present. Opaque.
    pub surface_context: Option<String>,
    /// Learner-facing problem title.
    pub title: String,
    /// When the learner encountered it.
    pub seen_at: DateTime<Utc>,
}

/// A learner-facing family insight: the guide plus what the learner has seen.
///
/// Only families the learner has already encountered are ever built, so this is
/// never used before first exposure. It is presentation only: it creates no
/// evidence, mastery, reward, or score.
#[derive(Debug, Clone, PartialEq)]
pub struct FamilyInsight {
    pub family_id: String,
    pub title: String,
    pub summary: String,
    pub recognition_signals: Vec<String>,
    pub core_rules: Vec<String>,
    pub structural_steps: Vec<String>,
    pub example_contexts: Vec<FamilyExampleContext>,
    pub common_confusions: Vec<ConfusionComparison>,
    pub source_refs: Vec<SourceRef>,
    /// Distinct surface contexts the learner has seen for this family.
    pub seen_context_count: usize,
    /// Distinct examples the learner has seen for this family.
    pub seen_example_count: usize,
    /// Same-skeleton comparison, present only once context variety exists.
    pub comparison: Option<StructureComparison>,
}

/// Builds insights for every family the learner has already encountered.
///
/// Deterministic: families are returned in ascending `family_id` order, and a
/// family with no seen exposure is omitted entirely (never unlocked early).
pub fn build_family_insights(guides: &[&FamilyGuide], seen: &[SeenRecord]) -> Vec<FamilyInsight> {
    let mut insights: Vec<FamilyInsight> = guides
        .iter()
        .filter_map(|guide| build_family_insight(guide, guides, seen))
        .collect();
    insights.sort_by(|left, right| left.family_id.cmp(&right.family_id));
    insights
}

/// Builds one family insight, or `None` when the learner has seen nothing yet.
pub fn build_family_insight(
    guide: &FamilyGuide,
    guide_pool: &[&FamilyGuide],
    seen: &[SeenRecord],
) -> Option<FamilyInsight> {
    let records = dedupe_seen(guide, seen);
    if records.is_empty() {
        return None;
    }

    let examples: Vec<SeenExample> = records
        .iter()
        .map(|record| SeenExample {
            family_id: record.family_id.clone(),
            question_id: record.question_id.clone(),
            transfer_group_id: record.transfer_group_id.clone(),
            surface_context: record.surface_context.clone(),
            title: record.title.clone(),
            context_label: record
                .surface_context
                .as_deref()
                .and_then(|context| guide.context_label(context))
                .unwrap_or(record.title.as_str())
                .to_owned(),
            seen_at: record.seen_at,
        })
        .collect();

    let seen_context_count = distinct_contexts(examples.iter());

    // A confusion compares two families; only show it once the learner has met
    // the neighbor too, so the A-vs-B view cannot pre-label an unencountered
    // family before its first exposure.
    let seen_families: std::collections::BTreeSet<&str> = seen
        .iter()
        .map(|record| record.family_id.as_str())
        .collect();
    let common_confusions = guide
        .common_confusions
        .iter()
        .filter(|confusion| seen_families.contains(confusion.other_family_id.as_str()))
        .filter_map(|confusion| {
            let other = guide_pool
                .iter()
                .find(|candidate| candidate.family_id == confusion.other_family_id);
            build_confusion_comparison(guide, confusion, other.copied())
        })
        .collect();

    Some(FamilyInsight {
        family_id: guide.family_id.clone(),
        title: guide.title.clone(),
        summary: guide.summary.clone(),
        recognition_signals: guide.recognition_signals.clone(),
        core_rules: guide.core_rules.clone(),
        structural_steps: guide.structural_steps.clone(),
        example_contexts: guide.example_contexts.clone(),
        common_confusions,
        source_refs: guide.source_refs.clone(),
        seen_context_count,
        seen_example_count: records.len(),
        comparison: build_structure_comparison(guide, &examples),
    })
}

/// Keeps one newest record per question for a family, in newest-first order.
fn dedupe_seen<'a>(guide: &FamilyGuide, seen: &'a [SeenRecord]) -> Vec<&'a SeenRecord> {
    let mut by_question: BTreeMap<&str, &SeenRecord> = BTreeMap::new();
    for record in seen
        .iter()
        .filter(|record| record.family_id == guide.family_id)
    {
        by_question
            .entry(record.question_id.as_str())
            .and_modify(|current| {
                if record.seen_at > current.seen_at {
                    *current = record;
                }
            })
            .or_insert(record);
    }
    let mut records: Vec<&SeenRecord> = by_question.into_values().collect();
    records.sort_by(|left, right| {
        right
            .seen_at
            .cmp(&left.seen_at)
            .then_with(|| left.question_id.cmp(&right.question_id))
    });
    records
}

/// Builds a same-skeleton comparison from already-seen examples, if eligible.
///
/// Eligibility (documented behavior):
///
/// - at least [`MIN_DISTINCT_CONTEXTS`] distinct non-blank surface contexts;
/// - examples must belong to `guide.family_id` (an example from another family
///   is never grouped merely because a context matches);
/// - when a transfer group has enough context variety, that group is preferred;
///   otherwise the family as a whole is used.
///
/// The result is deterministic: the qualifying transfer group with the most
/// distinct contexts wins (ties break by group id), one newest example per
/// context is kept, and examples are ordered newest first by `question_id`.
pub fn build_structure_comparison(
    guide: &FamilyGuide,
    examples: &[SeenExample],
) -> Option<StructureComparison> {
    let mut by_context: BTreeMap<&str, &SeenExample> = BTreeMap::new();
    for example in examples
        .iter()
        .filter(|example| example.family_id == guide.family_id)
    {
        let Some(context) = example.surface_context.as_deref().map(str::trim) else {
            continue;
        };
        if context.is_empty() {
            continue;
        }
        by_context
            .entry(context)
            .and_modify(|current| {
                if newer(example, current) {
                    *current = example;
                }
            })
            .or_insert(example);
    }

    // Prefer one authored transfer group that itself has context variety.
    let mut groups: BTreeMap<&str, Vec<&SeenExample>> = BTreeMap::new();
    for example in by_context.values() {
        if let Some(group) = example
            .transfer_group_id
            .as_deref()
            .map(str::trim)
            .filter(|group| !group.is_empty())
        {
            groups.entry(group).or_default().push(*example);
        }
    }

    let group_pick = groups
        .iter()
        .filter(|(_, members)| distinct_contexts(members.iter().copied()) >= MIN_DISTINCT_CONTEXTS)
        .max_by(|(left_id, left), (right_id, right)| {
            distinct_contexts(left.iter().copied())
                .cmp(&distinct_contexts(right.iter().copied()))
                // `max_by` keeps the last maximum; reverse the id ordering so
                // the lexicographically smallest group id wins deterministically.
                .then_with(|| right_id.cmp(left_id))
        });

    let (scope, mut chosen): (ComparisonScope, Vec<&SeenExample>) = match group_pick {
        Some((group_id, members)) => (
            ComparisonScope::TransferGroup((*group_id).to_owned()),
            members.clone(),
        ),
        None => (
            ComparisonScope::Family,
            by_context.values().copied().collect(),
        ),
    };

    if distinct_contexts(chosen.iter().copied()) < MIN_DISTINCT_CONTEXTS {
        return None;
    }

    chosen.sort_by(|left, right| order_examples(left, right));
    chosen.truncate(MAX_COMPARISON_EXAMPLES);

    Some(StructureComparison {
        family_id: guide.family_id.clone(),
        title: guide.title.clone(),
        summary: guide.summary.clone(),
        recognition_signals: guide.recognition_signals.clone(),
        core_rules: guide.core_rules.clone(),
        structural_steps: guide.structural_steps.clone(),
        examples: chosen.into_iter().cloned().collect(),
        scope,
    })
}

/// Builds a Family A vs Family B comparison from an authored confusion.
///
/// Returns `None` when the neighbor guide is not authored, so the learner view
/// never falls back to rendering a raw id.
pub fn build_confusion_comparison(
    guide: &FamilyGuide,
    confusion: &FamilyConfusion,
    other: Option<&FamilyGuide>,
) -> Option<ConfusionComparison> {
    let other = other?;
    Some(ConfusionComparison {
        family_id: guide.family_id.clone(),
        family_title: guide.title.clone(),
        other_family_id: other.family_id.clone(),
        other_family_title: other.title.clone(),
        distinction: confusion.distinction.clone(),
    })
}

/// Counts distinct non-blank surface contexts among examples.
fn distinct_contexts<'a>(examples: impl IntoIterator<Item = &'a SeenExample>) -> usize {
    examples
        .into_iter()
        .filter_map(|example| example.surface_context.as_deref())
        .map(str::trim)
        .filter(|context| !context.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

/// Whether `candidate` should replace `current` as the newest for a context.
fn newer(candidate: &SeenExample, current: &SeenExample) -> bool {
    candidate.seen_at > current.seen_at
        || (candidate.seen_at == current.seen_at && candidate.question_id < current.question_id)
}

/// Newest first, then by stable question id.
fn order_examples(left: &SeenExample, right: &SeenExample) -> std::cmp::Ordering {
    right
        .seen_at
        .cmp(&left.seen_at)
        .then_with(|| left.question_id.cmp(&right.question_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use adaptive_learn_content::{FamilyExampleContext, SourceRef};
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap()
    }

    fn guide(family: &str) -> FamilyGuide {
        FamilyGuide {
            schema_version: "family-guide-v1".to_owned(),
            certification_id: "track".to_owned(),
            certification_version: "track-v1".to_owned(),
            family_id: family.to_owned(),
            title: "Moving Valid Window".to_owned(),
            summary: "Maintain one active contiguous range.".to_owned(),
            recognition_signals: vec!["contiguous ranges".to_owned()],
            core_rules: vec!["After repair, the range is valid.".to_owned()],
            structural_steps: vec!["add the incoming item".to_owned()],
            common_confusions: vec![],
            example_contexts: vec![FamilyExampleContext {
                context_id: "api_rate_limiting".to_owned(),
                label: "API rate limiting".to_owned(),
            }],
            source_refs: vec![SourceRef {
                title: "Source".to_owned(),
                url: "https://example.com".to_owned(),
            }],
        }
    }

    fn example(
        family: &str,
        question: &str,
        group: Option<&str>,
        context: Option<&str>,
        minutes: i64,
    ) -> SeenExample {
        SeenExample {
            family_id: family.to_owned(),
            question_id: question.to_owned(),
            transfer_group_id: group.map(str::to_owned),
            surface_context: context.map(str::to_owned),
            title: question.to_owned(),
            context_label: question.to_owned(),
            seen_at: now() + chrono::Duration::minutes(minutes),
        }
    }

    #[test]
    fn two_contexts_in_one_group_are_eligible() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-api",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-login",
                Some("g1"),
                Some("login_monitoring"),
                2,
            ),
        ];
        let comparison = build_structure_comparison(&guide, &history).expect("eligible");
        assert_eq!(comparison.examples.len(), 2);
        assert_eq!(
            comparison.scope,
            ComparisonScope::TransferGroup("g1".to_owned())
        );
        // Newest first.
        assert_eq!(comparison.examples[0].question_id, "q-login");
    }

    #[test]
    fn one_example_is_not_eligible() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![example(
            "dsa.sliding_window.variable",
            "q-api",
            Some("g1"),
            Some("api_rate_limiting"),
            1,
        )];
        assert!(build_structure_comparison(&guide, &history).is_none());
    }

    #[test]
    fn same_context_is_not_enough_variation() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-a",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-b",
                Some("g1"),
                Some("api_rate_limiting"),
                2,
            ),
        ];
        assert!(build_structure_comparison(&guide, &history).is_none());
    }

    #[test]
    fn missing_context_examples_do_not_grant_variation() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example("dsa.sliding_window.variable", "q-a", Some("g1"), None, 1),
            example(
                "dsa.sliding_window.variable",
                "q-b",
                Some("g1"),
                Some("api_rate_limiting"),
                2,
            ),
        ];
        assert!(build_structure_comparison(&guide, &history).is_none());
    }

    #[test]
    fn examples_from_another_family_are_never_grouped() {
        let guide = guide("dsa.sliding_window.variable");
        // Same context, unrelated family: must not be pulled in.
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-a",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.prefix_state",
                "q-b",
                Some("g1"),
                Some("login_monitoring"),
                2,
            ),
        ];
        assert!(build_structure_comparison(&guide, &history).is_none());
    }

    #[test]
    fn qualifying_transfer_group_wins_over_family_fallback() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-g1-a",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-g1-b",
                Some("g1"),
                Some("login_monitoring"),
                2,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-g2-a",
                Some("g2"),
                Some("security_events"),
                3,
            ),
        ];
        let comparison = build_structure_comparison(&guide, &history).expect("eligible");
        assert_eq!(
            comparison.scope,
            ComparisonScope::TransferGroup("g1".to_owned())
        );
        assert_eq!(comparison.examples.len(), 2);
    }

    #[test]
    fn separate_groups_fall_back_to_family_when_no_group_varies() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-g1",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-g2",
                Some("g2"),
                Some("login_monitoring"),
                2,
            ),
        ];
        let comparison = build_structure_comparison(&guide, &history).expect("family fallback");
        assert_eq!(comparison.scope, ComparisonScope::Family);
        assert_eq!(comparison.examples.len(), 2);
    }

    #[test]
    fn duplicate_attempts_keep_one_newest_example_per_context() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-api-old",
                Some("g1"),
                Some("api_rate_limiting"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-api-new",
                Some("g1"),
                Some("api_rate_limiting"),
                5,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-login",
                Some("g1"),
                Some("login_monitoring"),
                3,
            ),
        ];
        let comparison = build_structure_comparison(&guide, &history).expect("eligible");
        assert_eq!(comparison.examples.len(), 2);
        assert!(
            comparison
                .examples
                .iter()
                .any(|example| example.question_id == "q-api-new")
        );
        assert!(
            !comparison
                .examples
                .iter()
                .any(|example| example.question_id == "q-api-old")
        );
    }

    #[test]
    fn comparison_is_capped_and_never_invents_unseen_examples() {
        let guide = guide("dsa.sliding_window.variable");
        let history = vec![
            example(
                "dsa.sliding_window.variable",
                "q-1",
                Some("g1"),
                Some("ctx_1"),
                1,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-2",
                Some("g1"),
                Some("ctx_2"),
                2,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-3",
                Some("g1"),
                Some("ctx_3"),
                3,
            ),
            example(
                "dsa.sliding_window.variable",
                "q-4",
                Some("g1"),
                Some("ctx_4"),
                4,
            ),
        ];
        let comparison = build_structure_comparison(&guide, &history).expect("eligible");
        assert_eq!(comparison.examples.len(), MAX_COMPARISON_EXAMPLES);
        assert!(
            comparison
                .examples
                .iter()
                .all(|example| history.contains(example)),
            "every shown example must come from the provided seen history"
        );
    }

    #[test]
    fn confusion_comparison_uses_authored_titles() {
        let base = guide("dsa.sliding_window.variable");
        let other = guide("dsa.prefix_state");
        let confusion = FamilyConfusion {
            other_family_id: "dsa.prefix_state".to_owned(),
            distinction: "window vs prefix".to_owned(),
        };
        let view = build_confusion_comparison(&base, &confusion, Some(&other))
            .expect("both guides resolve");
        assert_eq!(view.other_family_title, other.title);
        assert_eq!(view.distinction, "window vs prefix");
    }

    #[test]
    fn confusion_comparison_is_absent_without_the_other_guide() {
        let base = guide("dsa.sliding_window.variable");
        let confusion = FamilyConfusion {
            other_family_id: "dsa.prefix_state".to_owned(),
            distinction: "window vs prefix".to_owned(),
        };
        assert!(build_confusion_comparison(&base, &confusion, None).is_none());
    }

    #[test]
    fn behavior_is_identical_across_track_names() {
        // The resolver never inspects id prefixes: the same *shape* of history
        // must produce the same decision for any subject.
        let families = [
            "dsa.sliding_window.variable",
            "python.async.task_lifecycle",
            "aws.messaging.decoupling",
            "security.authz.misconfiguration",
            "ml.data_leakage",
        ];
        let decisions: Vec<bool> = families
            .iter()
            .map(|family| {
                let history = vec![
                    example(family, "q-a", Some("g"), Some("ctx_a"), 1),
                    example(family, "q-b", Some("g"), Some("ctx_b"), 2),
                ];
                build_structure_comparison(&guide(family), &history).is_some()
            })
            .collect();
        assert!(decisions.iter().all(|decision| *decision));
    }

    fn record(
        family: &str,
        question: &str,
        group: Option<&str>,
        context: Option<&str>,
        title: &str,
        minutes: i64,
    ) -> SeenRecord {
        SeenRecord {
            family_id: family.to_owned(),
            question_id: question.to_owned(),
            transfer_group_id: group.map(str::to_owned),
            surface_context: context.map(str::to_owned),
            title: title.to_owned(),
            seen_at: now() + chrono::Duration::minutes(minutes),
        }
    }

    #[test]
    fn insight_requires_first_exposure() {
        let base = guide("dsa.sliding_window.variable");
        let pool = [&base];
        let insights = build_family_insights(&pool, &[]);
        assert!(
            insights.is_empty(),
            "a family must not unlock before first exposure"
        );
    }

    #[test]
    fn one_exposure_unlocks_the_card_but_not_the_comparison() {
        let base = guide("dsa.sliding_window.variable");
        let pool = [&base];
        let seen = vec![record(
            "dsa.sliding_window.variable",
            "q-api",
            Some("g1"),
            Some("api_rate_limiting"),
            "Rate limiting",
            1,
        )];
        let insights = build_family_insights(&pool, &seen);
        assert_eq!(insights.len(), 1);
        let insight = &insights[0];
        assert_eq!(insight.seen_example_count, 1);
        assert_eq!(insight.seen_context_count, 1);
        assert!(
            insight.comparison.is_none(),
            "one context cannot show a same-skeleton comparison"
        );
    }

    #[test]
    fn two_exposures_in_distinct_contexts_show_the_comparison() {
        let base = guide("dsa.sliding_window.variable");
        let pool = [&base];
        let seen = vec![
            record(
                "dsa.sliding_window.variable",
                "q-api",
                Some("g1"),
                Some("api_rate_limiting"),
                "Rate limiting",
                1,
            ),
            record(
                "dsa.sliding_window.variable",
                "q-login",
                Some("g1"),
                Some("login_monitoring"),
                "Login monitoring",
                2,
            ),
        ];
        let insights = build_family_insights(&pool, &seen);
        let comparison = insights[0].comparison.as_ref().expect("eligible");
        assert_eq!(comparison.examples.len(), 2);
        // The authored context label is used when one exists; otherwise the
        // problem title is the learner-facing label.
        let labels: Vec<&str> = comparison
            .examples
            .iter()
            .map(|example| example.context_label.as_str())
            .collect();
        assert!(labels.contains(&"API rate limiting"));
        assert!(labels.contains(&"Login monitoring"));
    }

    #[test]
    fn duplicate_events_do_not_duplicate_examples() {
        let base = guide("dsa.sliding_window.variable");
        let pool = [&base];
        let seen = vec![
            record(
                "dsa.sliding_window.variable",
                "q-api",
                Some("g1"),
                Some("api_rate_limiting"),
                "Rate limiting",
                1,
            ),
            record(
                "dsa.sliding_window.variable",
                "q-api",
                Some("g1"),
                Some("api_rate_limiting"),
                "Rate limiting",
                5,
            ),
        ];
        let insights = build_family_insights(&pool, &seen);
        assert_eq!(insights[0].seen_example_count, 1);
    }

    #[test]
    fn a_single_exposure_still_unlocks_even_if_it_was_a_failure() {
        // SeenRecord intentionally carries no success flag: a failed attempt
        // still shows the learner met the example, but the insight never claims
        // understanding. Only one context means no comparison yet.
        let base = guide("dsa.sliding_window.variable");
        let pool = [&base];
        let seen = vec![record(
            "dsa.sliding_window.variable",
            "q-api",
            Some("g1"),
            Some("api_rate_limiting"),
            "Rate limiting",
            1,
        )];
        let insights = build_family_insights(&pool, &seen);
        assert_eq!(insights.len(), 1);
        assert!(insights[0].comparison.is_none());
    }

    #[test]
    fn confusion_titles_resolve_from_the_guide_pool() {
        let mut base = guide("dsa.sliding_window.variable");
        let mut other = guide("dsa.prefix_state");
        other.title = "Fixed Cumulative State".to_owned();
        base.common_confusions = vec![FamilyConfusion {
            other_family_id: "dsa.prefix_state".to_owned(),
            distinction: "window vs prefix".to_owned(),
        }];
        let pool = [&base, &other];

        // Only the base family seen: the A-vs-B distinction must stay hidden so
        // it cannot pre-label the neighbor before first exposure.
        let only_base = vec![record(
            "dsa.sliding_window.variable",
            "q-api",
            Some("g1"),
            Some("api_rate_limiting"),
            "Rate limiting",
            1,
        )];
        let insights = build_family_insights(&pool, &only_base);
        let base_insight = insights
            .iter()
            .find(|insight| insight.family_id == "dsa.sliding_window.variable")
            .expect("base insight");
        assert!(base_insight.common_confusions.is_empty());

        // Both families seen: the distinction resolves to the authored title.
        let both = vec![
            record(
                "dsa.sliding_window.variable",
                "q-api",
                Some("g1"),
                Some("api_rate_limiting"),
                "Rate limiting",
                1,
            ),
            record(
                "dsa.prefix_state",
                "q-prefix",
                Some("g2"),
                Some("subarray_sum_queries"),
                "Prefix sums",
                2,
            ),
        ];
        let insights = build_family_insights(&pool, &both);
        let base_insight = insights
            .iter()
            .find(|insight| insight.family_id == "dsa.sliding_window.variable")
            .expect("base insight");
        assert_eq!(base_insight.common_confusions.len(), 1);
        assert_eq!(
            base_insight.common_confusions[0].other_family_title,
            "Fixed Cumulative State"
        );
    }
}
