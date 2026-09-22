//! Progressive `text` reveal schema, validation, and completion semantics.
//!
//! The validation tests mutate a real embedded learning domain's first prompt so
//! the surrounding domain (and its coverage counts) stays valid, then assert the
//! validator accepts or rejects the authored spans. Completion tests exercise
//! the shared prompt-completion rule directly.

use std::collections::{BTreeMap, HashSet};

use adaptive_learn_content::{
    ContentError, EMBEDDED_LEARNING_SOURCES, KnowledgePrompt, LearningDomain, LearningReveal,
    PromptKind, is_prompt_complete, validate_learning_domain,
};
use serde_json::{Value, json};

fn learning_source(certification_id: &str, domain_id: &str) -> &'static str {
    EMBEDDED_LEARNING_SOURCES
        .iter()
        .map(|source| source.json)
        .find(|json| {
            serde_json::from_str::<Value>(json)
                .ok()
                .is_some_and(|value| {
                    value["certification_id"].as_str() == Some(certification_id)
                        && value["domain"]["id"].as_str() == Some(domain_id)
                })
        })
        .expect("learning source is embedded")
}

fn learning_value() -> Value {
    serde_json::from_str(learning_source("aws-soa-c03", "domain-1")).expect("valid json")
}

fn validate_value(value: &Value) -> Result<(), Vec<ContentError>> {
    let domain: LearningDomain =
        serde_json::from_value(value.clone()).expect("mutation remains deserializable");
    validate_learning_domain(&domain)
}

fn expect_error(value: &Value, code: &str) {
    let errors = validate_value(value).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

fn set_reveal(value: &mut Value, reveal: Value) {
    value["modules"][0]["nodes"][0]["prompts"][0]["reveal"] = reveal;
}

/// The canonical two-span example from the feature request.
fn security_groups_reveal() -> Value {
    json!({
        "type": "text",
        "text": "Security groups are stateful, while network ACLs are stateless.",
        "progressive_reveal": {
            "spans": [
                { "id": "sg-state", "text": "stateful", "required": true },
                { "id": "nacl-state", "text": "stateless", "required": true }
            ]
        }
    })
}

fn reveal_from(value: Value) -> LearningReveal {
    serde_json::from_value(value).expect("reveal deserializes")
}

fn prompt(reveal: LearningReveal) -> KnowledgePrompt {
    KnowledgePrompt {
        id: "p1".to_owned(),
        kind: PromptKind::What,
        label: "WHAT".to_owned(),
        placeholder: "Reveal the hidden terms.".to_owned(),
        required: true,
        reveal,
    }
}

fn elements<'a>(ids: &[&'a str]) -> BTreeMap<&'a str, HashSet<&'a str>> {
    BTreeMap::from([("p1", ids.iter().copied().collect())])
}

#[test]
fn accepts_a_single_span() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "A NAT gateway provides outbound internet access for private workloads.",
            "progressive_reveal": {
                "spans": [{ "id": "nat-out", "text": "outbound internet access" }]
            }
        }),
    );

    assert!(
        validate_value(&value).is_ok(),
        "{:?}",
        validate_value(&value)
    );
}

#[test]
fn accepts_a_multi_word_phrase_span() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful, while network ACLs are stateless.",
            "progressive_reveal": {
                "spans": [{ "id": "nacl-state", "text": "network ACLs are stateless" }]
            }
        }),
    );

    assert!(validate_value(&value).is_ok());
}

#[test]
fn accepts_multiple_spans_and_defaults_required_true() {
    let mut value = learning_value();
    let reveal = security_groups_reveal();
    set_reveal(&mut value, reveal.clone());
    assert!(validate_value(&value).is_ok());

    // `required` is omitted in this authored shape; it must default to true.
    let parsed = reveal_from(json!({
        "type": "text",
        "text": "Security groups are stateful, while network ACLs are stateless.",
        "progressive_reveal": {
            "spans": [
                { "id": "sg-state", "text": "stateful" },
                { "id": "nacl-state", "text": "stateless" }
            ]
        }
    }));
    let LearningReveal::Text {
        progressive_reveal: Some(progressive),
        ..
    } = parsed
    else {
        panic!("expected progressive text reveal");
    };
    assert!(progressive.spans.iter().all(|span| span.required));
    assert!(progressive.spans.iter().all(|span| span.occurrence == 1));
}

#[test]
fn rejects_duplicate_span_ids() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful, while network ACLs are stateless.",
            "progressive_reveal": {
                "spans": [
                    { "id": "same", "text": "stateful" },
                    { "id": "same", "text": "stateless" }
                ]
            }
        }),
    );

    expect_error(&value, "learning_text_span_duplicate_id");
}

#[test]
fn rejects_span_text_that_is_not_in_the_reveal() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful.",
            "progressive_reveal": {
                "spans": [{ "id": "ghost", "text": "stateless" }]
            }
        }),
    );

    expect_error(&value, "learning_text_span_target_missing");
}

