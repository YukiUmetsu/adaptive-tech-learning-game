//! Integration tests for the optional learning-track recommendation endpoint.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use axum::Router;
use axum::http::StatusCode;
use serde_json::Value;
use uuid::Uuid;

async fn get_recommendation(
    app: &Router,
    subject: &str,
    track_id: &str,
    explored: Option<&str>,
) -> (StatusCode, Value) {
    let uri = match explored {
        Some(ids) => {
            format!("/v1/tracks/{track_id}/recommendation?explored_node_ids={ids}")
        }
        None => format!("/v1/tracks/{track_id}/recommendation"),
    };
    common::send_as(app.clone(), subject, "GET", &uri, None).await
}

#[tokio::test]
async fn recommendation_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) =
        common::send_anonymous(app, "GET", "/v1/tracks/aws-soa-c03/recommendation", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn cold_start_recommendation_is_well_formed_and_deterministic() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("recommendation-cold-{}", Uuid::new_v4());

    let (status, body) = get_recommendation(&app, &subject, "aws-soa-c03", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let recommendation = &body["recommendation"];
    assert!(
        recommendation.is_object(),
        "expected a recommendation: {body}"
    );
    assert_eq!(recommendation["track_id"], "aws-soa-c03");
    assert!(
        recommendation["domain_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty()),
        "a recommendation must name a domain: {body}"
    );
    assert!(
        matches!(
            recommendation["action"].as_str(),
            Some("learn_node" | "practice_question" | "practice_domain" | "review_node")
        ),
        "unexpected action: {body}"
    );
    assert!(
        recommendation["reason"].as_str().is_some(),
        "a recommendation must explain itself: {body}"
    );

    // Identical state must produce an identical recommendation.
    let (_, again) = get_recommendation(&app, &subject, "aws-soa-c03", None).await;
    assert_eq!(body, again, "recommendations must be deterministic");
}

#[tokio::test]
async fn recommendation_works_for_non_certification_tracks() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    // Python Fluency, Python Data Stack, and PyTorch Core are learning tracks,
    // not vendor certifications, and must plan the same way.
    for track_id in ["ai-python-fluency", "python-data-stack", "ai-pytorch-core"] {
        let subject = format!("recommendation-track-{track_id}-{}", Uuid::new_v4());
        let (status, body) = get_recommendation(&app, &subject, track_id, None).await;
        assert_eq!(status, StatusCode::OK, "{track_id}: {body}");
        assert!(
            body["recommendation"].is_object(),
            "{track_id} should produce a recommendation: {body}"
        );
        assert_eq!(body["recommendation"]["track_id"], track_id);
    }
}

#[tokio::test]
async fn unknown_track_returns_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("recommendation-missing-{}", Uuid::new_v4());

    let (status, body) = get_recommendation(&app, &subject, "does-not-exist", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn explored_node_ids_are_accepted_and_do_not_break_the_plan() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("recommendation-explored-{}", Uuid::new_v4());

    let (status, body) = get_recommendation(
        &app,
        &subject,
        "aws-soa-c03",
        Some("node-a,node-b,%20node-c"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recommendation"]["track_id"], "aws-soa-c03");
}

#[tokio::test]
async fn displayed_recommendations_are_logged_best_effort() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("recommendation-logged-{}", Uuid::new_v4());

    let (status, body) = get_recommendation(&app, &subject, "aws-soa-c03", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let user_id = adaptive_learn_db::users::find_by_auth_subject(&pool, "workos", &subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id;
    let logged =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM recommendation_log WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("count recommendation log");
    assert!(logged >= 1, "the displayed recommendation should be logged");
}
