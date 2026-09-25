//! First-class practice tests (exam simulations).
//!
//! A practice test is a fixed, authored exam: the order is fixed, feedback is
//! delayed until submission, and there is a wall-clock time limit. It is a
//! distinct content type from an adaptive [`crate::model::ContentBundle`]:
//!
//! - a bundle's questions are selected dynamically by the adaptive engine;
//! - a practice test's items are presented in authored order, exactly once.
//!
//! A practice test reuses the shared [`Question`] representation for its items
//! so rendering and scoring stay generic, but it owns the exam-only concerns:
//! authored order, scored/unscored flags, the timer, and answer-hiding rules.
//!
//! Canonical answers are embedded in the JSON — they are server-side content
//! and must never be served to a learner before final submission. The API layer
//! is responsible for projecting learner-safe DTOs.
//!
//! Unlike a bundle question, a practice-test item may omit concept mappings.
//! That is deliberate: this migration authored no mappings, so practice-test
//! results must not feed concept mastery. Validation therefore does not require
//! concepts, structured error codes, or source references here.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::model::Question;
use crate::validate::{
    ContentError, interaction_matches, validate_canonical_answer, validate_interaction,
    validate_pedagogy,
};

/// The only supported practice-test schema version.
pub const PRACTICE_TEST_SCHEMA_VERSION: &str = "practice-test-v2";

/// A fixed, authored exam simulation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PracticeTest {
    /// Schema discriminator; must equal `practice-test-v2`.
    pub schema_version: String,
    /// Stable practice-test identifier.
    pub id: String,
    /// Learner-facing title.
    pub title: String,
    /// Official exam code, for example `SOA-C03`.
    pub exam_code: String,
    /// Certification version this test belongs to, for example `soa-c03`.
    pub certification_version: String,
    /// Immutable content version shared by the items.
    pub content_version: String,
    /// Authoring date, `YYYY-MM-DD`.
    #[serde(default)]
    pub created_at: Option<String>,
    /// Content language, for example `en`.
    #[serde(default)]
    pub language: Option<String>,
    /// Exam time limit in minutes. Always greater than zero.
    pub time_limit_minutes: i64,
    /// Declared item count; must equal `items.len()`.
    pub question_count: usize,
    /// Interaction/response types present in the test.
    #[serde(default)]
    pub question_types: Vec<String>,
    /// Authored items in presentation order.
    pub items: Vec<PracticeTestItem>,
    /// Authoring provenance. Opaque, server-only metadata.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub authorship: serde_json::Value,
    /// Official blueprint reference (counts, weights, scaled-score notes).
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub official_exam_reference: serde_json::Value,
    /// Authored exam behavior flags (hide answers, score only marked items).
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub practice_test_behavior: serde_json::Value,
    /// Authoring design notes.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub design_notes: serde_json::Value,
    /// Authoring validation report.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub validation: serde_json::Value,
    /// Factual review report.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub factual_review: serde_json::Value,
    /// Quality review report.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub quality_review: serde_json::Value,
    /// Schema migration notes.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub schema_migration: serde_json::Value,
}

/// One authored item in a practice test.
///
/// Exam-only concerns live here, not on the shared [`Question`]: presentation
/// order, whether the item counts toward the practice score, and the authored
/// scenario style used by authoring reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PracticeTestItem {
    /// 1-based position in the authored exam. Contiguous `1..=N`.
    pub order: i64,
    /// Whether the item counts toward the practice score.
    pub is_scored: bool,
    /// Authored scenario style, for example `full_operational_scenario`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario_style: Option<String>,
    /// The shared question the item presents.
    pub question: Question,
}

impl PracticeTest {
    /// Items that count toward the practice score.
    pub fn scored_items(&self) -> impl Iterator<Item = &PracticeTestItem> {
        self.items.iter().filter(|item| item.is_scored)
    }

    /// The number of items marked scored.
    pub fn scored_question_count(&self) -> usize {
        self.scored_items().count()
    }
}

