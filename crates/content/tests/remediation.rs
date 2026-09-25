//! Optional structured-error remediation metadata (`error_codes[].remediation`).
//!
//! Phase 3 adds an optional remediation target to a structured error definition.
//! These tests build bundles in memory so they prove the backward-compatibility
//! contract directly: an error definition with only `code` and `description`
//! keeps parsing and validating exactly as before.

use adaptive_learn_content::{
    ContentBundle, ContentError, ContentRegistry, EMBEDDED_LEARNING_SOURCES, EMBEDDED_SOURCES,
    validate,
};
use adaptive_learn_domain::{ErrorRemediation, PedagogyStage};
use serde_json::{Value, json};

/// A minimal, valid single-question bundle whose error code has no remediation.
fn base_bundle() -> Value {
    json!({
        "certification": {
            "id": "rem-test",
            "vendor": "Test Vendor",
            "name": "Remediation Test",
            "exam_code": "REM-TEST",
            "official_source_url": "https://example.com/blueprint",
            "last_reviewed": "2026-09-25"
        },
        "version": {
            "id": "rem-test",
            "exam_code": "REM-TEST",
            "effective_date": "2026-09-25",
            "content_version": "rem-test-v1",
            "domains": [
                {
                    "id": "domain-1",
                    "name": "Domain",
                    "weight": 1.0,
                    "tasks": [
                        { "id": "1.1", "name": "Task", "question_ids": ["rem-q-001"] }
                    ]
                }
            ]
        },
        "concepts": [
            { "id": "test.concept", "name": "Concept", "description": "A concept." },
            { "id": "test.narrow", "name": "Narrow", "description": "A narrower concept." }
        ],
        "questions": [
            {
                "id": "rem-q-001",
                "content_version": "rem-test-v1",
                "certification_version": "rem-test",
                "domain_id": "domain-1",
                "task_id": "1.1",
                "assessment_mode": "application",
                "interaction_type": "multiple_choice",
                "difficulty_prior": 0.4,
                "prompt": "Pick one.",
                "interaction": {
                    "type": "multiple_choice",
                    "choices": [
                        { "id": "a", "label": "A" },
                        { "id": "b", "label": "B" }
                    ]
                },
                "canonical_answer": { "type": "multiple_choice", "choice_id": "a" },
                "concepts": [{ "concept_id": "test.concept", "weight": 1.0 }],
                "explanation": "A fits.",
                "hints": [],
                "error_codes": [
                    { "code": "wrong_choice", "description": "A wrong choice was selected." }
                ],
                "source_refs": [
                    { "title": "Source", "url": "https://example.com/source" }
                ]
            }
        ]
    })
}

/// Attaches `remediation` to the first authored error code.
fn bundle_with_remediation(remediation: Value) -> Value {
    let mut value = base_bundle();
    value["questions"][0]["error_codes"][0]["remediation"] = remediation;
    value
}

fn parse(value: &Value) -> Result<ContentBundle, serde_json::Error> {
    serde_json::from_value(value.clone())
}

fn validated(value: &Value) -> Result<(), Vec<ContentError>> {
    validate(&parse(value).expect("bundle deserializes"))
}

