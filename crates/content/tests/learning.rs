//! Learning content loading and validation against the real SOA-C03 files.
//!
//! These tests exercise the authored curriculum directly: the embedded learning
//! sources are the source of truth, and mutations prove the validator fails
//! loudly on malformed knowledge maps.

use adaptive_learn_content::{
    ContentError, ContentRegistry, EMBEDDED_LEARNING_SOURCES, EMBEDDED_SOURCES, LearningDomain,
    LearningReveal, PromptKind, validate_learning_domain,
};
use serde_json::Value;

fn registry() -> ContentRegistry {
    ContentRegistry::embedded().expect("embedded content must be valid")
}

fn learning_source_for(certification_id: &str, domain_id: &str) -> &'static str {
    EMBEDDED_LEARNING_SOURCES
        .iter()
        .copied()
        .find(|source| {
            serde_json::from_str::<Value>(source)
                .ok()
                .is_some_and(|value| {
                    value["certification_id"].as_str() == Some(certification_id)
                        && value["domain"]["id"].as_str() == Some(domain_id)
                })
        })
        .unwrap_or_else(|| panic!("learning source for {certification_id}/{domain_id} is embedded"))
}

fn learning_value(certification_id: &str, domain_id: &str) -> Value {
    serde_json::from_str(learning_source_for(certification_id, domain_id))
        .expect("learning source is valid json")
}

fn domains_for<'a>(
    registry: &'a ContentRegistry,
    certification_id: &str,
) -> Vec<&'a LearningDomain> {
    registry
        .learning_domains()
        .iter()
        .filter(|domain| domain.certification_id == certification_id)
        .collect()
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

#[test]
fn all_five_soa_c03_learning_domains_load() {
    let registry = registry();
    let domains = domains_for(&registry, "aws-soa-c03");
    assert_eq!(domains.len(), 5);

    let ids: Vec<&str> = domains
        .iter()
        .map(|domain| domain.domain.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["domain-1", "domain-2", "domain-3", "domain-4", "domain-5"]
    );
    for domain in domains {
        assert_eq!(domain.certification_version, "soa-c03");
        assert!(!domain.modules.is_empty());
    }
}

#[test]
fn all_five_aip_c01_learning_domains_load() {
    let registry = registry();
    let domains = domains_for(&registry, "aws-aip-c01");
    assert_eq!(domains.len(), 5);

    let ids: Vec<&str> = domains
        .iter()
        .map(|domain| domain.domain.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["domain-1", "domain-2", "domain-3", "domain-4", "domain-5"]
    );
    for domain in domains {
        assert_eq!(domain.certification_version, "aip-c01");
        assert!(!domain.modules.is_empty());
    }
}

#[test]
fn every_domain_resolves_by_version_and_id() {
    let registry = registry();
    for index in 1..=5 {
        let id = format!("domain-{index}");
        let domain = registry
            .learning_domain("soa-c03", &id)
            .unwrap_or_else(|| panic!("{id} resolves"));
        assert_eq!(domain.domain.id, id);
        assert!(
            registry
                .learning_domain_for_certification("aws-soa-c03", &id)
                .is_some()
        );
        assert!(registry.learning_available("aws-soa-c03", &id));
        assert!(registry.learning_modules("soa-c03", &id).is_some());
    }

    assert!(registry.learning_domain("soa-c03", "domain-9").is_none());
    assert!(registry.learning_domain("soa-c02", "domain-1").is_none());
    assert!(!registry.learning_available("aws-saa-c03", "domain-1"));
}

#[test]
fn learning_node_lookup_is_version_scoped() {
    let registry = registry();
    let node = registry
        .learning_node("soa-c03", "domain-1", "d1-cloudtrail")
        .expect("cloudtrail node");
    assert_eq!(node.title, "CloudTrail");
    assert!(node.concept_ids.contains(&"aws.cloudtrail".to_owned()));
    assert!(
        registry
            .learning_node("soa-c02", "domain-1", "d1-cloudtrail")
            .is_none()
    );
    assert!(
        registry
            .learning_node("soa-c03", "domain-1", "ghost-node")
            .is_none()
    );
}

