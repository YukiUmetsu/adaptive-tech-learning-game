//! Family guides (`family-guide-v1`): authored reusable deep-structure content.
//!
//! These tests build registries from in-repo fixtures across several subjects so
//! the family-guide contract is proven track-agnostic and backward-compatible.
//! A track with no guides must keep loading and behaving exactly as before.

use adaptive_learn_content::{
    ContentRegistry, FAMILY_GUIDE_SCHEMA_VERSION, FamilyConfusion, FamilyGuide,
    validate_family_guide,
};
use serde_json::json;

fn dsa_sliding_window() -> String {
    include_str!("fixtures/family_guides/dsa_sliding_window.json").to_owned()
}
fn dsa_prefix_state() -> String {
    include_str!("fixtures/family_guides/dsa_prefix_state.json").to_owned()
}
fn python_async() -> String {
    include_str!("fixtures/family_guides/python_async.json").to_owned()
}
fn aws_decoupling() -> String {
    include_str!("fixtures/family_guides/aws_decoupling.json").to_owned()
}
fn aws_pubsub() -> String {
    include_str!("fixtures/family_guides/aws_pubsub.json").to_owned()
}
fn ml_data_leakage() -> String {
    include_str!("fixtures/family_guides/ml_data_leakage.json").to_owned()
}
fn ml_overfitting() -> String {
    include_str!("fixtures/family_guides/ml_overfitting.json").to_owned()
}

/// Every subject fixture, as one guide source set.
fn all_fixtures() -> Vec<String> {
    vec![
        dsa_sliding_window(),
        dsa_prefix_state(),
        python_async(),
        aws_decoupling(),
        aws_pubsub(),
        ml_data_leakage(),
        ml_overfitting(),
    ]
}

fn registry_with_guides(
    guides: &[String],
) -> Result<ContentRegistry, Vec<adaptive_learn_content::ContentError>> {
    let refs: Vec<&str> = guides.iter().map(String::as_str).collect();
    ContentRegistry::from_all_sources_with_families(&[], &[], &[], &[], &refs)
}

/// A. Every cross-subject fixture is structurally valid and loads.
#[test]
fn cross_subject_fixtures_load() {
    let registry = registry_with_guides(&all_fixtures()).expect("fixtures are valid");
    assert_eq!(registry.family_guides().len(), 7);

    let dsa = registry
        .family_guide("dsa-v1", "dsa.sliding_window.variable")
        .expect("dsa guide resolves");
    assert_eq!(dsa.title, "Moving Valid Window");
    assert_eq!(
        dsa.context_label("api_rate_limiting"),
        Some("API rate limiting")
    );

    // The same code path handles every subject; nothing branches on the id.
    for (version, family) in [
        ("dsa-v1", "dsa.sliding_window.variable"),
        ("python-fluency-v1", "python.async.task_lifecycle"),
        ("soa-c03", "aws.messaging.decoupling"),
        ("python-data-stack-v1", "ml.data_leakage"),
    ] {
        assert!(
            registry.family_guide(version, family).is_some(),
            "expected {family} to resolve in {version}"
        );
    }

    assert_eq!(
        registry
            .family_guides_for_certification("aws-soa-c03")
            .len(),
        2
    );
    assert_eq!(registry.family_guides_for_version("dsa-v1").len(), 2);
    assert!(registry.family_guide("dsa-v1", "dsa.missing").is_none());
}

/// B. A confusion target must resolve within the same track version.
#[test]
fn unknown_confusion_target_is_rejected() {
    let mut guide = serde_json::from_str::<FamilyGuide>(&dsa_sliding_window()).expect("parses");
    guide.common_confusions = vec![FamilyConfusion {
        other_family_id: "dsa.not_authored".to_owned(),
        distinction: "Some distinction.".to_owned(),
    }];
    let encoded = serde_json::to_string(&guide).expect("serializes");

    let errors = registry_with_guides(&[encoded]).expect_err("unknown target is rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "family_guide_unknown_confusion_family"),
        "expected family_guide_unknown_confusion_family, got {errors:?}"
    );
}

/// C. Duplicate guides for one family/version are rejected.
#[test]
fn duplicate_family_guide_is_rejected() {
    let errors = registry_with_guides(&[dsa_sliding_window(), dsa_sliding_window()])
        .expect_err("duplicate guide is rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "duplicate_family_guide"),
        "expected duplicate_family_guide, got {errors:?}"
    );
}

/// D. Malformed guide JSON reports the file-specific parse error.
#[test]
fn malformed_family_guide_json_is_reported() {
    let errors = registry_with_guides(&["{\"not\":\"a guide\"}".to_owned()])
        .expect_err("malformed guide is rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "invalid_family_guide_json"),
        "expected invalid_family_guide_json, got {errors:?}"
    );
}

/// E. A track with no family guides loads exactly as before.
#[test]
fn tracks_without_guides_still_load() {
    let registry = registry_with_guides(&[]).expect("empty guide set is valid");
    assert!(registry.family_guides().is_empty());
    // The committed production content currently authors no guides; the strict
    // embedded registry must still load and expose an empty guide set.
    let embedded = ContentRegistry::embedded().expect("embedded content is valid");
    assert!(embedded.family_guides().is_empty());
}

