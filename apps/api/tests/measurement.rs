//! Integration tests for prediction measurement, delayed retrieval, and the
//! local-day Daily Mission boundary.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_content::{CanonicalAnswer, ContentRegistry, Interaction, Question};
use adaptive_learn_db as db;
use axum::Router;
use axum::http::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

fn registry() -> std::sync::Arc<ContentRegistry> {
    common::content()
}

fn question(registry: &ContentRegistry, id: &str) -> Question {
    registry
        .question("soa-c03", id)
        .expect("question exists")
        .clone()
}

fn correct_answer(question: &Question) -> Value {
    match &question.canonical_answer {
        CanonicalAnswer::Classification { placements } => json!({ "placements": placements }),
        CanonicalAnswer::Ordering { ordered_ids } => json!({ "ordered_ids": ordered_ids }),
        CanonicalAnswer::NodeConnection { edges } => json!({ "edges": edges }),
        CanonicalAnswer::Reconstruction { placements, edges } => json!({
            "reconstruction": { "placements": placements, "edges": edges }
        }),
        CanonicalAnswer::EvidenceSelection { relevant_ids } => {
            json!({ "evidence_ids": relevant_ids })
        }
        CanonicalAnswer::SpotTheFault { faulty_ids } => json!({ "faulty_ids": faulty_ids }),
        CanonicalAnswer::FillSlots { values } => json!({ "slot_values": values }),
        CanonicalAnswer::Troubleshooting { expected_path, .. } => {
            json!({ "choice_path": expected_path })
        }
        CanonicalAnswer::ScenarioChoiceChain { expected_path, .. } => {
            json!({ "choice_path": expected_path })
        }
        CanonicalAnswer::ConfigurationBuilder { assignments } => {
            json!({ "assignments": assignments })
        }
        CanonicalAnswer::TwoDimensionalPlacement { regions } => {
            let positions: serde_json::Map<String, Value> = regions
                .iter()
                .map(|(item_id, region)| {
                    let x = (region.x[0] + region.x[1]) / 2.0;
                    let y = (region.y[0] + region.y[1]) / 2.0;
                    (item_id.clone(), json!({ "x": x, "y": y }))
                })
                .collect();
            json!({ "positions": positions })
        }
        CanonicalAnswer::CommandAssembly { values } => json!({ "token_values": values }),
        CanonicalAnswer::TypedFillBlank { answers } => {
            let typed: serde_json::Map<String, Value> = answers
                .iter()
                .map(|(slot_id, answer)| {
                    (
                        slot_id.clone(),
                        json!(answer.accepted_answers.first().cloned().unwrap_or_default()),
                    )
                })
                .collect();
            json!({ "typed_answers": typed })
        }
    }
}

/// A valid but partially wrong classification answer (one item misplaced).
fn wrong_answer(question: &Question) -> Value {
    let CanonicalAnswer::Classification { placements } = &question.canonical_answer else {
        return correct_answer(question);
    };
    let Interaction::Classification { categories, .. } = &question.interaction else {
        return correct_answer(question);
    };
    let Some((item, correct)) = placements.iter().next() else {
        return correct_answer(question);
    };
    let Some(other) = categories.iter().find(|category| &category.id != correct) else {
        return correct_answer(question);
    };
    let mut wrong = placements.clone();
    wrong.insert(item.clone(), other.id.clone());
    json!({ "placements": wrong })
}

async fn issue_task(app: &Router, subject: &str, device: Uuid) -> Value {
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": "task_practice",
            "task_id": "1.1"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "issue failed: {body}");
    body
}

