//! Optional, track-agnostic pedagogical metadata (`pedagogy`).
//!
//! These tests build bundles in memory so they do not depend on which authored
//! files happen to be embedded, and they prove the backward-compatibility
//! contract directly: a question with no `pedagogy` keeps parsing and
//! validating exactly as before.
//!
//! Phase 1 is descriptive only. Nothing here asserts mastery, scoring, reward,
//! or selection behavior: those are unchanged by design.

use adaptive_learn_content::{ContentBundle, ContentError, validate};
use adaptive_learn_domain::{PedagogyMetadata, PedagogyStage};
use serde_json::{Value, json};

/// A minimal, valid single-question bundle with no `pedagogy`.
fn base_bundle() -> Value {
    json!({
        "certification": {
            "id": "ped-test",
            "vendor": "Test Vendor",
            "name": "Pedagogy Test",
            "exam_code": "PED-TEST",
            "official_source_url": "https://example.com/blueprint",
            "last_reviewed": "2026-09-25"
        },
        "version": {
            "id": "ped-test",
            "exam_code": "PED-TEST",
            "effective_date": "2026-09-25",
            "content_version": "ped-test-v1",
            "domains": [
                {
                    "id": "domain-1",
                    "name": "Domain",
                    "weight": 1.0,
                    "tasks": [
                        { "id": "1.1", "name": "Task", "question_ids": ["ped-q-001"] }
                    ]
                }
            ]
        },
        "concepts": [
            { "id": "test.concept", "name": "Concept", "description": "A concept." }
        ],
        "questions": [
            {
                "id": "ped-q-001",
                "content_version": "ped-test-v1",
                "certification_version": "ped-test",
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
            }
        ]
    })
}

