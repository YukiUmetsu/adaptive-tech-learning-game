//! Integration tests for authored multi-stage challenges.
//!
//! Tests that issue a challenge require PostgreSQL and are skipped when
//! `DATABASE_URL` is unset; read-only content and authentication tests run
//! without a database.

mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

const TRACK: &str = "ai-python-fluency";
const CHALLENGE: &str = "python-fluency-zip-journey";

async fn start_challenge(app: &axum::Router, subject: &str, body: Value) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/tracks/{TRACK}/challenges/{CHALLENGE}/start"),
        Some(body),
    )
    .await
}

#[tokio::test]
async fn challenge_start_requires_authentication() {
    let (status, body) = common::send_anonymous(
        common::app_without_database(),
        "POST",
        &format!("/v1/tracks/{TRACK}/challenges/{CHALLENGE}/start"),
        Some(json!({})),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn unknown_challenge_returns_not_found() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, _) = common::send(
        app,
        "POST",
        &format!("/v1/tracks/{TRACK}/challenges/does-not-exist/start"),
        Some(json!({})),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn track_map_lists_authored_challenges() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send(app, "GET", &format!("/v1/tracks/{TRACK}/map"), None).await;

    assert_eq!(status, StatusCode::OK, "map failed: {body}");
    let challenges = body["challenges"].as_array().expect("challenges array");
    assert!(
        challenges.iter().any(|entry| entry["id"] == CHALLENGE),
        "the sample challenge should be listed: {challenges:?}"
    );
}

#[tokio::test]
async fn generic_issue_rejects_challenge_mode() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    let (status, body) = common::send(
        app,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "certification_id": TRACK,
            "certification_version": "python-fluency-v1",
            "mode": "challenge"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "bad_request");
}

#[tokio::test]
async fn challenge_issues_one_ordered_server_composed_mission() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);

    // A client-supplied `question_ids` field is ignored: the server composes
    // the mission from the authored definition.
    let (status, body) = start_challenge(
        &app,
        common::DEFAULT_SUBJECT,
        json!({ "question_ids": ["not-a-real-question"] }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "start failed: {body}");
    assert_eq!(body["mode"], "challenge");
    assert_eq!(body["certification_version"], "python-fluency-v1");
    assert!(
        body["content_version"]
            .as_str()
            .is_some_and(|v| !v.is_empty()),
        "content version must be frozen at issuance"
    );

    // Question stages ship in authored order; node stages are orchestrated by
    // the challenge view, not the question list.
    let question_ids: Vec<&str> = body["questions"]
        .as_array()
        .expect("questions")
        .iter()
        .map(|question| question["id"].as_str().expect("question id"))
        .collect();
    assert_eq!(
        question_ids,
        vec![
            "py1-zip-behavior-002",
            "py1-zip-fault-003",
            "py1-unzip-empty-003"
        ]
    );
    assert!(
        !question_ids.contains(&"not-a-real-question"),
        "client-supplied ids must never enter the mission"
    );

    let stages = body["challenge"]["stages"]
        .as_array()
        .expect("challenge stages");
    assert_eq!(stages.len(), 4);
    assert_eq!(stages[0]["kind"], "question");
    assert_eq!(stages[2]["kind"], "learning_node");
    assert_eq!(stages[2]["node_id"], "domain-1-zip_parallel");
    assert!(
        stages
            .windows(2)
            .all(|pair| pair[0]["order"].as_u64() < pair[1]["order"].as_u64()),
        "stages must be ordered"
    );
}