fn expect_error(value: &Value, code: &str) {
    let errors = validated(value).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

/// A. An error definition without remediation must keep working unchanged.
#[test]
fn error_definition_without_remediation_still_validates() {
    let value = base_bundle();
    validated(&value).expect("an error definition without remediation is valid");

    let question = &parse(&value).expect("parses").questions[0];
    assert!(
        question.error_codes[0].remediation.is_none(),
        "absent remediation must deserialize as None"
    );

    let encoded = serde_json::to_value(question).expect("serializes");
    assert!(
        encoded["error_codes"][0].get("remediation").is_none(),
        "absent remediation must not be serialized"
    );
}

/// B. A full remediation object must parse and validate.
#[test]
fn full_remediation_metadata_validates() {
    let value = bundle_with_remediation(json!({
        "concept_ids": ["test.narrow"],
        "node_id": "node-x",
        "preferred_stage": "trace",
        "preferred_family_id": "dsa.binary_search.boundary",
        "min_scaffold_level": 2
    }));

    validated(&value).expect("full remediation metadata is valid");

    let question = &parse(&value).expect("parses").questions[0];
    let remediation = question.error_codes[0]
        .remediation
        .as_ref()
        .expect("remediation present");
    assert_eq!(remediation.concept_ids, vec!["test.narrow".to_owned()]);
    assert_eq!(remediation.node_id.as_deref(), Some("node-x"));
    assert_eq!(remediation.preferred_stage, Some(PedagogyStage::Trace));
    assert_eq!(
        remediation.preferred_family_id.as_deref(),
        Some("dsa.binary_search.boundary")
    );
    assert_eq!(remediation.min_scaffold_level, Some(2));
}

/// C. Any single field on its own is valid.
#[test]
fn partial_remediation_metadata_validates() {
    let value = bundle_with_remediation(json!({ "preferred_stage": "trace" }));

    validated(&value).expect("partial remediation metadata is valid");

    let question = &parse(&value).expect("parses").questions[0];
    let remediation = question.error_codes[0]
        .remediation
        .as_ref()
        .expect("remediation present");
    assert_eq!(remediation.preferred_stage, Some(PedagogyStage::Trace));
    assert!(remediation.concept_ids.is_empty());
    assert!(remediation.node_id.is_none());
}

/// D. A present-but-empty remediation object is rejected.
#[test]
fn empty_remediation_object_is_rejected() {
    expect_error(
        &bundle_with_remediation(json!({})),
        "error_remediation_empty",
    );
}

/// E. Present string ids must not be blank.
#[test]
fn blank_remediation_fields_are_rejected() {
    expect_error(
        &bundle_with_remediation(json!({ "concept_ids": [""] })),
        "error_remediation_concept_empty",
    );
    expect_error(
        &bundle_with_remediation(json!({ "node_id": "   " })),
        "error_remediation_field_empty",
    );
    expect_error(
        &bundle_with_remediation(json!({ "preferred_family_id": "" })),
        "error_remediation_field_empty",
    );
}

/// F. Duplicate remediation concept ids are rejected.
#[test]
fn duplicate_remediation_concepts_are_rejected() {
    expect_error(
        &bundle_with_remediation(json!({ "concept_ids": ["test.narrow", "test.narrow"] })),
        "error_remediation_duplicate_concept",
    );
}

/// G. The scaffold floor uses the same bounds as Phase 1.
#[test]
fn invalid_remediation_scaffold_level_is_rejected() {
    validated(&bundle_with_remediation(json!({ "min_scaffold_level": 0 })))
        .expect("scaffold floor 0 is valid");
    validated(&bundle_with_remediation(json!({ "min_scaffold_level": 6 })))
        .expect("scaffold floor 6 is valid");

    for invalid in [7, 8, 255] {
        expect_error(
            &bundle_with_remediation(json!({ "min_scaffold_level": invalid })),
            "error_remediation_scaffold_level_invalid",
        );
    }
}

/// H. Unknown stage values fail deserialization clearly, before validation.
#[test]
fn unknown_remediation_stage_fails_deserialization() {
    let value = bundle_with_remediation(json!({ "preferred_stage": "sliding_window" }));

    let error = parse(&value).expect_err("unknown stage must be rejected at parse time");
    assert!(
        error.to_string().contains("unknown variant"),
        "deserialization error must name the unknown variant, got: {error}"
    );
}

/// I. Remediation metadata survives a JSON round-trip.
#[test]
fn remediation_metadata_round_trips() {
    let value = bundle_with_remediation(json!({
        "concept_ids": ["test.narrow"],
        "node_id": "node-x",
        "preferred_stage": "diagnose",
        "preferred_family_id": "python.async.task_lifecycle",
        "min_scaffold_level": 3
    }));

    let bundle = parse(&value).expect("parses");
    let question = &bundle.questions[0];
    let encoded = serde_json::to_value(question).expect("serializes");
    let decoded: adaptive_learn_content::Question =
        serde_json::from_value(encoded).expect("deserializes");
    assert_eq!(decoded.error_codes, question.error_codes);

    let empty = ErrorRemediation::default();
    let encoded = serde_json::to_value(&empty).expect("serializes empty remediation");
    assert_eq!(encoded, json!({}));
}

/// Remediation concept ids must resolve inside a scored bundle.
#[test]
fn unknown_remediation_concept_is_rejected() {
    expect_error(
        &bundle_with_remediation(json!({ "concept_ids": ["test.missing"] })),
        "error_remediation_unknown_concept",
    );
}

// --- Registry: cross-source node reference checks ---

fn embedded_quiz_sources() -> Vec<String> {
    EMBEDDED_SOURCES
        .iter()
        .map(|source| source.json.to_owned())
        .collect()
}

fn embedded_learning_sources() -> Vec<String> {
    EMBEDDED_LEARNING_SOURCES
        .iter()
        .map(|source| source.json.to_owned())
        .collect()
}

/// Finds a soa-c03 quiz source with at least one question.
fn soa_quiz_index(sources: &[String]) -> usize {
    sources
        .iter()
        .position(|json| {
            serde_json::from_str::<Value>(json)
                .ok()
                .is_some_and(|value| {
                    value["version"]["id"].as_str() == Some("soa-c03")
                        && value["questions"]
                            .as_array()
                            .is_some_and(|questions| !questions.is_empty())
                })
        })
        .expect("an embedded soa-c03 quiz source exists")
}

/// A node id that exists in the soa-c03 learning map.
fn soa_node_id() -> String {
    embedded_learning_sources()
        .iter()
        .find_map(|json| {
            let value: Value = serde_json::from_str(json).ok()?;
            (value["certification_id"].as_str() == Some("aws-soa-c03")).then(|| {
                value["modules"][0]["nodes"][0]["id"]
                    .as_str()
                    .expect("a node id")
                    .to_owned()
            })
        })
        .expect("an embedded soa-c03 learning node exists")
}

/// A node id that exists only in a different certification version.
fn aip_node_id() -> String {
    embedded_learning_sources()
        .iter()
        .find_map(|json| {
            let value: Value = serde_json::from_str(json).ok()?;
            (value["certification_id"].as_str() == Some("aws-aip-c01")).then(|| {
                value["modules"][0]["nodes"][0]["id"]
                    .as_str()
                    .expect("a node id")
                    .to_owned()
            })
        })
        .expect("an embedded aip-c01 learning node exists")
}

fn registry_with_remediation_node(
    node_id: &str,
    with_learning: bool,
) -> Result<ContentRegistry, Vec<ContentError>> {
    let mut sources = embedded_quiz_sources();
    let index = soa_quiz_index(&sources);
    let mut value: Value = serde_json::from_str(&sources[index]).expect("valid json");
    value["questions"][0]["error_codes"][0]["remediation"] = json!({ "node_id": node_id });
    sources[index] = serde_json::to_string(&value).expect("serializes");

    let quiz_refs: Vec<&str> = sources.iter().map(String::as_str).collect();
    if with_learning {
        let learning = embedded_learning_sources();
        let learning_refs: Vec<&str> = learning.iter().map(String::as_str).collect();
        ContentRegistry::from_sources(&quiz_refs, &learning_refs)
    } else {
        ContentRegistry::from_sources(&quiz_refs, &[])
    }
}

#[test]
fn valid_remediation_node_reference_passes() {
    let node_id = soa_node_id();
    registry_with_remediation_node(&node_id, true).expect("a same-version node resolves");
}

#[test]
fn unknown_remediation_node_reference_fails() {
    let errors = registry_with_remediation_node("node-that-does-not-exist", true)
        .expect_err("an unknown node must be rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "error_remediation_unknown_node"),
        "expected error_remediation_unknown_node, got {errors:?}"
    );
}

#[test]
fn node_from_another_track_does_not_satisfy() {
    // The node exists, but only in aip-c01, not in soa-c03. Because soa-c03 has
    // learning content, the reference must fail rather than silently resolve.
    let errors = registry_with_remediation_node(&aip_node_id(), true)
        .expect_err("a node from another version must not satisfy the reference");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "error_remediation_unknown_node"),
        "expected error_remediation_unknown_node, got {errors:?}"
    );
}

#[test]
fn absent_learning_content_skips_the_node_check() {
    // A quiz bundle may be authored before its knowledge map; a remediation node
    // then cannot be cross-checked and must not block loading.
    registry_with_remediation_node("node-that-does-not-exist", false)
        .expect("the node check is skipped without learning content");
}