/// Validates a practice test, returning every problem found.
///
/// Strict: malformed authored content is a CI/build failure, never a runtime
/// surprise. Concept mappings, structured error codes, and source references
/// are intentionally not required here (see the module docs).
pub fn validate_practice_test(test: &PracticeTest) -> Result<(), Vec<ContentError>> {
    let mut errors = Vec::new();

    if test.schema_version != PRACTICE_TEST_SCHEMA_VERSION {
        errors.push(ContentError::new(
            "practice_test_schema_unsupported",
            format!(
                "practice test {} schema_version must be {}",
                test.id, PRACTICE_TEST_SCHEMA_VERSION
            ),
        ));
    }

    for (field, value) in [
        ("id", &test.id),
        ("title", &test.title),
        ("exam_code", &test.exam_code),
        ("certification_version", &test.certification_version),
        ("content_version", &test.content_version),
    ] {
        if value.trim().is_empty() {
            errors.push(ContentError::new(
                "practice_test_field_missing",
                format!("practice test {field} must not be empty"),
            ));
        }
    }

    if test.time_limit_minutes <= 0 {
        errors.push(ContentError::new(
            "practice_test_time_limit_invalid",
            format!(
                "practice test {} time_limit_minutes must be greater than zero",
                test.id
            ),
        ));
    }

    if test.items.is_empty() {
        errors.push(ContentError::new(
            "practice_test_items_missing",
            format!("practice test {} must contain at least one item", test.id),
        ));
    }

    if test.question_count != test.items.len() {
        errors.push(ContentError::new(
            "practice_test_question_count_mismatch",
            format!(
                "practice test {} declares question_count {} but has {} items",
                test.id,
                test.question_count,
                test.items.len()
            ),
        ));
    }

    validate_item_order(test, &mut errors);

    let mut seen_question_ids = std::collections::HashSet::new();
    for item in &test.items {
        let question = &item.question;

        if question.id.trim().is_empty() || question.prompt.trim().is_empty() {
            errors.push(ContentError::new(
                "practice_test_question_field_missing",
                format!(
                    "practice test {} has an item with an empty question id or prompt",
                    test.id
                ),
            ));
        }

        if !seen_question_ids.insert(question.id.as_str()) {
            errors.push(ContentError::new(
                "practice_test_duplicate_question_id",
                format!(
                    "practice test {} repeats question id {}",
                    test.id, question.id
                ),
            ));
        }

        if question.content_version != test.content_version {
            errors.push(ContentError::new(
                "practice_test_content_version_mismatch",
                format!(
                    "practice test {} question {} content_version {} does not match {}",
                    test.id, question.id, question.content_version, test.content_version
                ),
            ));
        }

        if question.certification_version != test.certification_version {
            errors.push(ContentError::new(
                "practice_test_certification_version_mismatch",
                format!(
                    "practice test {} question {} certification_version {} does not match {}",
                    test.id,
                    question.id,
                    question.certification_version,
                    test.certification_version
                ),
            ));
        }

        if !(0.0..=1.0).contains(&question.difficulty_prior) {
            errors.push(ContentError::new(
                "practice_test_invalid_difficulty_prior",
                format!(
                    "practice test {} question {} difficulty_prior must be within [0, 1]",
                    test.id, question.id
                ),
            ));
        }

        if !interaction_matches(question) {
            errors.push(ContentError::new(
                "practice_test_interaction_type_mismatch",
                format!(
                    "practice test {} question {} interaction_type does not match its interaction",
                    test.id, question.id
                ),
            ));
        }

        if !test.question_types.is_empty() {
            let declared = question.interaction_type.as_str();
            if !test.question_types.iter().any(|kind| kind == declared) {
                errors.push(ContentError::new(
                    "practice_test_question_type_undeclared",
                    format!(
                        "practice test {} question {} uses undeclared type {declared}",
                        test.id, question.id
                    ),
                ));
            }
        }

        validate_interaction(question, &mut errors);
        validate_canonical_answer(question, &mut errors);
        validate_pedagogy(question, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Requires item orders to be unique and contiguous `1..=N`.
fn validate_item_order(test: &PracticeTest, errors: &mut Vec<ContentError>) {
    let mut orders: Vec<i64> = test.items.iter().map(|item| item.order).collect();
    orders.sort_unstable();

    let expected: Vec<i64> = (1..=test.items.len() as i64).collect();
    if orders != expected {
        errors.push(ContentError::new(
            "practice_test_item_order_invalid",
            format!(
                "practice test {} item order must be unique and contiguous 1..={}",
                test.id,
                test.items.len()
            ),
        ));
    }
}
