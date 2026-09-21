//! Glossary terms in learning content: parsing and validation.
//!
//! Terms are authored in the learning JSON and surfaced to the learner as
//! clickable explanations, so the loader must parse them and reject malformed
//! or duplicate entries.

use adaptive_learn_content::{EMBEDDED_LEARNING_SOURCES, LearningDomain, validate_learning_domain};
use serde_json::Value;

fn learning_domain_json(certification_id: &str, domain_id: &str) -> String {
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
        .unwrap_or_else(|| panic!("learning source for {certification_id}/{domain_id}"))
        .to_owned()
}

#[test]
fn authored_glossary_parses_and_validates() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let domain: LearningDomain = serde_json::from_str(&json).expect("learning domain parses");

    assert!(
        domain
            .glossary
            .iter()
            .any(|term| term.term == "guest memory"),
        "domain-1 defines the guest memory term"
    );
    assert!(
        domain
            .glossary
            .iter()
            .all(|term| !term.definition.trim().is_empty()),
        "every authored term has a definition"
    );

    validate_learning_domain(&domain).expect("authored domain is valid");
}

#[test]
fn duplicate_glossary_terms_are_rejected() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    let term = value["glossary"][0].clone();
    value["glossary"]
        .as_array_mut()
        .expect("glossary is an array")
        .push(term);

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    let errors = validate_learning_domain(&domain).expect_err("duplicate must fail");

    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_glossary_duplicate_term")
    );
}

#[test]
fn empty_glossary_fields_are_rejected() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    value["glossary"][0]["definition"] = Value::String(String::new());

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    let errors = validate_learning_domain(&domain).expect_err("empty definition must fail");

    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_glossary_field_missing")
    );
}
