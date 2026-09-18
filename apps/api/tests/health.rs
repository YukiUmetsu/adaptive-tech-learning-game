//! HTTP contract tests that do not require a database.

mod common;

use axum::http::StatusCode;
use serde_json::json;

#[tokio::test]
async fn health_reports_degraded_when_database_is_unreachable() {
    let (status, body) = common::send(common::app_without_database(), "GET", "/health", None).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["database"], "unavailable");
}

#[tokio::test]
async fn openapi_document_lists_the_learning_endpoints() {
    let (status, body) =
        common::send(common::app_without_database(), "GET", "/openapi.json", None).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["paths"]["/health"]["get"].is_object());
    assert!(body["paths"]["/v1/certifications"]["get"].is_object());
    assert!(body["paths"]["/v1/missions/issue"]["post"].is_object());
    assert!(body["paths"]["/v1/sync"]["post"].is_object());
}

#[tokio::test]
async fn unknown_routes_return_404() {
    let (status, _) = common::send(common::app_without_database(), "GET", "/nope", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn malformed_json_returns_a_structured_error() {
    let app = common::app_without_database();
    let request = axum::http::Request::builder()
        .method("POST")
        .uri("/v1/missions/issue")
        .header("content-type", "application/json")
        .body(axum::body::Body::from("{not json"))
        .expect("build request");

    let response = tower::ServiceExt::oneshot(app, request)
        .await
        .expect("send request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read body");
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(body["error"]["code"], "bad_request");
}

#[tokio::test]
async fn issue_mission_rejects_unknown_task() {
    let (status, body) = common::send(
        common::app_without_database(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": uuid::Uuid::new_v4(),
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "task_id": "9.9"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}
