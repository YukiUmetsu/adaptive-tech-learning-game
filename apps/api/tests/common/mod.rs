//! Shared helpers for API integration tests.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use adaptive_learn_api::{AppState, build_router, config::Config};
use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db::PgPool;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

pub fn content() -> Arc<ContentRegistry> {
    Arc::new(ContentRegistry::embedded().expect("embedded content is valid"))
}

pub fn test_config() -> Config {
    Config::from_source([
        ("APP_ENV", "test"),
        ("DATABASE_URL", "postgres://app:app@127.0.0.1:1/app"),
    ])
    .expect("valid test configuration")
}

pub fn unreachable_pool() -> PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(200))
        .connect_lazy("postgres://app:app@127.0.0.1:1/app")
        .expect("build lazy pool")
}

pub fn app_without_database() -> Router {
    build_router(AppState::new(unreachable_pool(), content()), &test_config())
}

pub fn app_with_pool(pool: PgPool) -> Router {
    build_router(AppState::new(pool, content()), &test_config())
}

/// Returns a connected, migrated pool when `DATABASE_URL` is configured.
pub async fn database_pool() -> Option<PgPool> {
    let url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => url,
        _ => {
            assert_ne!(
                std::env::var("REQUIRE_DB_TESTS").as_deref(),
                Ok("1"),
                "DATABASE_URL must be set when REQUIRE_DB_TESTS=1"
            );
            eprintln!("skipping database test: DATABASE_URL is not set");
            return None;
        }
    };

    let pool = adaptive_learn_db::connect(&url, 4)
        .await
        .expect("connect to database");
    adaptive_learn_db::MIGRATOR
        .run(&pool)
        .await
        .expect("apply migrations");
    Some(pool)
}

pub async fn send(
    app: Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).expect("serialize body")),
            None => Body::empty(),
        })
        .expect("build request");

    let response = app.oneshot(request).await.expect("send request");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read body");
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };

    (status, json)
}
