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

#[test]
fn node_glossary_parses_and_validates() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    value["modules"][0]["nodes"][0]["glossary"] = serde_json::json!([
        { "term": "stateful firewall", "definition": "Remembers connection state." }
    ]);

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    validate_learning_domain(&domain).expect("node glossary is valid");

    let node = &domain.modules[0].nodes[0];
    assert_eq!(node.glossary.len(), 1);
    assert_eq!(node.glossary[0].term, "stateful firewall");
}

#[test]
fn node_glossary_may_override_a_domain_term() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    // Reuse the domain's own first term text on a node: that is an override,
    // not a duplicate, so it must validate.
    let term = value["glossary"][0].clone();
    value["modules"][0]["nodes"][0]["glossary"] = Value::Array(vec![term]);

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    validate_learning_domain(&domain).expect("node override is allowed");
}

#[test]
fn duplicate_node_glossary_terms_are_rejected() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    value["modules"][0]["nodes"][0]["glossary"] = serde_json::json!([
        { "term": "warm standby", "definition": "Reduced environment." },
        { "term": "Warm Standby", "definition": "Duplicate, different case." }
    ]);

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    let errors = validate_learning_domain(&domain).expect_err("duplicate node term must fail");

    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_glossary_duplicate_term")
    );
}

#[test]
fn empty_node_glossary_fields_are_rejected() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    value["modules"][0]["nodes"][0]["glossary"] =
        serde_json::json!([{ "term": "pilot light", "definition": "   " }]);

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    let errors = validate_learning_domain(&domain).expect_err("empty node field must fail");

    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_glossary_field_missing")
    );
}

#[test]
fn nodes_without_a_glossary_stay_valid() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let domain: LearningDomain = serde_json::from_str(&json).expect("parses");

    assert!(
        domain.nodes().all(|node| node.glossary.is_empty()),
        "the legacy shape omits node glossaries"
    );
    validate_learning_domain(&domain).expect("legacy domain is valid");
}
