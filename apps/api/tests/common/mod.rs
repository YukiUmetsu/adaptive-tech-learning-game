//! Shared helpers for API integration tests.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use adaptive_learn_api::auth::{Authenticator, DevVerifier, ProfileDirectory};
use adaptive_learn_api::{AppState, auth, build_router, config::Config};
use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db::PgPool;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

/// Default local/test identity used by [`send`].
pub const DEFAULT_SUBJECT: &str = "test-user";

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

fn state(pool: PgPool) -> AppState {
    let config = test_config();
    let authenticator = auth::build_authenticator(&config);
    AppState::new(pool, content(), authenticator)
}

pub fn app_without_database() -> Router {
    let config = test_config();
    build_router(state(unreachable_pool()), &config)
}

pub fn app_with_pool(pool: PgPool) -> Router {
    let config = test_config();
    build_router(state(pool), &config)
}

/// Builds an app whose dev auth uses a fixed provider profile directory.
pub fn app_with_profile(pool: PgPool, profile: Arc<dyn ProfileDirectory>) -> Router {
    let config = test_config();
    let authenticator = Authenticator {
        verifier: Arc::new(DevVerifier),
        profile: Some(profile),
    };
    build_router(AppState::new(pool, content(), authenticator), &config)
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

/// Sends a request authenticated as the default test identity.
pub async fn send(
    app: Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    send_as(app, DEFAULT_SUBJECT, method, uri, body).await
}

/// Sends a request authenticated as `dev:<subject>`.
pub async fn send_as(
    app: Router,
    subject: &str,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    send_with_token(app, Some(format!("dev:{subject}")), method, uri, body).await
}

/// Sends a request with no `Authorization` header.
pub async fn send_anonymous(
    app: Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    send_with_token(app, None, method, uri, body).await
}

/// Sends a request with a raw `Authorization: Bearer` value.
pub async fn send_with_token(
    app: Router,
    token: Option<String>,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let request = builder
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
