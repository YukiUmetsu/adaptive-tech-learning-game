//! Authentication and account ownership tests.
//!
//! The HTTP-level tests that do not need a database use a missing or malformed
//! token, so they never reach the account upsert. The identity-resolution tests
//! are skipped when `DATABASE_URL` is unset, like the rest of the suite.

mod common;

use std::sync::Arc;

use adaptive_learn_api::auth::ProfileDirectory;
use adaptive_learn_db as db;
use axum::http::StatusCode;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn protected_routes_reject_missing_authorization() {
    let app = common::app_without_database();

    let (status, body) = common::send_anonymous(app.clone(), "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert_eq!(body["error"]["code"], "unauthorized");

    let (status, body) = common::send_anonymous(app, "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn protected_routes_reject_malformed_tokens() {
    let app = common::app_without_database();

    for token in ["not-a-jwt", "dev:", "Bearer", "basic abc"] {
        let (status, body) =
            common::send_with_token(app.clone(), Some(token.to_owned()), "GET", "/v1/me", None)
                .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "token {token:?}: {body}");
    }
}

#[tokio::test]
async fn public_routes_do_not_require_authentication() {
    let app = common::app_without_database();

    let (status, _) = common::send_anonymous(app.clone(), "GET", "/health", None).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let (status, body) =
        common::send_anonymous(app.clone(), "GET", "/v1/certifications", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Learning content is account-only.
    let (status, body) = common::send_anonymous(
        app,
        "GET",
        "/v1/certifications/aws-soa-c03/domains/domain-1/learning",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn me_returns_the_authenticated_account() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send_as(app, "me-endpoint-user", "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["authenticated"], true);
    assert!(body["id"].as_str().is_some());
    assert!(
        body.get("auth_subject").is_none(),
        "provider subject must not be exposed in ordinary payloads"
    );
}

struct StaticDirectory {
    email: Option<String>,
}

impl ProfileDirectory for StaticDirectory {
    fn email_for<'a>(
        &'a self,
        _subject: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async move { self.email.clone() })
    }
}

#[tokio::test]
async fn provider_profile_email_is_stored_on_first_login() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("profile-email-{}", Uuid::new_v4());
    let app = common::app_with_profile(
        pool.clone(),
        Arc::new(StaticDirectory {
            email: Some("provider@example.com".to_owned()),
        }),
    );

    let (status, body) = common::send_as(app, &subject, "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], "provider@example.com");

    let user = db::users::find_by_auth_subject(&pool, "workos", &subject)
        .await
        .expect("lookup")
        .expect("user");
    assert_eq!(user.email.as_deref(), Some("provider@example.com"));
}

#[tokio::test]
async fn first_login_creates_a_user_and_repeat_login_reuses_it() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("stable-subject-{}", Uuid::new_v4());

    let first = db::users::upsert_by_auth_subject(&pool, "workos", &subject, Some("a@example.com"))
        .await
        .expect("first login");
    let second =
        db::users::upsert_by_auth_subject(&pool, "workos", &subject, Some("a@example.com"))
            .await
            .expect("second login");

    assert_eq!(first.id, second.id, "repeat login must resolve one account");

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE auth_subject = $1")
        .bind(&subject)
        .fetch_one(&pool)
        .await
        .expect("count users");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn changed_email_updates_the_same_account() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("email-change-{}", Uuid::new_v4());

    let first =
        db::users::upsert_by_auth_subject(&pool, "workos", &subject, Some("old@example.com"))
            .await
            .expect("first login");
    let second =
        db::users::upsert_by_auth_subject(&pool, "workos", &subject, Some("new@example.com"))
            .await
            .expect("email change");

    assert_eq!(first.id, second.id);
    assert_eq!(second.email.as_deref(), Some("new@example.com"));

    // A provider that reports no email must not clear a known address.
    let third = db::users::upsert_by_auth_subject(&pool, "workos", &subject, None)
        .await
        .expect("missing email");
    assert_eq!(third.id, first.id);
    assert_eq!(third.email.as_deref(), Some("new@example.com"));
}

#[tokio::test]
async fn concurrent_first_logins_resolve_one_account() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("concurrent-{}", Uuid::new_v4());

    let first = db::users::upsert_by_auth_subject(&pool, "workos", &subject, None);
    let second = db::users::upsert_by_auth_subject(&pool, "workos", &subject, None);
    let (first, second) = tokio::join!(first, second);

    assert_eq!(
        first.expect("first upsert").id,
        second.expect("second upsert").id
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE auth_subject = $1")
        .bind(&subject)
        .fetch_one(&pool)
        .await
        .expect("count users");
    assert_eq!(count, 1, "concurrent first logins must not duplicate");
}

#[tokio::test]
async fn protected_json_route_requires_auth_before_validation() {
    // Anonymous callers to a non-demo certification are rejected, not served.
    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": Uuid::new_v4(),
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": "task_practice",
            "task_id": "1.1"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}
