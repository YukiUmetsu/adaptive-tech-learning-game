//! Glossary terms in learning content: parsing and validation.
//!
//! Terms are authored in the learning JSON and surfaced to the learner as
//! clickable explanations, so the loader must parse them and reject malformed
//! or duplicate entries. A domain defines shared terms; a node may add its own
//! or override a domain term. Content may author either level, so the tests
//! inject the shape under test rather than assuming a particular revision.

use adaptive_learn_content::{EMBEDDED_LEARNING_SOURCES, LearningDomain, validate_learning_domain};
use serde_json::{Value, json};

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

/// An authored domain with its domain-level glossary replaced by `glossary`.
fn domain_value_with_glossary(glossary: Value) -> Value {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    value["glossary"] = glossary;
    value
}

#[test]
fn authored_glossary_parses_and_validates() {
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let domain: LearningDomain = serde_json::from_str(&json).expect("learning domain parses");

    // Content may author terms at the domain level, the node level, or both.
    let domain_terms = domain.glossary.len();
    let node_terms: usize = domain.nodes().map(|node| node.glossary.len()).sum();
    assert!(
        domain_terms + node_terms > 0,
        "authored content defines at least one glossary term"
    );
    assert!(
        domain
            .glossary
            .iter()
            .all(|term| !term.definition.trim().is_empty()),
        "every authored domain term has a definition"
    );
    for node in domain.nodes() {
        assert!(
            node.glossary
                .iter()
                .all(|term| !term.definition.trim().is_empty()),
            "every authored node term has a definition"
        );
    }

    validate_learning_domain(&domain).expect("authored domain is valid");
}

#[test]
fn duplicate_glossary_terms_are_rejected() {
    let term = json!({ "term": "guest memory", "definition": "Memory assigned to a guest." });
    let mut value = domain_value_with_glossary(Value::Array(vec![term.clone(), term]));

    let domain: LearningDomain = serde_json::from_value(value.clone()).expect("parses");
    let errors = validate_learning_domain(&domain).expect_err("duplicate must fail");

    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_glossary_duplicate_term")
    );

    // Sanity: the same shape without the duplicate validates.
    value["glossary"] = Value::Array(vec![json!({
        "term": "guest memory",
        "definition": "Memory assigned to a guest."
    })]);
    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    validate_learning_domain(&domain).expect("a single term is valid");
}

#[test]
fn empty_glossary_fields_are_rejected() {
    let value = domain_value_with_glossary(json!([{ "term": "guest memory", "definition": "" }]));

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
    let term = json!({ "term": "stateful firewall", "definition": "Remembers connection state." });
    let mut value = domain_value_with_glossary(Value::Array(vec![term.clone()]));
    // Reuse the domain's own term text on a node: that is an override, not a
    // duplicate, so it must validate.
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
    // The `glossary` field is optional on a node; a domain authored without node
    // glossaries must still parse and validate.
    let json = learning_domain_json("aws-soa-c03", "domain-1");
    let mut value: Value = serde_json::from_str(&json).expect("valid json");
    for module in value["modules"].as_array_mut().expect("modules") {
        for node in module["nodes"].as_array_mut().expect("nodes") {
            node.as_object_mut()
                .expect("node object")
                .remove("glossary");
        }
    }

    let domain: LearningDomain = serde_json::from_value(value).expect("parses");
    assert!(
        domain.nodes().all(|node| node.glossary.is_empty()),
        "the legacy shape omits node glossaries"
    );
    validate_learning_domain(&domain).expect("legacy domain is valid");
}
