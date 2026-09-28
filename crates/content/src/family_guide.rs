//! Authored family guides: reusable deep-structure descriptions (Phase 5).
//!
//! A **family guide** explains the deep, reusable structure behind a Phase 1
//! `family_id`. It is authored content, not learner state: it never creates
//! evidence, mastery, rewards, or selection behavior. It exists so the product
//! can later show a learner *why* two already-seen examples from very different
//! surface contexts share the same reasoning skeleton.
//!
//! The schema is deliberately track-agnostic: `family_id`, `surface_context`
//! values inside referenced pedagogy metadata, and confusion targets are opaque
//! author-defined strings. Core code never inspects their prefixes or names, so
//! DSA, Python, AWS, Terraform, security, ML, and future tracks use one contract.
//!
//! Family guides are optional. A track with no guides loads exactly as before,
//! and a question's `family_id` does not have to have a guide immediately.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::model::SourceRef;
use crate::validate::ContentError;

/// The only supported family-guide schema version.
pub const FAMILY_GUIDE_SCHEMA_VERSION: &str = "family-guide-v1";

/// A reusable deep structure, authored once per track/version family.
///
/// This is *not* a concept and *not* a question: one family may involve several
/// concepts, and one concept may participate in several families. See
/// `docs/06-learning-engine.md` and `docs/16-content-audit.md`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FamilyGuide {
    /// Schema discriminator; must equal `family-guide-v1`.
    pub schema_version: String,
    /// Certification identifier, for example `aws-soa-c03`.
    pub certification_id: String,
    /// Certification version identifier, for example `soa-c03`.
    pub certification_version: String,
    /// Stable family identifier matching the Phase 1 `pedagogy.family_id`.
    ///
    /// Opaque: core code never inspects its prefix or contents.
    pub family_id: String,
    /// Learner-facing family name, for example `Moving Valid Window`.
    pub title: String,
    /// Short plain-language definition of the deep structure.
    ///
    /// It should explain the structure, not merely name a technique.
    pub summary: String,
    /// Structural clues that should trigger the same reasoning next time.
    pub recognition_signals: Vec<String>,
    /// The key rule(s) or invariant(s) that make the family work.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub core_rules: Vec<String>,
    /// Optional ordered conceptual skeleton (not executable instructions).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub structural_steps: Vec<String>,
    /// Useful near-neighbor comparisons, authored as distinctions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub common_confusions: Vec<FamilyConfusion>,
    /// Representative contexts, as explanatory examples rather than history.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub example_contexts: Vec<FamilyExampleContext>,
    /// Official references supporting the guide's factual claims.
    pub source_refs: Vec<SourceRef>,
}

/// One authored near-neighbor comparison for a family.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FamilyConfusion {
    /// The other family this one is commonly confused with.
    ///
    /// Resolves to an authored guide in the same track/version; opaque to core
    /// code.
    pub other_family_id: String,
    /// The distinction that tells the two families apart.
    pub distinction: String,
}

/// One representative context for a family.
///
/// The `context_id` matches an authored `pedagogy.surface_context` value; the
/// `label` is the learner-facing text, so raw machine ids are never rendered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FamilyExampleContext {
    /// Opaque authored surface-context id, for example `api_rate_limiting`.
    pub context_id: String,
    /// Learner-facing label, for example `API rate limiting`.
    pub label: String,
}

impl FamilyGuide {
    /// Returns the learner-facing label for a surface context, when authored.
    pub fn context_label(&self, context_id: &str) -> Option<&str> {
        self.example_contexts
            .iter()
            .find(|context| context.context_id == context_id)
            .map(|context| context.label.as_str())
    }
}