/// Same bundle with a `pedagogy` object attached to the question.
fn bundle_with_pedagogy(pedagogy: Value) -> Value {
    let mut value = base_bundle();
    value["questions"][0]["pedagogy"] = pedagogy;
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

/// A. Existing content without `pedagogy` must keep loading unchanged.
#[test]
fn question_without_pedagogy_still_validates() {
    let value = base_bundle();
    validated(&value).expect("a question without pedagogy is valid");

    let question = &parse(&value).expect("parses").questions[0];
    assert!(
        question.pedagogy.is_none(),
        "absent pedagogy must deserialize as None"
    );

    // Serialization must not introduce a new `pedagogy` key: existing content
    // round-trips byte-for-byte apart from this contract.
    let encoded = serde_json::to_value(question).expect("serializes");
    assert!(
        encoded.get("pedagogy").is_none(),
        "absent pedagogy must not be serialized"
    );
}

/// B. A full metadata object must parse and validate.
#[test]
fn full_pedagogy_metadata_validates() {
    let value = bundle_with_pedagogy(json!({
        "family_id": "dsa.sliding_window.variable",
        "stage": "recognize",
        "scaffold_level": 2,
        "transfer_group_id": "moving_contiguous_range",
        "surface_context": "api_rate_limiting",
        "challenge_group_id": "rate-limit-01"
    }));

    validated(&value).expect("full pedagogy metadata is valid");

    let question = &parse(&value).expect("parses").questions[0];
    let pedagogy = question.pedagogy.as_ref().expect("pedagogy present");
    assert_eq!(
        pedagogy.family_id.as_deref(),
        Some("dsa.sliding_window.variable")
    );
    assert_eq!(pedagogy.stage, Some(PedagogyStage::Recognize));
    assert_eq!(pedagogy.scaffold_level, Some(2));
    assert_eq!(
        pedagogy.transfer_group_id.as_deref(),
        Some("moving_contiguous_range")
    );
    assert_eq!(
        pedagogy.surface_context.as_deref(),
        Some("api_rate_limiting")
    );
    assert_eq!(
        pedagogy.challenge_group_id.as_deref(),
        Some("rate-limit-01")
    );
}

/// C. Any single field on its own is valid.
#[test]
fn partial_pedagogy_metadata_validates() {
    let value = bundle_with_pedagogy(json!({ "stage": "diagnose" }));

    validated(&value).expect("partial pedagogy metadata is valid");

    let question = &parse(&value).expect("parses").questions[0];
    let pedagogy = question.pedagogy.as_ref().expect("pedagogy present");
    assert_eq!(pedagogy.stage, Some(PedagogyStage::Diagnose));
    assert!(pedagogy.family_id.is_none());
    assert!(pedagogy.scaffold_level.is_none());
}

/// D. Scaffold boundaries: 0 and 6 are valid, 7+ is not.
#[test]
fn scaffold_level_accepts_bounds_and_rejects_above_six() {
    validated(&bundle_with_pedagogy(json!({ "scaffold_level": 0 })))
        .expect("scaffold_level 0 is valid");
    validated(&bundle_with_pedagogy(json!({ "scaffold_level": 6 })))
        .expect("scaffold_level 6 is valid");

    for invalid in [7, 8, 255] {
        expect_error(
            &bundle_with_pedagogy(json!({ "scaffold_level": invalid })),
            "pedagogy_scaffold_level_invalid",
        );
    }
}

/// E. Present string fields must not be blank.
#[test]
fn blank_pedagogy_strings_are_rejected() {
    for field in [
        "family_id",
        "transfer_group_id",
        "surface_context",
        "challenge_group_id",
    ] {
        expect_error(
            &bundle_with_pedagogy(json!({ field: "" })),
            "pedagogy_field_empty",
        );
        expect_error(
            &bundle_with_pedagogy(json!({ field: "   " })),
            "pedagogy_field_empty",
        );
    }
}

/// F. Unknown stage values fail deserialization clearly, before validation.
#[test]
fn unknown_stage_fails_deserialization() {
    let value = bundle_with_pedagogy(json!({ "stage": "sliding_window" }));

    let error = parse(&value).expect_err("unknown stage must be rejected at parse time");
    let message = error.to_string();
    assert!(
        message.contains("unknown variant") && message.contains("sliding_window"),
        "deserialization error must name the unknown variant, got: {message}"
    );
}

/// G. Metadata survives a JSON serialize/deserialize round-trip.
#[test]
fn pedagogy_metadata_round_trips() {
    let value = bundle_with_pedagogy(json!({
        "family_id": "python.async.task_lifecycle",
        "stage": "trace",
        "scaffold_level": 1,
        "transfer_group_id": "async_cancellation",
        "surface_context": "background_worker",
        "challenge_group_id": "worker-lifecycle-01"
    }));

    let bundle = parse(&value).expect("parses");
    let question = &bundle.questions[0];
    let encoded = serde_json::to_value(question).expect("serializes");
    let decoded: adaptive_learn_content::Question =
        serde_json::from_value(encoded).expect("deserializes");
    assert_eq!(decoded.pedagogy, question.pedagogy);

    // An all-absent metadata object round-trips too.
    let empty = PedagogyMetadata {
        family_id: None,
        stage: None,
        scaffold_level: None,
        transfer_group_id: None,
        surface_context: None,
        challenge_group_id: None,
    };
    let encoded = serde_json::to_value(&empty).expect("serializes empty metadata");
    assert_eq!(encoded, json!({}));
    let decoded: PedagogyMetadata =
        serde_json::from_value(encoded).expect("deserializes empty metadata");
    assert_eq!(decoded, empty);
}

/// I. Every embedded quiz source still validates with the new contract.
#[test]
fn embedded_quiz_sources_still_validate() {
    for source in adaptive_learn_content::EMBEDDED_SOURCES {
        let bundle: ContentBundle = serde_json::from_str(source.json)
            .unwrap_or_else(|error| panic!("{} does not parse: {error}", source.path));
        if let Err(errors) = validate(&bundle) {
            panic!("{} is invalid: {errors:?}", source.path);
        }
    }
}

/// The eight generic stages are the whole vocabulary, and it stays
/// domain-neutral: no track-specific value is accepted.
#[test]
fn pedagogy_stage_vocabulary_is_generic() {
    for stage in [
        PedagogyStage::Discover,
        PedagogyStage::Recognize,
        PedagogyStage::Differentiate,
        PedagogyStage::Reason,
        PedagogyStage::Trace,
        PedagogyStage::Diagnose,
        PedagogyStage::Construct,
        PedagogyStage::Transfer,
    ] {
        assert_eq!(PedagogyStage::try_from(stage.as_str()), Ok(stage));
    }

    assert!(PedagogyStage::try_from("sliding_window").is_err());
    assert!(PedagogyStage::try_from("aws_service_selection").is_err());
}
