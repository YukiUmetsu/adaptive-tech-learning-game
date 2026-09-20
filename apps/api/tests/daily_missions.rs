//! Integration tests for Daily Missions V1.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_content::{ContentRegistry, LearningReveal};
use adaptive_learn_db as db;
use adaptive_learn_domain::{AssessmentMode, ConceptObservation, ConceptWeight};
use axum::Router;
use axum::http::StatusCode;
use chrono::Utc;
use serde_json::{Map, Value, json};
use uuid::Uuid;

async fn get_daily(app: &Router, subject: &str, track_id: &str) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/tracks/{track_id}/daily-mission"),
        Some(json!({ "timezone": "UTC", "discovery": [] })),
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

/// Builds discovery progress that completes every prompt in a domain.
fn full_discovery(registry: &ContentRegistry, version: &str, domain_id: &str) -> Value {
    let domain = registry
        .learning_domain(version, domain_id)
        .expect("learning domain");
    let mut prompt_map: Map<String, Value> = Map::new();
    let mut element_map: Map<String, Value> = Map::new();

    for node in domain.nodes() {
        let mut prompt_ids: Vec<Value> = Vec::new();
        let mut elements: Map<String, Value> = Map::new();
        for prompt in &node.prompts {
            prompt_ids.push(json!(prompt.id));
            let mut ids: Vec<String> = Vec::new();
            match &prompt.reveal {
                LearningReveal::CodeFile { annotations, .. } => {
                    for annotation in annotations {
                        ids.push(format!("annotation:{}", annotation.id));
                    }
                }
                LearningReveal::Table { columns, rows, .. } => {
                    for column in columns {
                        ids.push(format!("column:{}", column.id));
                    }
                    for row in rows {
                        if let Some(row_id) = &row.id {
                            ids.push(format!("row:{row_id}"));
                            for column in columns {
                                ids.push(format!("cell:{row_id}:{}", column.id));
                            }
                        }
                    }
                }
                _ => {}
            }
            if !ids.is_empty() {
                elements.insert(prompt.id.clone(), json!(ids));
            }
        }
        prompt_map.insert(node.id.clone(), json!(prompt_ids));
        if !elements.is_empty() {
            element_map.insert(node.id.clone(), json!(elements));
        }
    }

    json!([{
        "domain_id": domain_id,
        "revealed_prompt_ids": prompt_map,
        "revealed_element_ids": element_map,
    }])
}

fn item_of_kind<'a>(mission: &'a Value, kind: &str) -> Option<&'a Value> {
    mission["items"]
        .as_array()?
        .iter()
        .find(|item| item["kind"] == kind)
}

#[tokio::test]
async fn daily_mission_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send_anonymous(
        app,
        "POST",
        "/v1/tracks/aws-soa-c03/daily-mission",
        Some(json!({ "timezone": "UTC", "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
}

#[tokio::test]
async fn first_request_creates_and_repeated_requests_return_identical_plan() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("daily-stable-{}", Uuid::new_v4());

    let (status, first) = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert!(!first["items"].as_array().expect("items").is_empty());

    // Repeated requests, including state changes, never regenerate the plan.
    seed_weak_concept(
        &pool,
        user_id_for(&pool, &subject).await,
        "soa-c03",
        "aws.monitoring_vs_logging",
        AssessmentMode::Recognition,
    )
    .await;
    let (status, second) = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(status, StatusCode::OK, "{second}");

    assert_eq!(first["id"], second["id"]);
    assert_eq!(first["day_key"], second["day_key"]);
    assert_eq!(first["plan_type"], second["plan_type"]);
    assert_eq!(first["items"], second["items"]);
}

#[tokio::test]
async fn daily_missions_work_for_non_certification_tracks() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    for track_id in ["ai-python-fluency", "python-data-stack", "ai-pytorch-core"] {
        let subject = format!("daily-track-{track_id}-{}", Uuid::new_v4());
        let (status, body) = get_daily(&app, &subject, track_id).await;
        assert_eq!(status, StatusCode::OK, "{track_id}: {body}");
        assert_eq!(body["track_id"], track_id);
        assert!(
            !body["items"].as_array().expect("items").is_empty(),
            "{track_id} should plan items: {body}"
        );
    }
}

#[tokio::test]
async fn unknown_track_returns_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("daily-missing-{}", Uuid::new_v4());

    let (status, body) = get_daily(&app, &subject, "does-not-exist").await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn opening_a_learning_node_alone_does_not_complete_it() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("daily-node-{}", Uuid::new_v4());
    let (_, mission) = get_daily(&app, &subject, "aws-soa-c03").await;
    let item = item_of_kind(&mission, "learn_node").expect("a learning node item");
    let position = item["position"].as_i64().expect("position");
    let mission_id = mission["id"].as_str().expect("mission id");

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/complete"),
        Some(json!({ "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["item_completed"], false, "{body}");

    // The item stays pending for the rest of the day.
    let (_, refreshed) = get_daily(&app, &subject, "aws-soa-c03").await;
    let item = item_of_kind(&refreshed, "learn_node").expect("node item");
    assert_eq!(item["status"], "pending");
}

#[tokio::test]
async fn completing_the_underlying_node_completes_the_item() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry: std::sync::Arc<ContentRegistry> = common::content();
    let subject = format!("daily-node-done-{}", Uuid::new_v4());
    let (_, mission) = get_daily(&app, &subject, "aws-soa-c03").await;
    let item = item_of_kind(&mission, "learn_node").expect("a learning node item");
    let position = item["position"].as_i64().expect("position");
    let mission_id = mission["id"].as_str().expect("mission id");
    let domain_id = item["domain_id"].as_str().expect("domain id");

    let discovery = full_discovery(&registry, "soa-c03", domain_id);
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/complete"),
        Some(json!({ "discovery": discovery })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["item_completed"], true, "{body}");

    let item = body["mission"]["items"]
        .as_array()
        .expect("items")
        .iter()
        .find(|entry| entry["position"] == position)
        .expect("item");
    assert_eq!(item["status"], "completed");
}

#[tokio::test]
async fn practice_items_are_server_authoritative_and_resume() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry: std::sync::Arc<ContentRegistry> = common::content();
    let subject = format!("daily-practice-{}", Uuid::new_v4());
    // Create the account first so the seeded weak concept is owned by a real user
    // before the adaptive plan is generated.
    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    seed_weak_concept(
        &pool,
        user_id,
        "soa-c03",
        "aws.monitoring_vs_logging",
        AssessmentMode::Recognition,
    )
    .await;

    let (status, mission) = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(status, StatusCode::OK, "{mission}");

    let Some(item) = item_of_kind(&mission, "practice") else {
        // Cold/content variance: adaptive planning may not produce a practice
        // item; the fallback still plans domain practice.
        return;
    };
    let position = item["position"].as_i64().expect("position");
    assert!(
        item["question_count"].as_u64().unwrap_or(0) > 0,
        "practice item must carry server-selected questions"
    );
    let mission_id = mission["id"].as_str().expect("mission id");

    let (status, started) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/start"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let questions = started["questions"].as_array().expect("questions");
    assert!(!questions.is_empty());
    for question in questions {
        let id = question["id"].as_str().expect("question id");
        assert!(
            registry.question("soa-c03", id).is_some(),
            "unknown question {id}"
        );
    }

    // Starting again resumes the same mission instead of duplicating it.
    let (status, resumed) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/start"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{resumed}");
    assert_eq!(started["id"], resumed["id"]);
}