#[test]
fn prerequisites_resolve_and_have_no_cycles() {
    let registry = registry();
    for domain in registry.learning_domains() {
        let module_ids: std::collections::HashSet<&str> = domain
            .modules
            .iter()
            .map(|module| module.id.as_str())
            .collect();
        for module in &domain.modules {
            for prerequisite in &module.prerequisite_module_ids {
                assert!(module_ids.contains(prerequisite.as_str()));
            }
            for node in &module.nodes {
                for prerequisite in &node.prerequisite_node_ids {
                    assert!(
                        domain.node(prerequisite).is_some(),
                        "{} references missing node {prerequisite}",
                        node.id
                    );
                }
            }
        }
    }
}

#[test]
fn concept_ids_reference_quiz_concepts() {
    let registry = registry();
    let mut checked = 0;

    for domain in registry.learning_domains() {
        let bundle = registry
            .bundle_for_version(&domain.certification_version)
            .unwrap_or_else(|| {
                panic!(
                    "quiz bundle for {} is embedded",
                    domain.certification_version
                )
            });
        let concepts: std::collections::HashSet<&str> = bundle
            .concepts
            .iter()
            .map(|concept| concept.id.as_str())
            .collect();

        for node in domain.nodes() {
            for concept_id in &node.concept_ids {
                checked += 1;
                assert!(
                    concepts.contains(concept_id.as_str()),
                    "{} references unknown concept {concept_id}",
                    node.id
                );
            }
        }
    }
    assert!(checked > 100, "expected a broad concept bridge");
}

#[test]
fn every_authored_reveal_type_is_supported() {
    let registry = registry();
    let supported = ["text", "sequence", "comparison", "keywords", "bullets"];

    let mut seen = std::collections::BTreeSet::new();
    for domain in registry.learning_domains() {
        for node in domain.nodes() {
            for prompt in &node.prompts {
                let kind = match &prompt.reveal {
                    LearningReveal::Text { .. } => "text",
                    LearningReveal::Sequence { .. } => "sequence",
                    LearningReveal::Comparison { .. } => "comparison",
                    LearningReveal::Keywords { .. } => "keywords",
                    LearningReveal::Bullets { .. } => "bullets",
                };
                seen.insert(kind);
            }
        }
    }

    for kind in &seen {
        assert!(supported.contains(kind), "no renderer for reveal {kind}");
    }
    assert_eq!(seen.len(), supported.len(), "all reveal types are authored");
}

#[test]
fn every_prompt_kind_maps_to_the_shared_vocabulary() {
    let registry = registry();
    let mut seen = std::collections::HashSet::new();
    let mut prompt_count = 0;
    for domain in registry.learning_domains() {
        for node in domain.nodes() {
            let required = node.prompts.iter().filter(|prompt| prompt.required).count();
            assert!(required > 0, "{} has no required prompts", node.id);

            for prompt in &node.prompts {
                prompt_count += 1;
                seen.insert(prompt.kind);
            }
        }
    }

    assert!(prompt_count > 300);
    let expected: std::collections::HashSet<PromptKind> = [
        PromptKind::What,
        PromptKind::When,
        PromptKind::ConnectsTo,
        PromptKind::NotThis,
        PromptKind::ExamClue,
        PromptKind::MentalModel,
        PromptKind::Action,
        PromptKind::LookFor,
    ]
    .into_iter()
    .collect();
    assert_eq!(seen, expected);
}

#[test]
fn coverage_counts_match_the_authored_curriculum() {
    let registry = registry();

    let totals = |certification_id: &str| {
        let mut modules = 0;
        let mut nodes = 0;
        let mut prompts = 0;
        for domain in domains_for(&registry, certification_id) {
            modules += domain.coverage.module_count;
            nodes += domain.coverage.knowledge_node_count;
            prompts += domain.coverage.prompt_count;
        }
        (modules, nodes, prompts)
    };

    assert_eq!(totals("aws-soa-c03"), (23, 138, 418));
    assert_eq!(totals("aws-aip-c01"), (20, 98, 392));
}

