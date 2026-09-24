//! Content validation tests. Each case mutates a real embedded bundle source so
//! the validator is exercised against production content shape.
//!
//! Quiz content is authored as a catalog skeleton plus per-domain files, and
//! `validate` is applied per source (the registry merges sources afterwards).
//! The mutation fixture is therefore a single SOA-C03 source that carries the
//! interaction shapes under test, and the validity check covers every embedded
//! source.

use adaptive_learn_content::{ContentBundle, ContentError, EMBEDDED_SOURCES, validate};
use serde_json::Value;

/// A real SOA-C03 quiz source with the interaction shapes the tests mutate.
///
/// Authored content is split across files and question order changes as content
/// grows, so the fixture is selected by shape rather than by filename, and tests
/// locate questions by type rather than by a hard-coded position.
fn embedded_value() -> Value {
    EMBEDDED_SOURCES
        .iter()
        .filter(|source| source.json.contains("\"aws-soa-c03\""))
        .filter_map(|source| serde_json::from_str::<Value>(source.json).ok())
        .find(|value| {
            let has = |interaction_type: &str| {
                value["questions"].as_array().is_some_and(|questions| {
                    questions
                        .iter()
                        .any(|question| question["interaction_type"] == interaction_type)
                })
            };
            value["questions"]
                .as_array()
                .is_some_and(|questions| !questions.is_empty())
                && has("classification")
                && has("node_connection")
                && has("ordering")
        })
        .expect("an SOA-C03 source with classification, node_connection, and ordering questions")
}

/// Index of the first question with the given interaction type.
fn question_index(value: &Value, interaction_type: &str) -> usize {
    value["questions"]
        .as_array()
        .expect("questions array")
        .iter()
        .position(|question| question["interaction_type"] == interaction_type)
        .unwrap_or_else(|| panic!("no {interaction_type} question in the bundle"))
}

/// Index of the first question whose canonical answer uses the given type.
fn canonical_index(value: &Value, answer_type: &str) -> usize {
    value["questions"]
        .as_array()
        .expect("questions array")
        .iter()
        .position(|question| question["canonical_answer"]["type"] == answer_type)
        .unwrap_or_else(|| panic!("no {answer_type} canonical answer in the bundle"))
}

fn validate_value(value: &Value) -> Result<(), Vec<ContentError>> {
    let bundle: ContentBundle =
        serde_json::from_value(value.clone()).expect("mutation remains deserializable");
    validate(&bundle)
}

fn expect_error(value: &Value, code: &str) {
    let errors = validate_value(value).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

#[test]
fn embedded_bundle_is_valid() {
    // Every embedded quiz source must validate on its own; the registry rejects
    // an invalid source before merging, so this mirrors the load contract.
    for source in EMBEDDED_SOURCES {
        let bundle: ContentBundle = serde_json::from_str(source.json)
            .unwrap_or_else(|error| panic!("{} does not parse: {error}", source.path));
        if let Err(errors) = validate(&bundle) {
            panic!("{} is invalid: {errors:?}", source.path);
        }
    }
}

#[test]
fn rejects_duplicate_concept_ids() {
    let mut value = embedded_value();
    let concept = value["concepts"][0].clone();
    value["concepts"]
        .as_array_mut()
        .expect("array")
        .push(concept);

    expect_error(&value, "duplicate_concept_id");
}

#[test]
fn rejects_unknown_concept_reference() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["concepts"][0]["concept_id"] = Value::from("aws.does_not_exist");

    expect_error(&value, "unknown_concept_id");
}

#[test]
fn rejects_duplicate_question_ids() {
    let mut value = embedded_value();
    let question = value["questions"][0].clone();
    value["questions"]
        .as_array_mut()
        .expect("array")
        .push(question);

    expect_error(&value, "duplicate_question_id");
}

#[test]
fn rejects_invalid_question_reference() {
    let mut value = embedded_value();
    value["version"]["domains"][0]["tasks"][0]["question_ids"]
        .as_array_mut()
        .expect("array")
        .push(Value::from("missing-question"));

    expect_error(&value, "question_reference_missing");
}

#[test]
fn rejects_invalid_edge() {
    let mut value = embedded_value();
    let index = question_index(&value, "node_connection");
    value["questions"][index]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("array")
        .push(Value::from(vec!["cloudwatch_alarm", "not_a_node"]));

    expect_error(&value, "canonical_edge_unknown_node");
}

#[test]
fn rejects_self_loop_edge() {
    let mut value = embedded_value();
    let index = question_index(&value, "node_connection");
    value["questions"][index]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("array")
        .push(Value::from(vec!["cloudwatch_alarm", "cloudwatch_alarm"]));

    expect_error(&value, "canonical_edge_self_loop");
}

#[test]
fn rejects_canonical_answer_referencing_unknown_item() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["canonical_answer"]["placements"]["ghost_item"] =
        Value::from("metric");

    expect_error(&value, "canonical_placements_incomplete");
}

#[test]
fn rejects_canonical_order_that_is_not_a_permutation() {
    let mut value = embedded_value();
    let index = canonical_index(&value, "ordering");
    value["questions"][index]["canonical_answer"]["ordered_ids"] =
        Value::from(vec!["not_a_real_step"]);

    expect_error(&value, "canonical_order_invalid");
}

#[test]
fn rejects_invalid_domain_weight() {
    let mut value = embedded_value();
    value["version"]["domains"][0]["weight"] = Value::from(0.0);

    expect_error(&value, "invalid_domain_weight");
}

#[test]
fn rejects_concept_weights_that_do_not_sum() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["concepts"][0]["weight"] = Value::from(0.4);

    expect_error(&value, "concept_weights_do_not_sum");
}

#[test]
fn rejects_missing_content_version() {
    let mut value = embedded_value();
    value["version"]["content_version"] = Value::from("");

    expect_error(&value, "content_version_missing");
}

#[test]
fn rejects_missing_exam_code() {
    let mut value = embedded_value();
    value["version"]["exam_code"] = Value::from("");

    expect_error(&value, "exam_code_missing");
}

#[test]
fn rejects_missing_structured_error_codes() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["error_codes"] = Value::from(Vec::<Value>::new());

    expect_error(&value, "error_codes_missing");
}

#[test]
fn rejects_interaction_type_mismatch() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["interaction_type"] = Value::from("ordering");

    expect_error(&value, "interaction_type_mismatch");
}

#[test]
fn rejects_invalid_difficulty_prior() {
    let mut value = embedded_value();
    let index = question_index(&value, "classification");
    value["questions"][index]["difficulty_prior"] = Value::from(1.5);

    expect_error(&value, "invalid_difficulty_prior");
}
