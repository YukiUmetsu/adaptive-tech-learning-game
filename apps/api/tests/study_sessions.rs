//! Integration tests for adaptive study-session planning.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db as db;
use adaptive_learn_domain::{AssessmentMode, ConceptObservation, ConceptWeight};
use axum::Router;
use axum::http::StatusCode;
use chrono::Utc;
use serde_json::{Value, json};
use uuid::Uuid;

async fn create_session(
    app: &Router,
    subject: &str,
    track_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/tracks/{track_id}/session"),
        Some(body),
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

async fn seed_weak_concept(
    pool: &db::PgPool,
    user_id: Uuid,
    version: &str,
    concept_id: &str,
    mode: AssessmentMode,
) {
    let concept = ConceptWeight {
        concept_id: concept_id.to_owned(),
        weight: 1.0,
    };
    let observation = ConceptObservation {
        user_id,
        certification_version: version,
        concept: &concept,
        assessment_mode: mode,
        score: 0.0,
        attempt_number: 1,
        hint_count: 0,
        occurred_at: Utc::now(),
    };
    let mut tx = pool.begin().await.expect("begin");
    db::concept_state::apply(&mut tx, &observation)
        .await
        .expect("seed concept state");
    tx.commit().await.expect("commit");
}

fn activity_kinds(session: &Value) -> Vec<&str> {
    session["activities"]
        .as_array()
        .expect("activities")
        .iter()
        .map(|activity| activity["kind"].as_str().expect("kind"))
        .collect()
}

#[tokio::test]
async fn study_session_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send_anonymous(
        app,
        "POST",
        "/v1/tracks/aws-soa-c03/session",
        Some(json!({ "available_minutes": 20, "preference": "balanced" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn cold_start_session_is_well_formed() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry: std::sync::Arc<ContentRegistry> = common::content();
    let subject = format!("session-cold-{}", Uuid::new_v4());

    let (status, body) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 20, "preference": "balanced" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["session_id"].as_str().is_some(), "{body}");
    assert_eq!(body["track_id"], "aws-soa-c03");

    let activities = body["activities"].as_array().expect("activities");
    assert!(
        !activities.is_empty(),
        "cold start should plan something: {body}"
    );
    assert!(
        body["estimated_minutes"].as_u64().unwrap_or(0) <= 22,
        "session should stay near the requested time: {body}"
    );

    // Every question id must come from canonical content.
    for activity in activities {
        for question_id in activity["question_ids"].as_array().expect("question_ids") {
            let id = question_id.as_str().expect("question id");
            assert!(
                registry.question("soa-c03", id).is_some(),
                "unknown question in session: {id}"
            );
        }
    }
}

#[tokio::test]
async fn study_session_is_deterministic_but_ids_differ() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("session-deterministic-{}", Uuid::new_v4());
    let request = json!({ "available_minutes": 25, "preference": "balanced" });

    let (_, first) = create_session(&app, &subject, "aws-soa-c03", request.clone()).await;
    let (_, second) = create_session(&app, &subject, "aws-soa-c03", request).await;

    assert_eq!(first["activities"], second["activities"]);
    assert_eq!(first["estimated_minutes"], second["estimated_minutes"]);
    assert_ne!(first["session_id"], second["session_id"]);
}

#[tokio::test]
async fn available_minutes_affects_plan_length() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("session-time-{}", Uuid::new_v4());

    let (_, short) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 10, "preference": "balanced" }),
    )
    .await;
    let (_, long) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 60, "preference": "balanced" }),
    )
    .await;

    let short_count = short["activities"].as_array().expect("activities").len();
    let long_count = long["activities"].as_array().expect("activities").len();
    let short_minutes = short["estimated_minutes"].as_u64().unwrap_or(0);
    let long_minutes = long["estimated_minutes"].as_u64().unwrap_or(0);

    assert!(long_count >= short_count, "{short_count} vs {long_count}");
    assert!(
        long_minutes >= short_minutes,
        "{short_minutes} vs {long_minutes}"
    );
}

#[tokio::test]
async fn preference_changes_session_composition() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("session-preference-{}", Uuid::new_v4());
    let user_id = user_id_for(&pool, &subject).await;
    seed_weak_concept(
        &pool,
        user_id,
        "soa-c03",
        "aws.monitoring_vs_logging",
        AssessmentMode::Recognition,
    )
    .await;

    let (_, more_practice) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 40, "preference": "more_practice" }),
    )
    .await;
    let (_, more_learning) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 40, "preference": "more_learning" }),
    )
    .await;

    let practice_count = |session: &Value| {
        activity_kinds(session)
            .iter()
            .filter(|kind| **kind == "practice")
            .count()
    };
    let learning_count = |session: &Value| {
        activity_kinds(session)
            .iter()
            .filter(|kind| **kind == "learn_node" || **kind == "review_node")
            .count()
    };

    assert!(
        practice_count(&more_practice) >= practice_count(&more_learning),
        "more_practice should not have fewer practice activities"
    );
    assert!(
        learning_count(&more_learning) >= learning_count(&more_practice),
        "more_learning should not have fewer learning activities"
    );
}

#[tokio::test]
async fn non_certification_tracks_plan_sessions() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    for track_id in ["ai-python-fluency", "python-data-stack", "ai-pytorch-core"] {
        let subject = format!("session-track-{track_id}-{}", Uuid::new_v4());
        let (status, body) = create_session(
            &app,
            &subject,
            track_id,
            json!({ "available_minutes": 20, "preference": "balanced" }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{track_id}: {body}");
        assert_eq!(body["track_id"], track_id);
        assert!(
            !body["activities"]
                .as_array()
                .expect("activities")
                .is_empty(),
            "{track_id} should plan activities: {body}"
        );
    }
}

#[tokio::test]
async fn unknown_track_returns_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("session-missing-{}", Uuid::new_v4());

    let (status, body) = create_session(
        &app,
        &subject,
        "does-not-exist",
        json!({ "available_minutes": 20, "preference": "balanced" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn session_practice_anchors_a_guaranteed_mission_question() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("session-execute-{}", Uuid::new_v4());
    let user_id = user_id_for(&pool, &subject).await;
    seed_weak_concept(
        &pool,
        user_id,
        "soa-c03",
        "aws.monitoring_vs_logging",
        AssessmentMode::Recognition,
    )
    .await;

    let (status, session) = create_session(
        &app,
        &subject,
        "aws-soa-c03",
        json!({ "available_minutes": 30, "preference": "more_practice" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{session}");

    let anchor = session["activities"]
        .as_array()
        .expect("activities")
        .iter()
        .find(|activity| activity["kind"] == "practice")
        .and_then(|activity| activity["question_ids"].as_array())
        .and_then(|ids| ids.first())
        .and_then(|id| id.as_str())
        .expect("a practice question");

    let (status, mission) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": Uuid::new_v4(),
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": "recommended_practice",
            "question_id": anchor,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mission}");
    assert_eq!(
        mission["questions"][0]["id"], anchor,
        "the session's first practice question must be practiced"
    );
}
