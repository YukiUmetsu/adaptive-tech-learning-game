//! Integration tests for recommendation execution and lifecycle telemetry.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db as db;
use axum::Router;
use axum::http::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

async fn request_recommendation(
    app: &Router,
    subject: &str,
    track_id: &str,
    discovery: Value,
) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/tracks/{track_id}/recommendation"),
        Some(json!({ "discovery": discovery })),
    )
    .await
}

async fn user_id_for(pool: &db::PgPool, subject: &str) -> Uuid {
    db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

async fn count_events(pool: &db::PgPool, user_id: Uuid, event: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM recommendation_events WHERE user_id = $1 AND event = $2",
    )
    .bind(user_id)
    .bind(event)
    .fetch_one(pool)
    .await
    .expect("count events")
}

async fn issue(
    app: &Router,
    subject: &str,
    track_id: &str,
    version: &str,
    mode: &str,
    question_id: Option<&str>,
    recommendation_id: Option<Uuid>,
) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": Uuid::new_v4(),
            "certification_id": track_id,
            "certification_version": version,
            "mode": mode,
            "question_id": question_id,
            "recommendation_id": recommendation_id,
        })),
    )
    .await
}

#[tokio::test]
async fn recommendation_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send_anonymous(
        app,
        "POST",
        "/v1/tracks/aws-soa-c03/recommendation",
        Some(json!({ "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn cold_start_recommendation_is_well_formed_and_deterministic() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("recommendation-cold-{}", Uuid::new_v4());

    let (status, body) = request_recommendation(&app, &subject, "aws-soa-c03", json!([])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["recommendation_id"].as_str().is_some(),
        "a recommendation must carry a lifecycle id: {body}"
    );
    let recommendation = &body["recommendation"];
    assert!(
        recommendation.is_object(),
        "expected a recommendation: {body}"
    );
    assert_eq!(recommendation["track_id"], "aws-soa-c03");

    // The deterministic plan is identical across requests (ids differ).
    let (_, again) = request_recommendation(&app, &subject, "aws-soa-c03", json!([])).await;
    assert_eq!(body["recommendation"], again["recommendation"]);
}

#[tokio::test]
async fn recommendation_works_for_non_certification_tracks() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    for track_id in ["ai-python-fluency", "python-data-stack", "ai-pytorch-core"] {
        let subject = format!("recommendation-track-{track_id}-{}", Uuid::new_v4());
        let (status, body) = request_recommendation(&app, &subject, track_id, json!([])).await;
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

    let (status, body) = request_recommendation(&app, &subject, "does-not-exist", json!([])).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn discovery_progress_is_accepted_and_shapes_the_plan() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("recommendation-discovery-{}", Uuid::new_v4());
    let registry: std::sync::Arc<ContentRegistry> = common::content();

    // Fully unlock the first module of the first learning domain.
    let domain = registry
        .learning_domains()
        .iter()
        .find(|domain| domain.certification_version == "soa-c03")
        .expect("learning domain");
    let module = &domain.modules[0];
    let mut revealed_prompt_ids = serde_json::Map::new();
    for node in &module.nodes {
        let prompts: Vec<String> = node
            .prompts
            .iter()
            .filter(|prompt| prompt.required)
            .map(|prompt| prompt.id.clone())
            .collect();
        if !prompts.is_empty() {
            revealed_prompt_ids.insert(node.id.clone(), json!(prompts));
        }
    }
    let discovery = json!([{
        "domain_id": domain.domain.id,
        "revealed_prompt_ids": revealed_prompt_ids,
        "revealed_element_ids": {},
    }]);

    let (status, body) = request_recommendation(&app, &subject, "aws-soa-c03", discovery).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["recommendation"].is_object(), "{body}");

    // Generation was logged, but the request itself is not a "shown" event.
    let user_id = user_id_for(&pool, &subject).await;
    assert_eq!(count_events(&pool, user_id, "shown").await, 0);
    let generated =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM recommendation_log WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("count generated");
    assert_eq!(generated, 1);
}

#[tokio::test]
async fn lifecycle_events_can_be_recorded_best_effort() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("recommendation-lifecycle-{}", Uuid::new_v4());

    let (status, body) = request_recommendation(&app, &subject, "aws-soa-c03", json!([])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let recommendation_id = body["recommendation_id"].as_str().expect("id");

    for event in ["shown", "clicked"] {
        let (status, response) = common::send_as(
            app.clone(),
            &subject,
            "POST",
            &format!("/v1/tracks/aws-soa-c03/recommendations/{recommendation_id}/events"),
            Some(json!({ "event": event, "action": "learn_node" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{event}: {response}");
        assert_eq!(response["recorded"], true, "{event}: {response}");
    }

    let user_id = user_id_for(&pool, &subject).await;
    assert_eq!(count_events(&pool, user_id, "shown").await, 1);
    assert_eq!(count_events(&pool, user_id, "clicked").await, 1);
}

#[tokio::test]
async fn recommended_practice_includes_the_anchor_first() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry: std::sync::Arc<ContentRegistry> = common::content();
    let subject = format!("recommended-practice-{}", Uuid::new_v4());
    let anchor = "monitoring-classification-001";
    assert!(registry.question("soa-c03", anchor).is_some());

    let recommendation_id = Uuid::new_v4();
    let (status, mission) = issue(
        &app,
        &subject,
        "aws-soa-c03",
        "soa-c03",
        "recommended_practice",
        Some(anchor),
        Some(recommendation_id),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mission}");

    let questions = mission["questions"].as_array().expect("questions");
    assert!(!questions.is_empty(), "practice must contain questions");
    assert_eq!(
        questions[0]["id"], anchor,
        "the recommended question must be practiced first"
    );
    assert!(
        questions.len() <= 5,
        "recommended practice stays focused: {}",
        questions.len()
    );

    // The related set is selected deterministically by the server.
    let (_, again) = issue(
        &app,
        &subject,
        "aws-soa-c03",
        "soa-c03",
        "recommended_practice",
        Some(anchor),
        None,
    )
    .await;
    let ids: Vec<&str> = questions
        .iter()
        .map(|question| question["id"].as_str().expect("id"))
        .collect();
    let again_ids: Vec<&str> = again["questions"]
        .as_array()
        .expect("questions")
        .iter()
        .map(|question| question["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids, again_ids, "related questions must be deterministic");

    // The mission links back to the recommendation.
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let stored = db::missions::find_by_id(&pool, mission_id)
        .await
        .expect("find mission")
        .expect("mission");
    assert_eq!(stored.recommendation_id, Some(recommendation_id));
}

#[tokio::test]
async fn recommended_practice_validates_the_anchor() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("recommended-practice-invalid-{}", Uuid::new_v4());

    let (status, body) = issue(
        &app,
        &subject,
        "aws-soa-c03",
        "soa-c03",
        "recommended_practice",
        Some("not-a-real-question"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let (status, body) = issue(
        &app,
        &subject,
        "aws-soa-c03",
        "soa-c03",
        "recommended_practice",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn recommended_practice_start_and_completion_are_telemetred() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("recommended-telemetry-{}", Uuid::new_v4());
    let recommendation_id = Uuid::new_v4();

    let (status, mission) = issue(
        &app,
        &subject,
        "aws-soa-c03",
        "soa-c03",
        "recommended_practice",
        Some("monitoring-classification-001"),
        Some(recommendation_id),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mission}");
    let mission_id = mission["id"].as_str().expect("id");

    let user_id = user_id_for(&pool, &subject).await;
    assert_eq!(count_events(&pool, user_id, "started").await, 1);

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/missions/{mission_id}/complete"),
        Some(json!({ "device_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(count_events(&pool, user_id, "completed").await, 1);
}

#[tokio::test]
async fn practice_domain_still_starts_domain_practice() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("practice-domain-{}", Uuid::new_v4());

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": Uuid::new_v4(),
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": "domain_quiz",
            "domain_id": "domain-1",
            "recommendation_id": Uuid::new_v4(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["mode"], "domain_quiz");
    assert_eq!(body["domain_id"], "domain-1");
    assert_eq!(body["questions"].as_array().expect("questions").len(), 20);
}
