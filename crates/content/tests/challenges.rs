//! Authored multi-stage challenges (`challenge-v1`).
//!
//! These tests build content in memory so they prove the contract directly:
//! a challenge orchestrates existing questions and nodes, references are
//! validated strictly, and an old track without challenges keeps working.

use adaptive_learn_content::{
    CHALLENGE_SCHEMA_VERSION, ChallengeDefinition, ChallengeStage, ContentError, ContentRegistry,
    validate_challenge,
};
use serde_json::{Value, json};

/// A minimal, valid single-question bundle a challenge can reference.
fn base_bundle() -> Value {
    json!({
        "certification": {
            "id": "ch-test",
            "vendor": "Test Vendor",
            "name": "Challenge Test",
            "exam_code": "CH-TEST",
            "official_source_url": "https://example.com/blueprint",
            "last_reviewed": "2026-09-25"
        },
        "version": {
            "id": "ch-test-v1",
            "exam_code": "CH-TEST",
            "effective_date": "2026-09-25",
            "content_version": "ch-test-content-v1",
            "domains": [
                {
                    "id": "domain-1",
                    "name": "Domain",
                    "weight": 1.0,
                    "tasks": [
                        { "id": "1.1", "name": "Task", "question_ids": ["ch-q1", "ch-q2"] }
                    ]
                }
            ]
        },
        "concepts": [
            { "id": "test.concept", "name": "Concept", "description": "A concept." }
        ],
        "questions": [
            {
                "id": "ch-q1",
                "content_version": "ch-test-content-v1",
                "certification_version": "ch-test-v1",
                "domain_id": "domain-1",
                "task_id": "1.1",
                "assessment_mode": "recognition",
                "interaction_type": "multiple_choice",
                "difficulty_prior": 0.3,
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
            },
            {
                "id": "ch-q2",
                "content_version": "ch-test-content-v1",
                "certification_version": "ch-test-v1",
                "domain_id": "domain-1",
                "task_id": "1.1",
                "assessment_mode": "application",
                "interaction_type": "multiple_choice",
                "difficulty_prior": 0.4,
                "prompt": "Pick one again.",
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

/// A valid challenge referencing the two base questions.
fn base_challenge() -> Value {
    json!({
        "schema_version": CHALLENGE_SCHEMA_VERSION,
        "id": "challenge-1",
        "title": "A Coherent Journey",
        "description": "A short brief.",
        "certification_id": "ch-test",
        "certification_version": "ch-test-v1",
        "domain_id": "domain-1",
        "estimated_minutes": 8,
        "stages": [
            { "type": "question", "id": "recognize", "order": 1, "question_id": "ch-q1" },
            { "type": "question", "id": "apply", "order": 2, "question_id": "ch-q2" }
        ]
    })
}

fn registry(quiz: &Value, challenge: &Value) -> Result<ContentRegistry, Vec<ContentError>> {
    let quiz = serde_json::to_string(quiz).expect("serialize quiz");
    let challenge = serde_json::to_string(challenge).expect("serialize challenge");
    ContentRegistry::from_all_sources_with_challenges(
        &[quiz.as_str()],
        &[],
        &[],
        &[challenge.as_str()],
    )
}

fn registry_expect_error(quiz: &Value, challenge: &Value, code: &str) {
    let errors = registry(quiz, challenge).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

fn parse_challenge(value: &Value) -> ChallengeDefinition {
    serde_json::from_value(value.clone()).expect("challenge deserializes")
}

fn expect_challenge_error(value: &Value, code: &str) {
    let challenge = parse_challenge(value);
    let errors = validate_challenge(&challenge).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

/// A. A valid challenge referencing existing questions loads.
#[test]
fn valid_challenge_loads() {
    let registry = registry(&base_bundle(), &base_challenge()).expect("valid challenge");
    let challenge = registry
        .challenge("ch-test", "challenge-1")
        .expect("challenge resolves");
    assert_eq!(challenge.title, "A Coherent Journey");
    assert_eq!(challenge.ordered_question_ids(), vec!["ch-q1", "ch-q2"]);
    assert_eq!(challenge.estimated_minutes(), 8);
}

/// B. Two challenges claiming the same id within a track version are rejected.
#[test]
fn duplicate_challenge_id_is_rejected() {
    let quiz = serde_json::to_string(&base_bundle()).unwrap();
    let challenge = serde_json::to_string(&base_challenge()).unwrap();
    let errors = ContentRegistry::from_all_sources_with_challenges(
        &[quiz.as_str()],
        &[],
        &[],
        &[challenge.as_str(), challenge.as_str()],
    )
    .expect_err("duplicate challenge id must fail");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "duplicate_challenge_id"),
        "got {errors:?}"
    );
}

/// C. Duplicate stage ids are rejected.
#[test]
fn duplicate_stage_id_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1]["id"] = json!("recognize");
    expect_challenge_error(&value, "challenge_stage_id_duplicate");
}

/// D. Duplicate stage order is rejected.
#[test]
fn duplicate_stage_order_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1]["order"] = json!(1);
    expect_challenge_error(&value, "challenge_stage_order_duplicate");
}

/// Non-contiguous stage order is rejected.
#[test]
fn non_contiguous_stage_order_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1]["order"] = json!(3);
    expect_challenge_error(&value, "challenge_stage_order_not_contiguous");
}