#[test]
fn rejects_overlapping_spans() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful, while network ACLs are stateless.",
            "progressive_reveal": {
                "spans": [
                    { "id": "inner", "text": "stateful" },
                    { "id": "outer", "text": "are stateful, while" }
                ]
            }
        }),
    );

    expect_error(&value, "learning_text_span_overlap");
}

#[test]
fn rejects_empty_span_fields() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful.",
            "progressive_reveal": {
                "spans": [
                    { "id": "", "text": "stateful" },
                    { "id": "ok", "text": "   " }
                ]
            }
        }),
    );

    expect_error(&value, "learning_text_span_field_missing");
}

#[test]
fn rejects_an_empty_span_list() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "Security groups are stateful.",
            "progressive_reveal": { "spans": [] }
        }),
    );

    expect_error(&value, "learning_text_reveal_empty");
}

#[test]
fn repeated_text_is_resolved_deterministically_by_occurrence() {
    let mut value = learning_value();
    // The word `the` appears twice; the second occurrence is explicit.
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "the cat sat on the mat",
            "progressive_reveal": {
                "spans": [{ "id": "second-the", "text": "the", "occurrence": 2 }]
            }
        }),
    );
    assert!(validate_value(&value).is_ok());

    // An occurrence beyond the number of matches must fail loudly.
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "the cat sat on the mat",
            "progressive_reveal": {
                "spans": [{ "id": "third-the", "text": "the", "occurrence": 3 }]
            }
        }),
    );
    expect_error(&value, "learning_text_span_occurrence_invalid");
}

#[test]
fn rejects_overlapping_occurrences_of_repeated_text() {
    let mut value = learning_value();
    // Both spans resolve to the same word, so their ranges overlap.
    set_reveal(
        &mut value,
        json!({
            "type": "text",
            "text": "the cat sat on the mat",
            "progressive_reveal": {
                "spans": [
                    { "id": "first", "text": "the", "occurrence": 1 },
                    { "id": "also-first", "text": "the", "occurrence": 1 }
                ]
            }
        }),
    );
    expect_error(&value, "learning_text_span_overlap");
}

#[test]
fn old_text_reveal_json_still_parses_and_serializes_unchanged() {
    let reveal = reveal_from(json!({ "type": "text", "text": "Records API activity." }));
    let LearningReveal::Text {
        text,
        progressive_reveal,
    } = &reveal
    else {
        panic!("expected text reveal");
    };
    assert_eq!(text, "Records API activity.");
    assert!(progressive_reveal.is_none());

    let serialized = serde_json::to_value(&reveal).expect("serialize");
    assert_eq!(serialized["type"], "text");
    assert_eq!(serialized["text"], "Records API activity.");
    assert!(serialized.get("progressive_reveal").is_none());

    // And the whole domain still validates with the legacy text reveal intact.
    let value = learning_value();
    assert!(validate_value(&value).is_ok());
}

#[test]
fn completion_requires_every_required_span() {
    let prompt = prompt(reveal_from(security_groups_reveal()));

    assert!(!is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&[])
    ));
    assert!(!is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&["span:sg-state"])
    ));
    // Revealing the prompt itself is not enough; the spans are the units.
    let revealed_prompt = HashSet::from(["p1"]);
    assert!(!is_prompt_complete(
        &prompt,
        &revealed_prompt,
        &elements(&["span:sg-state"])
    ));
    assert!(is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&["span:sg-state", "span:nacl-state"])
    ));
}

#[test]
fn optional_spans_do_not_block_and_do_not_complete() {
    let prompt = prompt(reveal_from(json!({
        "type": "text",
        "text": "Security groups are stateful, while network ACLs are stateless.",
        "progressive_reveal": {
            "spans": [
                { "id": "sg-state", "text": "stateful", "required": false },
                { "id": "nacl-state", "text": "stateless", "required": false }
            ]
        }
    })));

    // Optional spans alone never complete the prompt.
    assert!(!is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&["span:sg-state", "span:nacl-state"])
    ));
    // With no required spans, an explicit prompt reveal completes it, matching
    // code files without required annotations.
    assert!(is_prompt_complete(
        &prompt,
        &HashSet::from(["p1"]),
        &elements(&["span:sg-state"])
    ));
}

#[test]
fn required_and_optional_spans_mix_without_optional_blocking() {
    let prompt = prompt(reveal_from(json!({
        "type": "text",
        "text": "Security groups are stateful, while network ACLs are stateless.",
        "progressive_reveal": {
            "spans": [
                { "id": "sg-state", "text": "stateful", "required": true },
                { "id": "nacl-state", "text": "stateless", "required": false }
            ]
        }
    })));

    assert!(!is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&["span:nacl-state"])
    ));
    assert!(is_prompt_complete(
        &prompt,
        &HashSet::new(),
        &elements(&["span:sg-state"])
    ));
}