#[test]
fn rejects_unknown_prerequisite() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    value["modules"][0]["nodes"][1]["prerequisite_node_ids"] = Value::from(vec!["ghost-node"]);

    expect_error(&value, "learning_node_prerequisite_unknown");
}

#[test]
fn rejects_self_prerequisite() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let node_id = value["modules"][0]["nodes"][0]["id"].clone();
    value["modules"][0]["nodes"][0]["prerequisite_node_ids"] = Value::from(vec![node_id]);

    expect_error(&value, "learning_node_self_prerequisite");
}

#[test]
fn rejects_dependency_cycle() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let dependent = value["modules"][0]["nodes"][1]["id"].clone();
    value["modules"][0]["nodes"][0]["prerequisite_node_ids"] = Value::from(vec![dependent]);

    expect_error(&value, "learning_node_dependency_cycle");
}

#[test]
fn rejects_duplicate_node_id() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let duplicate = value["modules"][0]["nodes"][0]["id"].clone();
    value["modules"][0]["nodes"][1]["id"] = duplicate;

    expect_error(&value, "learning_duplicate_node_id");
}

#[test]
fn rejects_duplicate_module_id() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let duplicate = value["modules"][0]["id"].clone();
    value["modules"][1]["id"] = duplicate;

    expect_error(&value, "learning_duplicate_module_id");
}

#[test]
fn rejects_invalid_map_position() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    value["modules"][0]["nodes"][0]["map_position"]["x"] = Value::from(1.5);

    expect_error(&value, "learning_map_position_invalid");
}

#[test]
fn rejects_module_without_nodes() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    value["modules"][0]["nodes"] = Value::from(Vec::<Value>::new());

    expect_error(&value, "learning_module_nodes_missing");
}

#[test]
fn rejects_coverage_mismatch() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let current = value["coverage"]["knowledge_node_count"].as_u64().unwrap();
    value["coverage"]["knowledge_node_count"] = Value::from(current + 1);

    expect_error(&value, "learning_coverage_mismatch");
}

#[test]
fn rejects_comparison_with_one_column() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    let columns = value["modules"][0]["nodes"][0]["prompts"][0]["reveal"]["columns"]
        .as_array_mut()
        .expect("comparison columns");
    columns.truncate(1);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn rejects_empty_required_prompt_set() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    for prompt in value["modules"][0]["nodes"][0]["prompts"]
        .as_array_mut()
        .expect("prompts")
    {
        prompt["required"] = Value::from(false);
    }

    expect_error(&value, "learning_required_prompts_missing");
}

#[test]
fn rejects_unknown_concept_against_quiz_bundle() {
    let mut value = learning_value("aws-soa-c03", "domain-1");
    value["modules"][0]["nodes"][0]["concept_ids"] = Value::from(vec!["aws.does_not_exist"]);
    let mutated = serde_json::to_string(&value).expect("serialize mutation");

    let errors = ContentRegistry::from_sources(EMBEDDED_SOURCES, &[mutated.as_str()])
        .expect_err("unknown concept must be rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "learning_unknown_concept"),
        "got {errors:?}"
    );
}

#[test]
fn rejects_malformed_learning_json_distinctly() {
    let errors = ContentRegistry::from_sources(EMBEDDED_SOURCES, &["{\"not\":\"a map\"}"])
        .expect_err("malformed learning json must be rejected");
    assert!(
        errors
            .iter()
            .any(|error| error.code == "invalid_learning_json"),
        "got {errors:?}"
    );
    // The quiz type must not be silently accepted as learning content.
    assert!(
        errors.iter().all(|error| error.code != "invalid_json"),
        "learning source must not be parsed as a quiz bundle"
    );
}