/// E. A missing referenced question is rejected.
#[test]
fn missing_referenced_question_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1]["question_id"] = json!("ch-q-missing");
    registry_expect_error(&base_bundle(), &value, "challenge_unknown_question");
}

/// F. A missing referenced node is rejected.
#[test]
fn missing_referenced_node_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1] = json!({
        "type": "learning_node",
        "id": "review",
        "order": 2,
        "node_id": "node-that-does-not-exist"
    });
    registry_expect_error(&base_bundle(), &value, "challenge_unknown_node");
}

/// G. A challenge for an unknown track/version is rejected.
#[test]
fn wrong_track_version_is_rejected() {
    let mut value = base_challenge();
    value["certification_version"] = json!("ch-test-v2");
    registry_expect_error(&base_bundle(), &value, "challenge_unknown_track");
}

/// A declared domain that does not exist is rejected.
#[test]
fn unknown_domain_is_rejected() {
    let mut value = base_challenge();
    value["domain_id"] = json!("domain-9");
    registry_expect_error(&base_bundle(), &value, "challenge_unknown_domain");
}

/// H. A referenced question authored for a different challenge group is rejected.
#[test]
fn mismatched_challenge_group_is_rejected() {
    let mut quiz = base_bundle();
    quiz["questions"][0]["pedagogy"] = json!({ "challenge_group_id": "some-other-challenge" });
    registry_expect_error(&quiz, &base_challenge(), "challenge_group_mismatch");
}

/// A referenced question authored for the same challenge group is accepted.
#[test]
fn matching_challenge_group_is_accepted() {
    let mut quiz = base_bundle();
    quiz["questions"][0]["pedagogy"] = json!({ "challenge_group_id": "challenge-1" });
    registry(&quiz, &base_challenge()).expect("matching group is valid");
}

/// I. A single-stage challenge is rejected.
#[test]
fn single_stage_challenge_is_rejected() {
    let mut value = base_challenge();
    value["stages"] = json!([
        { "type": "question", "id": "only", "order": 1, "question_id": "ch-q1" }
    ]);
    expect_challenge_error(&value, "challenge_stages_too_few");
}

/// A duplicate referenced activity is rejected.
#[test]
fn duplicate_activity_is_rejected() {
    let mut value = base_challenge();
    value["stages"][1]["question_id"] = json!("ch-q1");
    expect_challenge_error(&value, "challenge_stage_duplicate_activity");
}

/// Unknown schema version is rejected.
#[test]
fn unknown_schema_version_is_rejected() {
    let mut value = base_challenge();
    value["schema_version"] = json!("challenge-v9");
    expect_challenge_error(&value, "challenge_schema_unsupported");
}

/// J. Authored challenge data survives a JSON round-trip.
#[test]
fn challenge_round_trips() {
    let value = base_challenge();
    let challenge = parse_challenge(&value);
    let encoded = serde_json::to_value(&challenge).expect("serializes");
    let decoded: ChallengeDefinition = serde_json::from_value(encoded).expect("deserializes");
    assert_eq!(decoded, challenge);

    // Stage accessors are stable and order is derived deterministically.
    let stages: Vec<&ChallengeStage> = challenge.ordered_stages();
    assert_eq!(stages[0].id(), "recognize");
    assert_eq!(stages[0].question_id(), Some("ch-q1"));
    assert_eq!(stages[1].order(), 2);
}

/// A challenge with only learning-node stages is valid (no scored questions).
#[test]
fn node_only_challenge_is_valid_structurally() {
    let mut value = base_challenge();
    value["stages"] = json!([
        { "type": "learning_node", "id": "a", "order": 1, "node_id": "n1" },
        { "type": "learning_node", "id": "b", "order": 2, "node_id": "n2" }
    ]);
    // Structural validation passes; node existence is a registry concern.
    validate_challenge(&parse_challenge(&value)).expect("node-only stages are structurally valid");
}

/// The embedded sample challenge still validates with the real content.
#[test]
fn embedded_challenge_sources_still_validate() {
    for source in adaptive_learn_content::EMBEDDED_CHALLENGE_SOURCES {
        let challenge: ChallengeDefinition = serde_json::from_str(source.json)
            .unwrap_or_else(|error| panic!("{} does not parse: {error}", source.path));
        validate_challenge(&challenge)
            .unwrap_or_else(|errors| panic!("{} is invalid: {errors:?}", source.path));
    }
    // The embedded registry (which cross-checks references) loads.
    ContentRegistry::embedded().expect("embedded content with challenges is valid");
}