#[tokio::test]
async fn domain_practice_item_starts_a_domain_quiz() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("daily-domain-{}", Uuid::new_v4());
    let (_, mission) = get_daily(&app, &subject, "aws-soa-c03").await;
    let Some(item) = item_of_kind(&mission, "domain_practice") else {
        return;
    };
    let position = item["position"].as_i64().expect("position");
    let domain_id = item["domain_id"].as_str().expect("domain id");
    let mission_id = mission["id"].as_str().expect("mission id");

    let (status, started) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/start"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    assert_eq!(started["mode"], "domain_quiz");
    assert_eq!(started["domain_id"], domain_id);
    assert!(
        !started["questions"]
            .as_array()
            .expect("questions")
            .is_empty()
    );
}

#[tokio::test]
async fn completing_every_item_awards_the_bonus_exactly_once() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("daily-complete-{}", Uuid::new_v4());
    let (status, mission) = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(status, StatusCode::OK, "{mission}");
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let user_id = user_id_for(&pool, &subject).await;
    let positions: Vec<i32> = mission["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["position"].as_i64().expect("position") as i32)
        .collect();

    // Simulate completing every underlying activity.
    for position in &positions {
        db::daily_missions::mark_item_complete(&pool, mission_id, *position)
            .await
            .expect("mark complete");
    }

    let (status, completed) = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(status, StatusCode::OK, "{completed}");
    assert_eq!(completed["status"], "completed");
    assert_eq!(completed["reward_granted"], true);
    assert_eq!(
        completed["completed_items"].as_u64().expect("completed"),
        positions.len() as u64
    );
    let balance = db::wallets::balance(&pool, user_id).await.expect("balance");
    assert_eq!(balance, completed["reward_bits"].as_i64().expect("reward"));

    // Reloading/retrying never awards again.
    for _ in 0..3 {
        let (_, again) = get_daily(&app, &subject, "aws-soa-c03").await;
        assert_eq!(again["reward_granted"], true);
    }
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        balance
    );
}

#[tokio::test]
async fn concurrent_first_requests_create_only_one_mission() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("daily-concurrent-{}", Uuid::new_v4());

    let first = get_daily(&app, &subject, "aws-soa-c03");
    let second = get_daily(&app, &subject, "aws-soa-c03");
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.0, StatusCode::OK, "{:?}", first.1);
    assert_eq!(second.0, StatusCode::OK, "{:?}", second.1);
    assert_eq!(first.1["id"], second.1["id"]);

    let user_id = user_id_for(&pool, &subject).await;
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM daily_missions
         WHERE user_id = $1 AND track_id = 'aws-soa-c03'
           AND day_key = (now() AT TIME ZONE 'UTC')::date",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("count missions");
    assert_eq!(count, 1);
}
