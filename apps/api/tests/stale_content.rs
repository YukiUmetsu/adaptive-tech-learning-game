//! Stale-mission handling.
//!
//! A certification's content can change while a mission is persisted: question
//! ids are renamed or removed and the content version is bumped. A mission
//! issued from the older content then references questions that no longer
//! exist. These tests pin the recoverable behavior: the request must not fail
//! with a server error, and a stale Daily Mission item must be replaced instead
//! of resumed.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_db as db;
use adaptive_learn_domain::MissionStatus;
use axum::Router;
use axum::http::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

/// A question id that exists in no authored content.
const GHOST_QUESTION: &str = "ghost-stale-question-001";

/// A knowledge node id that exists in no authored content.
const GHOST_NODE: &str = "ghost-stale-node-001";

async fn issue_task(app: &Router, subject: &str, device: Uuid) -> Value {
    let (status, mission) = common::send_as(
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
    assert_eq!(status, StatusCode::OK, "{mission}");
    mission
}

/// Rewrites a mission's question ids to a question that exists in no current
/// content, simulating a mission issued from an older content version.
async fn make_stale(pool: &db::PgPool, mission_id: Uuid) {
    sqlx::query("UPDATE mission_instances SET question_ids = $1::jsonb WHERE id = $2")
        .bind(json!([GHOST_QUESTION]).to_string())
        .bind(mission_id)
        .execute(pool)
        .await
        .expect("corrupt mission question ids");
}

#[tokio::test]
async fn answering_a_stale_mission_is_a_conflict_not_a_server_error() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("stale-answer-{}", Uuid::new_v4());
    let device = Uuid::new_v4();

    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("mission id").parse().unwrap();
    make_stale(&pool, mission_id).await;

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(json!({
            "device_id": device,
            "event_id": Uuid::new_v4(),
            "question_id": GHOST_QUESTION,
            "content_version": mission["content_version"],
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 900,
            "occurred_at": "2026-09-22T10:00:00Z",
            "answer": {}
        })),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "mission_content_stale", "{body}");
}

#[tokio::test]
async fn syncing_a_stale_mission_event_is_rejected_without_failing_the_batch() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("stale-sync-{}", Uuid::new_v4());
    let device = Uuid::new_v4();

    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("mission id").parse().unwrap();
    make_stale(&pool, mission_id).await;

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [{
                "event_id": Uuid::new_v4(),
                "mission_instance_id": mission_id,
                "question_id": GHOST_QUESTION,
                "content_version": mission["content_version"],
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 900,
                "occurred_at": "2026-09-22T10:00:00Z",
                "answer": {}
            }]
        })),
    )
    .await;

    // The batch succeeds; only the stale event is rejected, so a client can
    // drop the mission and keep syncing unrelated queued work.
    assert_eq!(status, StatusCode::OK, "{body}");
    let result = &body["results"][0];
    assert_eq!(result["accepted"], false, "{body}");
    assert_eq!(result["error_code"], "mission_content_stale", "{body}");
}

#[tokio::test]
async fn starting_a_daily_item_replaces_a_stale_mission() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("stale-daily-{}", Uuid::new_v4());

    let (status, daily) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/tracks/aws-soa-c03/daily-mission",
        Some(json!({ "timezone": "UTC", "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{daily}");

    let Some(item) = daily["items"].as_array().and_then(|items| {
        items.iter().find(|item| {
            matches!(
                item["kind"].as_str(),
                Some("practice") | Some("domain_practice")
            )
        })
    }) else {
        return;
    };
    let position = item["position"].as_i64().expect("position");
    let daily_id = daily["id"].as_str().expect("daily id");

    let start_uri = format!("/v1/daily-missions/{daily_id}/items/{position}/start");
    let (status, started) = common::send_as(app.clone(), &subject, "POST", &start_uri, None).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let original_id: Uuid = started["id"].as_str().expect("mission id").parse().unwrap();
    make_stale(&pool, original_id).await;

    // Starting the same item again must replace the stale mission, not resume it.
    let (status, replaced) = common::send_as(app.clone(), &subject, "POST", &start_uri, None).await;
    assert_eq!(status, StatusCode::OK, "{replaced}");
    assert_ne!(
        replaced["id"], started["id"],
        "a stale mission must not be resumed"
    );
    assert!(
        !replaced["questions"]
            .as_array()
            .expect("questions")
            .is_empty(),
        "the replacement mission must carry current questions"
    );

    let stale = db::missions::find_by_id(&pool, original_id)
        .await
        .expect("load stale mission")
        .expect("stale mission row");
    assert_eq!(stale.status, MissionStatus::Completed);
}

#[tokio::test]
async fn reading_a_daily_mission_with_removed_content_rebuilds_the_plan() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = common::content();
    let subject = format!("stale-daily-plan-{}", Uuid::new_v4());

    let (status, daily) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/tracks/aws-soa-c03/daily-mission",
        Some(json!({ "timezone": "UTC", "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{daily}");
    let mission_id: Uuid = daily["id"].as_str().expect("id").parse().unwrap();
    assert!(
        daily["items"]
            .as_array()
            .expect("items")
            .iter()
            .any(|item| item["kind"] == "learn_node"),
        "expected a learning node item: {daily}"
    );

    // Simulate a content revision removing the node the plan referenced.
    sqlx::query(
        "UPDATE daily_mission_items SET node_id = $1
         WHERE daily_mission_id = $2 AND kind IN ('learn_node', 'review_node')",
    )
    .bind(GHOST_NODE)
    .bind(mission_id)
    .execute(&pool)
    .await
    .expect("corrupt node ids");

    let (status, refreshed) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/tracks/aws-soa-c03/daily-mission",
        Some(json!({ "timezone": "UTC", "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{refreshed}");

    // The mission identity and the reward are preserved; only the plan changed.
    assert_eq!(refreshed["id"], daily["id"], "{refreshed}");
    assert_eq!(refreshed["reward_granted"], false, "{refreshed}");
    assert!(
        refreshed["items"]
            .as_array()
            .expect("items")
            .iter()
            .all(|item| item["node_id"] != GHOST_NODE),
        "the removed node must not survive the rebuild: {refreshed}"
    );
    for item in refreshed["items"].as_array().expect("items") {
        if matches!(
            item["kind"].as_str(),
            Some("learn_node") | Some("review_node")
        ) {
            let node_id = item["node_id"].as_str().expect("node id");
            let domain_id = item["domain_id"].as_str().expect("domain id");
            assert!(
                registry
                    .learning_domain("soa-c03", domain_id)
                    .and_then(|domain| domain.node(node_id))
                    .is_some(),
                "rebuilt plan still references missing node {node_id}"
            );
        }
    }
}
