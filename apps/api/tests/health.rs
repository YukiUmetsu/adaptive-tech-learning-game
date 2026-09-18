//! HTTP contract tests.
//!
//! The tests point the pool at a closed port so dependency-failure behavior is
//! deterministic and no running database is required.

use std::time::Duration;

use adaptive_learn_api::{AppState, build_router, config::Config};
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

fn test_config() -> Config {
    Config::from_source([
        ("APP_ENV", "test"),
        ("DATABASE_URL", "postgres://app:app@127.0.0.1:1/app"),
    ])
    .expect("valid test configuration")
}

fn unreachable_pool() -> adaptive_learn_db::PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(200))
        .connect_lazy("postgres://app:app@127.0.0.1:1/app")
        .expect("build lazy pool")
}

async fn get(uri: &str) -> (StatusCode, serde_json::Value) {
    let app = build_router(AppState::new(unreachable_pool()), &test_config());
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("build request");

    let response = app.oneshot(request).await.expect("send request");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read body");
    let json = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("valid json body")
    };

    (status, json)
}

#[tokio::test]
async fn health_reports_degraded_when_database_is_unreachable() {
    let (status, body) = get("/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["database"], "unavailable");
    assert!(body["uptime_seconds"].is_u64());
    assert!(body["timestamp"].is_string());
}

#[tokio::test]
async fn openapi_document_lists_the_health_endpoint() {
    let (status, body) = get("/openapi.json").await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["paths"]["/health"]["get"].is_object());
    assert_eq!(body["info"]["title"], "Adaptive Learning API");
    assert!(body["info"]["version"].is_string());
}

#[tokio::test]
async fn unknown_routes_return_404() {
    let (status, _) = get("/does-not-exist").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