async fn user_id_for(pool: &db::PgPool, subject: &str) -> Uuid {
    db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

async fn count(pool: &db::PgPool, query: &'static str, mission_id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>(query)
        .bind(mission_id)
        .fetch_one(pool)
        .await
        .expect("count")
}

async fn sync_event(
    app: &Router,
    subject: &str,
    device: Uuid,
    mission_id: Uuid,
    content_version: &str,
    question: &Question,
    answer: Value,
) -> Value {
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [{
                "event_id": Uuid::new_v4(),
                "mission_instance_id": mission_id,
                "question_id": question.id,
                "content_version": content_version,
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 1500,
                "occurred_at": "2026-09-19T10:00:00Z",
                "answer": answer,
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    body
}

#[tokio::test]
async fn prediction_snapshot_is_captured_at_issuance() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("prediction-capture-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let question_count = mission["questions"].as_array().expect("questions").len() as i64;

    let predictions = count(
        &pool,
        "SELECT count(*) FROM prediction_snapshots WHERE mission_instance_id = $1",
        mission_id,
    )
    .await;
    assert_eq!(predictions, question_count);

    let (model_version, source, predicted, difficulty): (String, String, f64, f64) =
        sqlx::query_as(
            "SELECT model_version, practice_source, predicted_score, difficulty_prior
             FROM prediction_snapshots WHERE mission_instance_id = $1 LIMIT 1",
        )
        .bind(mission_id)
        .fetch_one(&pool)
        .await
        .expect("prediction row");
    assert_eq!(model_version, "heuristic-v1");
    assert_eq!(source, "task_practice");
    assert!((0.0..=1.0).contains(&predicted));
    assert!((0.0..=1.0).contains(&difficulty));
}

#[tokio::test]
async fn prediction_is_immutable_and_links_one_outcome() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("prediction-immutable-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let before: (f64, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT predicted_score, predicted_at FROM prediction_snapshots
         WHERE mission_instance_id = $1 AND question_id = $2",
    )
    .bind(mission_id)
    .bind(&question.id)
    .fetch_one(&pool)
    .await
    .expect("prediction");

    sync_event(
        &app,
        &subject,
        device,
        mission_id,
        mission["content_version"]
            .as_str()
            .expect("content version"),
        &question,
        correct_answer(&question),
    )
    .await;

    let after: (f64, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT predicted_score, predicted_at FROM prediction_snapshots
         WHERE mission_instance_id = $1 AND question_id = $2",
    )
    .bind(mission_id)
    .bind(&question.id)
    .fetch_one(&pool)
    .await
    .expect("prediction");
    assert_eq!(before, after, "the prediction snapshot must never change");

    let outcomes = count(
        &pool,
        "SELECT count(*) FROM prediction_outcomes o
         JOIN prediction_snapshots p ON p.id = o.prediction_id
         WHERE p.mission_instance_id = $1",
        mission_id,
    )
    .await;
    assert_eq!(outcomes, 1);

    let observed: f64 = sqlx::query_scalar(
        "SELECT o.observed_score FROM prediction_outcomes o
         JOIN prediction_snapshots p ON p.id = o.prediction_id
         WHERE p.mission_instance_id = $1",
    )
    .bind(mission_id)
    .fetch_one(&pool)
    .await
    .expect("observed");
    assert_eq!(observed, 1.0);
}

#[tokio::test]
async fn abandoned_questions_have_no_outcome() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("prediction-abandoned-{}", Uuid::new_v4());
    let mission = issue_task(&app, &subject, Uuid::new_v4()).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");

    let outcomes = count(
        &pool,
        "SELECT count(*) FROM prediction_outcomes o
         JOIN prediction_snapshots p ON p.id = o.prediction_id
         WHERE p.mission_instance_id = $1",
        mission_id,
    )
    .await;
    assert_eq!(outcomes, 0);
}

#[tokio::test]
async fn repeated_attempts_are_distinguishable() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("prediction-retries-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    // Attempt 1 wrong, attempt 2 correct: two linked outcomes.
    sync_event(
        &app,
        &subject,
        device,
        mission_id,
        mission["content_version"]
            .as_str()
            .expect("content version"),
        &question,
        wrong_answer(&question),
    )
    .await;
    sync_event(
        &app,
        &subject,
        device,
        mission_id,
        mission["content_version"]
            .as_str()
            .expect("content version"),
        &question,
        correct_answer(&question),
    )
    .await;

    let attempts: Vec<i32> = sqlx::query_scalar(
        "SELECT o.attempt_number FROM prediction_outcomes o
         JOIN prediction_snapshots p ON p.id = o.prediction_id
         WHERE p.mission_instance_id = $1 ORDER BY o.attempt_number",
    )
    .bind(mission_id)
    .fetch_all(&pool)
    .await
    .expect("attempts");
    assert_eq!(attempts, vec![1, 2]);
}

#[tokio::test]
async fn internal_model_evaluation_reports_calibration() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("prediction-eval-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let question = question(&registry, "monitoring-classification-001");
    sync_event(
        &app,
        &subject,
        device,
        mission_id,
        mission["content_version"]
            .as_str()
            .expect("content version"),
        &question,
        correct_answer(&question),
    )
    .await;

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "GET",
        "/internal/model-evaluation?model_version=heuristic-v1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["model_version"], "heuristic-v1");
    assert!(body["samples"].as_u64().unwrap_or(0) >= 1);
    assert!(body["brier_score"].as_f64().is_some());
    assert!(body["calibration"].as_array().is_some());
    assert!(
        body["slices"]
            .as_array()
            .expect("slices")
            .iter()
            .any(|slice| slice["dimension"] == "assessment_mode")
    );

    // An unknown model version yields an empty summary, not an error.
    let (status, body) = common::send_as(
        app,
        &subject,
        "GET",
        "/internal/model-evaluation?model_version=does-not-exist",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["samples"], 0);
    assert!(body["brier_score"].is_null());
}

async fn request_daily(app: &Router, subject: &str, timezone: &str) -> Value {
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/tracks/aws-soa-c03/daily-mission",
        Some(json!({ "timezone": timezone, "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn daily_mission_uses_persisted_local_day_and_is_stable() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("daily-timezone-{}", Uuid::new_v4());

    let first = request_daily(&app, &subject, "America/Los_Angeles").await;
    let second = request_daily(&app, &subject, "America/Los_Angeles").await;
    assert_eq!(first["id"], second["id"]);
    assert_eq!(first["day_key"], second["day_key"]);

    let user_id = user_id_for(&pool, &subject).await;
    let timezone = db::users::timezone(&pool, user_id).await.expect("timezone");
    assert_eq!(timezone.as_deref(), Some("America/Los_Angeles"));

    // The stored day key matches the learner's local date, not the UTC date.
    let local_day: chrono::NaiveDate =
        sqlx::query_scalar("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date")
            .fetch_one(&pool)
            .await
            .expect("local day");
    assert_eq!(first["day_key"], local_day.format("%Y-%m-%d").to_string());
}

#[tokio::test]
async fn timezone_change_cannot_create_a_second_daily_mission() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("daily-timezone-abuse-{}", Uuid::new_v4());

    let first = request_daily(&app, &subject, "America/Los_Angeles").await;
    // A very different timezone (UTC+14) cannot mint a second mission.
    let second = request_daily(&app, &subject, "Pacific/Kiritimati").await;
    assert_eq!(first["id"], second["id"]);
    assert_eq!(first["day_key"], second["day_key"]);

    let user_id = user_id_for(&pool, &subject).await;
    let timezone = db::users::timezone(&pool, user_id).await.expect("timezone");
    assert_eq!(
        timezone.as_deref(),
        Some("America/Los_Angeles"),
        "the first captured timezone is kept"
    );
}