/// Normalizes a phrase for duplicate detection: trimmed, lowercased, and
/// internal whitespace collapsed to single spaces.
pub(crate) fn normalize_phrase(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Validates one authored family guide, returning every problem found.
///
/// Local, non-cross-source structural rules only. Confusion targets are
/// cross-checked by [`crate::registry::ContentRegistry`], where the other
/// authored guides are available.
pub fn validate_family_guide(guide: &FamilyGuide) -> Result<(), Vec<ContentError>> {
    let mut errors = Vec::new();
    let label = if guide.family_id.trim().is_empty() {
        "<empty>"
    } else {
        guide.family_id.as_str()
    };

    if guide.schema_version != FAMILY_GUIDE_SCHEMA_VERSION {
        errors.push(ContentError::new(
            "family_guide_schema_unsupported",
            format!("family guide {label} schema_version must be {FAMILY_GUIDE_SCHEMA_VERSION}"),
        ));
    }

    for (field, value) in [
        ("family_id", &guide.family_id),
        ("certification_id", &guide.certification_id),
        ("certification_version", &guide.certification_version),
        ("title", &guide.title),
        ("summary", &guide.summary),
    ] {
        if value.trim().is_empty() {
            errors.push(ContentError::new(
                "family_guide_field_missing",
                format!("family guide {label} {field} must not be empty"),
            ));
        }
    }

    validate_unique_phrases(
        &guide.recognition_signals,
        "family_guide_signal_empty",
        "family_guide_signal_duplicate",
        "recognition signal",
        label,
        &mut errors,
    );
    if guide.recognition_signals.is_empty() {
        errors.push(ContentError::new(
            "family_guide_recognition_signals_missing",
            format!("family guide {label} must declare at least one recognition signal"),
        ));
    }

    validate_unique_phrases(
        &guide.core_rules,
        "family_guide_rule_empty",
        "family_guide_rule_duplicate",
        "core rule",
        label,
        &mut errors,
    );
    validate_unique_phrases(
        &guide.structural_steps,
        "family_guide_step_empty",
        "family_guide_step_duplicate",
        "structural step",
        label,
        &mut errors,
    );

    let mut confusion_targets = HashSet::new();
    for confusion in &guide.common_confusions {
        if confusion.other_family_id.trim().is_empty() || confusion.distinction.trim().is_empty() {
            errors.push(ContentError::new(
                "family_guide_confusion_empty",
                format!(
                    "family guide {label} confusion entries must set a non-blank other_family_id and distinction"
                ),
            ));
            continue;
        }
        if confusion.other_family_id == guide.family_id {
            errors.push(ContentError::new(
                "family_guide_self_confusion",
                format!("family guide {label} must not confuse itself with itself"),
            ));
        }
        if !confusion_targets.insert(confusion.other_family_id.as_str()) {
            errors.push(ContentError::new(
                "family_guide_confusion_duplicate",
                format!(
                    "family guide {label} repeats confusion target {}",
                    confusion.other_family_id
                ),
            ));
        }
    }

    let mut context_ids = HashSet::new();
    for context in &guide.example_contexts {
        if context.context_id.trim().is_empty() || context.label.trim().is_empty() {
            errors.push(ContentError::new(
                "family_guide_context_empty",
                format!(
                    "family guide {label} example contexts must set a non-blank context_id and label"
                ),
            ));
            continue;
        }
        if !context_ids.insert(context.context_id.as_str()) {
            errors.push(ContentError::new(
                "family_guide_context_duplicate",
                format!(
                    "family guide {label} repeats example context {}",
                    context.context_id
                ),
            ));
        }
    }

    if guide.source_refs.is_empty() {
        errors.push(ContentError::new(
            "family_guide_source_refs_missing",
            format!("family guide {label} must reference at least one source"),
        ));
    }
    for source in &guide.source_refs {
        if source.title.trim().is_empty() || source.url.trim().is_empty() {
            errors.push(ContentError::new(
                "family_guide_source_ref_empty",
                format!("family guide {label} has an empty source reference"),
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Validates a phrase list for blanks and normalized duplicates.
fn validate_unique_phrases(
    phrases: &[String],
    empty_code: &'static str,
    duplicate_code: &'static str,
    kind: &str,
    label: &str,
    errors: &mut Vec<ContentError>,
) {
    let mut seen = HashSet::new();
    for phrase in phrases {
        if phrase.trim().is_empty() {
            errors.push(ContentError::new(
                empty_code,
                format!("family guide {label} has a blank {kind}"),
            ));
            continue;
        }
        if !seen.insert(normalize_phrase(phrase)) {
            errors.push(ContentError::new(
                duplicate_code,
                format!("family guide {label} repeats a {kind}"),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> SourceRef {
        SourceRef {
            title: "Source".to_owned(),
            url: "https://example.com".to_owned(),
        }
    }

    fn valid_guide() -> FamilyGuide {
        FamilyGuide {
            schema_version: FAMILY_GUIDE_SCHEMA_VERSION.to_owned(),
            certification_id: "dsa-track".to_owned(),
            certification_version: "dsa-v1".to_owned(),
            family_id: "dsa.sliding_window.variable".to_owned(),
            title: "Moving Valid Window".to_owned(),
            summary: "Maintain one active contiguous range as its boundaries move.".to_owned(),
            recognition_signals: vec![
                "candidate solutions are contiguous ranges".to_owned(),
                "one boundary adds state and the other removes it".to_owned(),
            ],
            core_rules: vec!["After repair, the active range is valid.".to_owned()],
            structural_steps: vec!["add the incoming item".to_owned()],
            common_confusions: vec![],
            example_contexts: vec![FamilyExampleContext {
                context_id: "api_rate_limiting".to_owned(),
                label: "API rate limiting".to_owned(),
            }],
            source_refs: vec![source()],
        }
    }

    #[test]
    fn valid_guide_passes() {
        validate_family_guide(&valid_guide()).expect("a complete guide is valid");
    }

    #[test]
    fn blank_identity_fields_are_rejected() {
        for field in [
            "family_id",
            "certification_id",
            "certification_version",
            "title",
            "summary",
        ] {
            let mut guide = valid_guide();
            match field {
                "family_id" => guide.family_id = "  ".to_owned(),
                "certification_id" => guide.certification_id = String::new(),
                "certification_version" => guide.certification_version = String::new(),
                "title" => guide.title = String::new(),
                _ => guide.summary = String::new(),
            }
            let errors = validate_family_guide(&guide).expect_err("blank field rejected");
            assert!(
                errors
                    .iter()
                    .any(|error| error.code == "family_guide_field_missing")
            );
        }
    }

    #[test]
    fn no_recognition_signals_is_rejected() {
        let mut guide = valid_guide();
        guide.recognition_signals.clear();
        let errors = validate_family_guide(&guide).expect_err("signals required");
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_recognition_signals_missing")
        );
    }

    #[test]
    fn blank_and_duplicate_signals_are_rejected() {
        let mut guide = valid_guide();
        guide.recognition_signals =
            vec!["a clue".to_owned(), "  ".to_owned(), "A   Clue".to_owned()];
        let errors = validate_family_guide(&guide).expect_err("bad signals rejected");
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_signal_empty")
        );
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_signal_duplicate")
        );
    }

    #[test]
    fn self_confusion_and_duplicates_are_rejected() {
        let mut guide = valid_guide();
        guide.common_confusions = vec![
            FamilyConfusion {
                other_family_id: guide.family_id.clone(),
                distinction: "same".to_owned(),
            },
            FamilyConfusion {
                other_family_id: "dsa.prefix_state".to_owned(),
                distinction: "a".to_owned(),
            },
            FamilyConfusion {
                other_family_id: "dsa.prefix_state".to_owned(),
                distinction: "b".to_owned(),
            },
        ];
        let errors = validate_family_guide(&guide).expect_err("bad confusions rejected");
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_self_confusion")
        );
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_confusion_duplicate")
        );
    }

    #[test]
    fn blank_confusion_distinction_is_rejected() {
        let mut guide = valid_guide();
        guide.common_confusions = vec![FamilyConfusion {
            other_family_id: "dsa.prefix_state".to_owned(),
            distinction: "  ".to_owned(),
        }];
        let errors = validate_family_guide(&guide).expect_err("blank distinction rejected");
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_confusion_empty")
        );
    }

    #[test]
    fn missing_source_refs_are_rejected() {
        let mut guide = valid_guide();
        guide.source_refs.clear();
        let errors = validate_family_guide(&guide).expect_err("sources required");
        assert!(
            errors
                .iter()
                .any(|error| error.code == "family_guide_source_refs_missing")
        );
    }

    #[test]
    fn guide_round_trips() {
        let guide = valid_guide();
        let encoded = serde_json::to_value(&guide).expect("serializes");
        let decoded: FamilyGuide = serde_json::from_value(encoded).expect("deserializes");
        assert_eq!(decoded, guide);

        let minimal = FamilyGuide {
            core_rules: vec![],
            structural_steps: vec![],
            common_confusions: vec![],
            example_contexts: vec![],
            ..valid_guide()
        };
        let encoded = serde_json::to_value(&minimal).expect("serializes");
        assert!(encoded.get("core_rules").is_none());
        assert!(encoded.get("structural_steps").is_none());
        assert!(encoded.get("common_confusions").is_none());
        assert!(encoded.get("example_contexts").is_none());
    }
}