/// F. Missing-guide audit reports question families without a guide.
#[test]
fn missing_guides_are_reported_without_failing() {
    let bundle = quiz_bundle_with_family("dsa.sliding_window.variable");

    // With no guide authored, the family is reported as missing and the
    // registry still loads.
    let registry = ContentRegistry::from_all_sources_with_families(&[&bundle], &[], &[], &[], &[])
        .expect("a bundle without guides loads");
    assert_eq!(
        registry.families_missing_guides("audit-v1"),
        vec!["dsa.sliding_window.variable".to_owned()]
    );

    // Authoring the guide clears the audit warning.
    let registry = ContentRegistry::from_all_sources_with_families(
        &[&bundle],
        &[],
        &[],
        &[],
        &[&dsa_sliding_window_audit()],
    )
    .expect("bundle plus guide loads");
    assert!(registry.families_missing_guides("audit-v1").is_empty());
}

/// A minimal valid single-question bundle carrying `pedagogy.family_id`.
fn quiz_bundle_with_family(family_id: &str) -> String {
    json!({
        "certification": {
            "id": "audit-track",
            "vendor": "Test Vendor",
            "name": "Audit Test",
            "exam_code": "AUDIT-TEST",
            "official_source_url": "https://example.com/blueprint",
            "last_reviewed": "2026-09-25"
        },
        "version": {
            "id": "audit-v1",
            "exam_code": "AUDIT-TEST",
            "effective_date": "2026-09-25",
            "content_version": "audit-v1-content",
            "domains": [{
                "id": "domain-1",
                "name": "Domain",
                "weight": 1.0,
                "tasks": [{ "id": "1.1", "name": "Task", "question_ids": ["audit-q-001"] }]
            }]
        },
        "concepts": [
            { "id": "test.concept", "name": "Concept", "description": "A concept." }
        ],
        "questions": [{
            "id": "audit-q-001",
            "content_version": "audit-v1-content",
            "certification_version": "audit-v1",
            "domain_id": "domain-1",
            "task_id": "1.1",
            "assessment_mode": "application",
            "interaction_type": "multiple_choice",
            "difficulty_prior": 0.3,
            "pedagogy": { "family_id": family_id, "surface_context": "api_rate_limiting" },
            "prompt": "Pick one.",
            "interaction": {
                "type": "multiple_choice",
                "choices": [{ "id": "a", "label": "A" }, { "id": "b", "label": "B" }]
            },
            "canonical_answer": { "type": "multiple_choice", "choice_id": "a" },
            "concepts": [{ "concept_id": "test.concept", "weight": 1.0 }],
            "explanation": "A fits.",
            "hints": [],
            "error_codes": [{ "code": "wrong_choice", "description": "Wrong." }],
            "source_refs": [{ "title": "Source", "url": "https://example.com/source" }]
        }]
    })
    .to_string()
}

/// The DSA guide retargeted to the audit track/version.
fn dsa_sliding_window_audit() -> String {
    let mut guide: FamilyGuide =
        serde_json::from_str(&dsa_sliding_window()).expect("fixture parses");
    guide.certification_id = "audit-track".to_owned();
    guide.certification_version = "audit-v1".to_owned();
    guide.common_confusions.clear();
    serde_json::to_string(&guide).expect("serializes")
}

/// G. Local validation rejects structural problems before any cross-check.
#[test]
fn local_validation_rejects_bad_guides() {
    let mut value: serde_json::Value =
        serde_json::from_str(&dsa_sliding_window()).expect("valid json");

    value["recognition_signals"] = json!([]);
    let guide: FamilyGuide = serde_json::from_value(value.clone()).expect("parses");
    let errors = validate_family_guide(&guide).expect_err("signals required");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "family_guide_recognition_signals_missing")
    );

    value["recognition_signals"] = json!(["clue"]);
    value["common_confusions"] = json!([
        { "other_family_id": "dsa.sliding_window.variable", "distinction": "same" }
    ]);
    let guide: FamilyGuide = serde_json::from_value(value).expect("parses");
    let errors = validate_family_guide(&guide).expect_err("self confusion rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "family_guide_self_confusion")
    );
}

/// H. Absent optional lists are omitted from serialization and round-trip.
#[test]
fn optional_lists_are_omitted_and_round_trip() {
    let mut guide = serde_json::from_str::<FamilyGuide>(&python_async()).expect("parses");
    guide.core_rules.clear();
    guide.structural_steps.clear();
    guide.common_confusions.clear();
    guide.example_contexts.clear();

    let encoded = serde_json::to_value(&guide).expect("serializes");
    for key in [
        "core_rules",
        "structural_steps",
        "common_confusions",
        "example_contexts",
    ] {
        assert!(
            encoded.get(key).is_none(),
            "{key} must be omitted when empty"
        );
    }
    let decoded: FamilyGuide = serde_json::from_value(encoded).expect("deserializes");
    assert_eq!(decoded, guide);
}

/// I. The schema constant is the only accepted version.
#[test]
fn schema_version_is_enforced() {
    assert_eq!(FAMILY_GUIDE_SCHEMA_VERSION, "family-guide-v1");
    let mut value: serde_json::Value =
        serde_json::from_str(&dsa_sliding_window()).expect("valid json");
    value["schema_version"] = json!("family-guide-v2");
    let guide: FamilyGuide = serde_json::from_value(value).expect("parses");
    let errors = validate_family_guide(&guide).expect_err("version rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "family_guide_schema_unsupported")
    );
}
