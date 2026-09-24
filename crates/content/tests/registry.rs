//! Registry behavior for the embedded SOA-C03 bundle.

use adaptive_learn_content::{ContentRegistry, EMBEDDED_PRACTICE_TEST_SOURCES, EMBEDDED_SOURCES};

#[test]
fn embedded_registry_loads_and_validates() {
    let registry = ContentRegistry::embedded().expect("embedded content must be valid");
    assert!(!registry.bundles().is_empty());
}

#[test]
fn embedded_lenient_loads_without_errors() {
    let (registry, errors) = ContentRegistry::embedded_lenient();
    assert!(
        errors.is_empty(),
        "embedded content must be valid: {errors:?}"
    );
    assert!(!registry.bundles().is_empty());
}

#[test]
fn practice_tests_are_their_own_content_type() {
    assert!(
        EMBEDDED_PRACTICE_TEST_SOURCES
            .iter()
            .any(|source| source.path.contains("practice-tests/")),
        "practice tests are embedded as their own content type"
    );
    assert!(
        EMBEDDED_SOURCES
            .iter()
            .all(|source| !source.path.contains("practice-tests/")),
        "practice tests must never be parsed as scored quiz bundles"
    );
}

#[test]
fn catalog_exposes_soa_c03_metadata() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    // Look the bundle up by id: embedded order follows file discovery order,
    // which is not a stable contract for any particular certification.
    let certification = registry
        .bundle_for_certification("aws-soa-c03")
        .expect("SOA-C03 bundle is embedded")
        .certification
        .clone();

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
fn authored_tasks_span_all_domains() {
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

    assert_eq!(
        authored_tasks,
        vec![
            "1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2",
            "5.3",
        ]
    );
}

#[test]
fn task_1_1_returns_questions_in_authored_order() {
    let registry = ContentRegistry::embedded().expect("valid registry");
    let questions = registry.questions_for_task("soa-c03", "1.1");

    let ids: Vec<&str> = questions
        .iter()
        .map(|question| question.id.as_str())
        .collect();
    assert_eq!(ids.len(), 32);
    assert_eq!(
        &ids[..5],
        &[
            "monitoring-classification-001",
            "monitoring-classification-003",
            "monitoring-connection-001",
            "monitoring-classification-004",
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
    assert!(registry.find_task("soa-c03", "9.9").is_none());
}
