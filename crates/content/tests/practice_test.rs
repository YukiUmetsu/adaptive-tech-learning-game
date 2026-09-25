//! Practice-test (exam simulation) content coverage for the embedded SOA-C03
//! `practice-test-v2` file.

use adaptive_learn_content::{
    ContentRegistry, EMBEDDED_PRACTICE_TEST_SOURCES, PracticeTest, validate_practice_test,
};
use serde_json::Value;

fn soa_source() -> &'static str {
    EMBEDDED_PRACTICE_TEST_SOURCES
        .iter()
        .map(|source| source.json)
        .find(|json| json.contains("\"aws-soa-c03-practice-test-1\""))
        .expect("the SOA-C03 practice test is embedded")
}

fn parse(json: &str) -> PracticeTest {
    serde_json::from_str(json).expect("practice test parses")
}

fn embedded() -> PracticeTest {
    parse(soa_source())
}

fn source_value() -> Value {
    serde_json::from_str(soa_source()).expect("valid json")
}

fn expect_error(test: &PracticeTest, code: &str) {
    let errors = validate_practice_test(test).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

#[test]
fn practice_test_v2_parses_and_loads_every_item() {
    let test = embedded();
    assert_eq!(test.schema_version, "practice-test-v2");
    assert_eq!(test.id, "aws-soa-c03-practice-test-1");
    assert_eq!(test.question_count, test.items.len());
    assert_eq!(test.items.len(), 65);
    assert!(validate_practice_test(&test).is_ok());
}

#[test]
fn scored_and_unscored_items_are_exactly_as_authored() {
    let test = embedded();
    assert_eq!(test.scored_question_count(), 50);
    assert_eq!(test.items.len() - test.scored_question_count(), 15);
}

#[test]
fn response_type_counts_match_the_authored_test() {
    let test = embedded();
    let multiple_choice = test
        .items
        .iter()
        .filter(|item| item.question.interaction_type.as_str() == "multiple_choice")
        .count();
    let multiple_response = test
        .items
        .iter()
        .filter(|item| item.question.interaction_type.as_str() == "multiple_response")
        .count();
    assert_eq!(multiple_choice, 54);
    assert_eq!(multiple_response, 11);
}

#[test]
fn item_order_is_unique_and_contiguous() {
    let test = embedded();
    let mut orders: Vec<i64> = test.items.iter().map(|item| item.order).collect();
    orders.sort_unstable();
    assert_eq!(orders, (1..=test.items.len() as i64).collect::<Vec<_>>());
}

#[test]
fn practice_test_items_carry_no_invented_concept_mappings() {
    let test = embedded();
    assert!(
        test.items
            .iter()
            .all(|item| item.question.concepts.is_empty()),
        "this migration authored no concept mappings"
    );
}

#[test]
fn registry_exposes_the_practice_test_by_certification_and_version() {
    let registry = ContentRegistry::embedded().expect("embedded content is valid");
    let test = registry
        .practice_test("aws-soa-c03-practice-test-1")
        .expect("practice test is registered");
    assert_eq!(test.items.len(), 65);

    let by_certification = registry.practice_tests_for_certification("aws-soa-c03");
    assert!(
        by_certification
            .iter()
            .any(|test| test.id == "aws-soa-c03-practice-test-1")
    );

    let by_version = registry.practice_tests_for_version("soa-c03");
    assert!(
        by_version
            .iter()
            .any(|test| test.id == "aws-soa-c03-practice-test-1")
    );

    // Practice tests never load as scored quiz bundles.
    assert!(registry.bundle_for_version("practice-test-v2").is_none());
}

#[test]
fn embedded_quiz_content_still_validates() {
    // Strict validation covers quiz, learning, and practice content together.
    ContentRegistry::embedded().expect("embedded content must be valid");
}

#[test]
fn azure_practice_tests_are_embedded_and_discoverable() {
    let registry = ContentRegistry::embedded().expect("embedded content is valid");

    let az_900 = registry.practice_tests_for_certification("microsoft-az-900");
    assert_eq!(az_900.len(), 1, "AZ-900 has exactly one practice test");
    let az_900 = az_900[0];
    assert_eq!(az_900.id, "microsoft-az-900-practice-test-1");
    assert_eq!(az_900.certification_version, "az-900");
    assert_eq!(az_900.question_count, az_900.items.len());
    assert_eq!(az_900.items.len(), 50);

    let az_104 = registry.practice_tests_for_certification("microsoft-az-104");
    assert_eq!(az_104.len(), 1, "AZ-104 has exactly one practice test");
    let az_104 = az_104[0];
    assert_eq!(az_104.id, "microsoft-az-104-practice-test-1");
    assert_eq!(az_104.certification_version, "az-104");
    assert_eq!(az_104.question_count, az_104.items.len());
    assert_eq!(az_104.items.len(), 50);
    assert_eq!(az_104.scored_question_count(), 45);

    // The authored Azure exams mix tactile interactions, so the exam surface
    // must not assume choice-only questions.
    assert!(
        az_104
            .items
            .iter()
            .any(|item| item.question.interaction_type.as_str() != "multiple_choice"),
        "AZ-104 practice test includes non-choice interactions"
    );
}

#[test]
fn duplicate_practice_test_ids_are_rejected() {
    let errors = ContentRegistry::from_all_sources(&[], &[], &[soa_source(), soa_source()])
        .expect_err("duplicate ids must fail");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "duplicate_practice_test_id")
    );
}

