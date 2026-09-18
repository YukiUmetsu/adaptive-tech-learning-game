//! Registry behavior for the embedded SOA-C03 bundle.

use adaptive_learn_content::ContentRegistry;

#[test]
fn embedded_registry_loads_and_validates() {
    let registry = ContentRegistry::embedded().expect("embedded content must be valid");
    assert_eq!(registry.bundles().len(), 1);
}

#[test]
fn catalog_exposes_soa_c03_metadata() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    let certification = registry
        .certifications()
        .next()
        .expect("at least one certification");

    assert_eq!(certification.id, "aws-soa-c03");
    assert_eq!(certification.vendor, "AWS");
    assert_eq!(certification.exam_code, "SOA-C03");
    assert_eq!(
        certification.name,
        "AWS Certified CloudOps Engineer - Associate"
    );
    assert!(
        certification
            .official_source_url
            .contains("docs.aws.amazon.com")
    );
}

#[test]
fn domain_weights_match_the_official_blueprint() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    let bundle = registry
        .bundle_for_certification("aws-soa-c03")
        .expect("bundle");

    let weights: Vec<(String, f64)> = bundle
        .version
        .domains
        .iter()
        .map(|domain| (domain.id.clone(), domain.weight))
        .collect();

    assert_eq!(
        weights,
        vec![
            ("domain-1".to_owned(), 0.22),
            ("domain-2".to_owned(), 0.22),
            ("domain-3".to_owned(), 0.22),
            ("domain-4".to_owned(), 0.16),
            ("domain-5".to_owned(), 0.18),
        ]
    );
}

#[test]
fn only_task_1_1_has_questions() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    let bundle = registry
        .bundle_for_certification("aws-soa-c03")
        .expect("bundle");

    let authored_tasks: Vec<&str> = bundle
        .version
        .domains
        .iter()
        .flat_map(|domain| domain.tasks.iter())
        .map(|task| task.id.as_str())
        .collect();

    assert_eq!(authored_tasks, vec!["1.1"]);
}

#[test]
fn task_1_1_returns_questions_in_authored_order() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    let questions = registry.questions_for_task("soa-c03", "1.1");

    let ids: Vec<&str> = questions
        .iter()
        .map(|question| question.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec![
            "monitoring-classification-001",
            "monitoring-ordering-001",
            "monitoring-connection-001",
            "monitoring-classification-002",
            "monitoring-connection-002",
        ]
    );
}

#[test]
fn question_lookup_is_version_scoped() {
    let registry = ContentRegistry::embedded().expect("valid registry");

    assert!(
        registry
            .question("soa-c03", "monitoring-classification-001")
            .is_some()
    );
    assert!(
        registry
            .question("soa-c02", "monitoring-classification-001")
            .is_none()
    );
    assert!(registry.find_task("soa-c03", "1.2").is_none());
}
