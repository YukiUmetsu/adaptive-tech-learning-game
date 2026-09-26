//! Integration tests for the Phase 5 family-insights endpoint.
//!
//! The anonymous auth-boundary test needs no database. The authenticated
//! behavior requires a real account (the dev identity resolves through the
//! account upsert), so those tests are skipped when `DATABASE_URL` is unset.

mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn anonymous_family_insights_require_authentication() {
    let app = common::app_without_database();
    let (status, _) =
        common::send_anonymous(app, "GET", "/v1/tracks/aws-soa-c03/family-insights", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn track_without_guides_returns_an_empty_insight_list() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    // Resolve the account first, then read the insight list. No current track
    // authors family guides, so this is an empty list, not a failure.
    let (status, _) = common::send_as(app.clone(), "family-user", "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = common::send_as(
        app,
        "family-user",
        "GET",
        "/v1/tracks/aws-soa-c03/family-insights",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["track_id"], "aws-soa-c03");
    assert_eq!(body["track_version"], "soa-c03");
    assert_eq!(body["insights"], serde_json::json!([]));
}

#[tokio::test]
async fn unknown_track_is_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let (status, _) = common::send_as(app.clone(), "family-user", "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::send_as(
        app,
        "family-user",
        "GET",
        "/v1/tracks/not-a-track/family-insights",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