#[test]
fn duplicate_question_ids_inside_one_test_are_rejected() {
    let mut value = source_value();
    let duplicate = value["items"][0]["question"].clone();
    value["items"][1]["question"] = duplicate;
    let test: PracticeTest = serde_json::from_value(value).expect("parses");

    expect_error(&test, "practice_test_duplicate_question_id");
}

#[test]
fn question_count_must_match_items() {
    let mut value = source_value();
    value["question_count"] = Value::from(1);
    let test: PracticeTest = serde_json::from_value(value).expect("parses");

    expect_error(&test, "practice_test_question_count_mismatch");
}

#[test]
fn item_order_gaps_are_rejected() {
    let mut value = source_value();
    value["items"][3]["order"] = Value::from(99);
    let test: PracticeTest = serde_json::from_value(value).expect("parses");

    expect_error(&test, "practice_test_item_order_invalid");
}

#[test]
fn time_limit_must_be_positive() {
    let mut value = source_value();
    value["time_limit_minutes"] = Value::from(0);
    let test: PracticeTest = serde_json::from_value(value).expect("parses");

    expect_error(&test, "practice_test_time_limit_invalid");
}

#[test]
fn schema_v1_is_rejected() {
    let mut value = source_value();
    value["schema_version"] = Value::from("practice-test-v1");
    let test: PracticeTest = serde_json::from_value(value).expect("parses");

    expect_error(&test, "practice_test_schema_unsupported");
}

#[test]
fn malformed_multiple_choice_with_one_option_fails() {
    let mut value = source_value();
    let item = value["items"]
        .as_array_mut()
        .expect("items")
        .iter_mut()
        .find(|item| item["question"]["interaction_type"] == "multiple_choice")
        .expect("a multiple-choice item");
    let choices = item["question"]["interaction"]["choices"]
        .as_array_mut()
        .expect("choices");
    choices.truncate(1);

    let test: PracticeTest = serde_json::from_value(value).expect("parses");
    expect_error(&test, "multiple_choice_incomplete");
}

#[test]
fn multiple_choice_canonical_choice_must_exist() {
    let mut value = source_value();
    let item = value["items"]
        .as_array_mut()
        .expect("items")
        .iter_mut()
        .find(|item| item["question"]["interaction_type"] == "multiple_choice")
        .expect("a multiple-choice item");
    item["question"]["canonical_answer"]["choice_id"] = Value::from("Z");

    let test: PracticeTest = serde_json::from_value(value).expect("parses");
    expect_error(&test, "canonical_unknown_choice");
}

#[test]
fn malformed_multiple_response_required_count_fails() {
    let mut value = source_value();
    let item = value["items"]
        .as_array_mut()
        .expect("items")
        .iter_mut()
        .find(|item| item["question"]["interaction_type"] == "multiple_response")
        .expect("a multiple-response item");
    item["question"]["interaction"]["required_selections"] = Value::from(1);

    let test: PracticeTest = serde_json::from_value(value).expect("parses");
    expect_error(&test, "multiple_response_required_invalid");
}

#[test]
fn multiple_response_canonical_ids_must_exist() {
    let mut value = source_value();
    let item = value["items"]
        .as_array_mut()
        .expect("items")
        .iter_mut()
        .find(|item| item["question"]["interaction_type"] == "multiple_response")
        .expect("a multiple-response item");
    item["question"]["canonical_answer"]["choice_ids"] =
        Value::from(vec!["Z".to_owned(), "Y".to_owned()]);

    let test: PracticeTest = serde_json::from_value(value).expect("parses");
    expect_error(&test, "canonical_unknown_choice");
}

#[test]
fn multiple_response_canonical_count_must_match_required_selections() {
    let mut value = source_value();
    let item = value["items"]
        .as_array_mut()
        .expect("items")
        .iter_mut()
        .find(|item| item["question"]["interaction_type"] == "multiple_response")
        .expect("a multiple-response item");
    // Keep valid ids but change the authored count away from the canonical set.
    item["question"]["interaction"]["required_selections"] = Value::from(3);

    let test: PracticeTest = serde_json::from_value(value).expect("parses");
    expect_error(&test, "canonical_response_count_mismatch");
}

#[test]
fn normal_bundles_still_require_concept_mappings() {
    // The practice test may omit concepts, but a quiz bundle must not.
    let demo = adaptive_learn_content::EMBEDDED_SOURCES
        .iter()
        .map(|source| source.json)
        .find(|json| json.contains("\"aws-soa-c03-demo\""))
        .expect("demo bundle");

    let mut value: Value = serde_json::from_str(demo).expect("valid json");
    value["questions"][0]["concepts"] = Value::from(Vec::<Value>::new());
    let bundle: adaptive_learn_content::ContentBundle =
        serde_json::from_value(value).expect("parses");
    let errors = adaptive_learn_content::validate(&bundle).expect_err("concepts are required");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "question_concepts_missing")
    );
}
