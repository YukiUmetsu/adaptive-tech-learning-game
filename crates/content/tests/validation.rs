//! Content validation tests. Each case mutates the real embedded bundle so the
//! validator is exercised against production content shape.

use adaptive_learn_content::{ContentBundle, ContentError, EMBEDDED_SOURCES, validate};
use serde_json::Value;

fn embedded_source() -> &'static str {
    EMBEDDED_SOURCES
        .iter()
        .copied()
        .find(|source| source.contains("\"aws-soa-c03\""))
        .expect("SOA-C03 content is embedded")
}

fn embedded_value() -> Value {
    serde_json::from_str(embedded_source()).expect("embedded bundle is valid json")
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
    assert!(validate_value(&embedded_value()).is_ok());
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
    value["questions"][0]["concepts"][0]["concept_id"] = Value::from("aws.does_not_exist");

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
    // First connection question is at index 2.
    value["questions"][2]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("array")
        .push(Value::from(vec!["cloudwatch_alarm", "not_a_node"]));

    expect_error(&value, "canonical_edge_unknown_node");
}

#[test]
fn rejects_self_loop_edge() {
    let mut value = embedded_value();
    value["questions"][2]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("array")
        .push(Value::from(vec!["cloudwatch_alarm", "cloudwatch_alarm"]));

    expect_error(&value, "canonical_edge_self_loop");
}

#[test]
fn rejects_canonical_answer_referencing_unknown_item() {
    let mut value = embedded_value();
    value["questions"][0]["canonical_answer"]["placements"]["ghost_item"] = Value::from("metric");

    expect_error(&value, "canonical_placements_incomplete");
}

#[test]
fn rejects_canonical_order_that_is_not_a_permutation() {
    let mut value = embedded_value();
    value["questions"][1]["canonical_answer"]["ordered_ids"] =
        Value::from(vec!["resource_publishes_metric"]);

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
    value["questions"][0]["concepts"][0]["weight"] = Value::from(0.4);

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
    value["questions"][0]["error_codes"] = Value::from(Vec::<Value>::new());

    expect_error(&value, "error_codes_missing");
}

#[test]
fn rejects_interaction_type_mismatch() {
    let mut value = embedded_value();
    value["questions"][0]["interaction_type"] = Value::from("ordering");

    expect_error(&value, "interaction_type_mismatch");
}

#[test]
fn rejects_invalid_difficulty_prior() {
    let mut value = embedded_value();
    value["questions"][0]["difficulty_prior"] = Value::from(1.5);

    expect_error(&value, "invalid_difficulty_prior");
}
