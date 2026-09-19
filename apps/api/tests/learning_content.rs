//! Tests for the pre-quiz learning endpoint.
//!
//! Learning content requires an authenticated account, so the content
//! assertions run against a database-backed app. The authentication check runs
//! without a database.

mod common;

use axum::http::StatusCode;
use serde_json::Value;

#[tokio::test]
async fn learning_requires_authentication() {
    let app = common::app_without_database();

    let (status, body) = common::send_anonymous(
        app,
        "GET",
        "/v1/certifications/aws-soa-c03/domains/domain-1/learning",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn learning_endpoint_returns_the_domain_knowledge_map() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send(
        app,
        "GET",
        "/v1/certifications/aws-soa-c03/domains/domain-1/learning",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "learning failed: {body}");
    assert_eq!(body["certification_id"], "aws-soa-c03");
    assert_eq!(body["certification_version"], "soa-c03");
    assert_eq!(body["domain"]["id"], "domain-1");
    assert_eq!(
        body["learning_design"]["progress_label"],
        "Discovery Progress"
    );

    let modules = body["modules"].as_array().expect("modules");
    assert_eq!(modules.len(), 4);

    let nodes = modules[0]["nodes"].as_array().expect("nodes");
    assert!(!nodes.is_empty());
    let prompts = nodes[0]["prompts"].as_array().expect("prompts");
    assert!(!prompts.is_empty());
    assert!(
        prompts[0]["reveal"].is_object(),
        "reveals are part of the discovery mechanic"
    );

    // The map must describe prerequisites and authored positions.
    assert!(nodes[0]["prerequisite_node_ids"].is_array());
    assert!(nodes[0]["map_position"]["x"].is_number());
}

#[tokio::test]
async fn learning_endpoint_never_exposes_quiz_answers_or_authoring_notes() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send(
        app,
        "GET",
        "/v1/certifications/aws-soa-c03/domains/domain-2/learning",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "learning failed: {body}");

    let serialized = body.to_string();
    assert!(
        !serialized.contains("canonical_answer"),
        "learning content must not carry quiz canonical answers"
    );
    assert!(
        !serialized.contains("authoring_notes"),
        "authoring notes are not learner-facing"
    );
    assert!(body.get("coverage").is_none());
}

#[tokio::test]
async fn every_soa_c03_domain_has_learning_content() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    for index in 1..=5 {
        let domain_id = format!("domain-{index}");
        let (status, body) = common::send(
            app.clone(),
            "GET",
            &format!("/v1/certifications/aws-soa-c03/domains/{domain_id}/learning"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{domain_id} failed: {body}");
        assert_eq!(body["domain"]["id"], domain_id);
        assert!(
            !body["modules"].as_array().expect("modules").is_empty(),
            "{domain_id} has modules"
        );
    }
}

#[tokio::test]
async fn unknown_domain_learning_returns_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send(
        app,
        "GET",
        "/v1/certifications/aws-soa-c03/domains/domain-99/learning",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}

#[tokio::test]
async fn catalog_marks_domains_with_learning_available() {
    // The catalog itself stays public.
    let app = common::app_without_database();

    let (status, body) = common::send(app, "GET", "/v1/certifications", None).await;
    assert_eq!(status, StatusCode::OK, "catalog failed: {body}");

    // Look the certification up by id; embedded catalog order follows content
    // file discovery order and is not a stable contract.
    let certification = body["certifications"]
        .as_array()
        .expect("certifications")
        .iter()
        .find(|entry| entry["id"] == "aws-soa-c03")
        .expect("SOA-C03 is in the catalog");

    let domains = certification["versions"][0]["domains"]
        .as_array()
        .expect("domains");
    assert_eq!(domains.len(), 5);
    for domain in domains {
        assert_eq!(
            domain["learning_available"],
            Value::Bool(true),
            "domain {} should offer learning",
            domain["id"]
        );
    }
}
