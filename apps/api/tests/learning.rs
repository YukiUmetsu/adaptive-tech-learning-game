//! End-to-end API tests for mission issuance, scoring, sync, and completion.
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
            "reconstruction": {
                "placements": placements,
                "edges": edges,
            }
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
    }
}

async fn issue(app: &Router, device: Uuid) -> Value {
    let (status, body) = common::send(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "task_id": "1.1"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "issue failed: {body}");
    body
}

fn answer_body(
    device: Uuid,
    _mission_id: &str,
    question_id: &str,
    content_version: &str,
    event_id: Uuid,
    answer: Value,
) -> Value {
    json!({
        "device_id": device,
        "event_id": event_id,
        "question_id": question_id,
        "content_version": content_version,
        "attempt_number": 1,
        "hint_count": 0,
        "response_ms": 4200,
        "occurred_at": "2026-09-19T10:00:00Z",
        "answer": answer
    })
}

#[tokio::test]
async fn mission_contains_questions_without_answer_keys() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let mission = issue(&app, Uuid::new_v4()).await;

    let expected = registry.questions_for_task("soa-c03", "1.1");
    let questions = mission["questions"].as_array().expect("questions array");
    assert_eq!(questions.len(), expected.len());
    for question in questions {
        assert!(
            question.get("canonical_answer").is_none(),
            "answer key must not be sent with a mission"
        );
    }

    // The mission is issued against the content version that owns the task.
    let first = expected.first().expect("task has questions");
    assert_eq!(
        mission["content_version"],
        Value::from(first.content_version.clone())
    );
}

#[tokio::test]
async fn classification_scoring_returns_partial_credit() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");
    let question = question(&registry, "monitoring-classification-001");

    // Fully correct.
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &question.id,
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            correct_answer(&question),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "answer failed: {body}");
    assert_eq!(body["correct"], true);
    assert_eq!(body["score"], 1.0);

    // One item misplaced.
    let CanonicalAnswer::Classification { placements } = &question.canonical_answer else {
        panic!("expected classification canonical answer");
    };
    let Interaction::Classification { categories, .. } = &question.interaction else {
        panic!("expected classification interaction");
    };
    let (item, correct_category) = placements.iter().next().expect("placement");
    let other_category = categories
        .iter()
        .find(|category| &category.id != correct_category)
        .expect("another category")
        .id
        .clone();
    let mut wrong = placements.clone();
    wrong.insert(item.clone(), other_category);

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &question.id,
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            json!({ "placements": wrong }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["correct"], false);
    assert_eq!(body["score"], 0.8);
    assert!(
        body["error_codes"]
            .as_array()
            .expect("error codes")
            .iter()
            .any(|code| code == "classification_misplaced")
    );
}

#[tokio::test]
async fn ordering_and_connection_scoring_work() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let ordering = question(&registry, "monitoring-ordering-001");
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &ordering.id,
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            correct_answer(&ordering),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["score"], 1.0);

    let connection = question(&registry, "monitoring-connection-001");
    let CanonicalAnswer::NodeConnection { edges } = &connection.canonical_answer else {
        panic!("expected connection canonical answer");
    };
    let mut missing_one = edges.clone();
    missing_one.pop();

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &connection.id,
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            json!({ "edges": missing_one }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["score"].as_f64().expect("score") < 1.0);
    assert!(
        body["error_codes"]
            .as_array()
            .expect("error codes")
            .iter()
            .any(|code| code == "connection_missing_relationship")
    );
}

#[tokio::test]
async fn invalid_answer_ids_are_rejected() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "monitoring-classification-001",
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            json!({ "placements": { "ghost_item": "metric" } }),
        )),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "bad_request");
}

#[tokio::test]
async fn content_version_mismatch_is_rejected() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "monitoring-classification-001",
            "soa-c03-content-v0",
            Uuid::new_v4(),
            json!({ "placements": {} }),
        )),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "conflict");
}

#[tokio::test]
async fn sync_persists_events_idempotently() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id").to_owned();
    let mission_uuid: Uuid = mission_id.parse().expect("mission uuid");
    let question = question(&registry, "monitoring-classification-001");
    let event_id = Uuid::new_v4();

    let event = json!({
        "event_id": event_id,
        "mission_instance_id": mission_uuid,
        "question_id": question.id,
        "content_version": mission["content_version"],
        "attempt_number": 1,
        "hint_count": 0,
        "response_ms": 3000,
        "occurred_at": "2026-09-19T10:00:00Z",
        "answer": correct_answer(&question)
    });
    let batch = json!({ "device_id": device, "events": [event] });

    let (status, body) = common::send(app.clone(), "POST", "/v1/sync", Some(batch.clone())).await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    assert_eq!(body["results"][0]["accepted"], true);

    // Replaying the same event must be idempotent.
    let (status, body) = common::send(app.clone(), "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["accepted"], true);

    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    assert_eq!(
        events.len(),
        1,
        "duplicate event id must not create a second row"
    );
    assert_eq!(events[0].event_id, event_id);
    assert_eq!(events[0].score, 1.0);
}

#[tokio::test]
async fn sync_rejects_events_for_another_device() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let owner = Uuid::new_v4();
    let mission = issue(&app, owner).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let batch = json!({
        "device_id": Uuid::new_v4(),
        "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": mission["content_version"],
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1000,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": correct_answer(&question)
        }]
    });

    let (status, body) = common::send(app, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["accepted"], false);
    assert_eq!(body["results"][0]["error_code"], "forbidden");
}

#[tokio::test]
async fn sync_derives_attempt_number_server_side() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let event = |event_id: Uuid| {
        json!({
            "event_id": event_id,
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": mission["content_version"],
            // A client could lie about this; the server must ignore it.
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1000,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": correct_answer(&question)
        })
    };

    let batch = json!({
        "device_id": device,
        "events": [event(Uuid::new_v4()), event(Uuid::new_v4())]
    });

    let (status, body) = common::send(app, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");

    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    let attempts: Vec<i32> = events.iter().map(|event| event.attempt_number).collect();
    assert_eq!(
        attempts,
        vec![1, 2],
        "attempt numbers must be server-derived"
    );
}

#[tokio::test]
async fn sync_reports_structured_scoring_errors() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let batch = json!({
        "device_id": device,
        "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": mission["content_version"],
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1000,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": { "placements": { "ghost_item": "metric" } }
        }]
    });

    let (status, body) = common::send(app, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["accepted"], false);
    assert_eq!(body["results"][0]["error_code"], "unknown_item");
}

#[tokio::test]
async fn concurrent_syncs_assign_distinct_attempt_numbers() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let batch = |event_id: Uuid| {
        json!({
            "device_id": device,
            "events": [{
                "event_id": event_id,
                "mission_instance_id": mission_uuid,
                "question_id": question.id,
                "content_version": mission["content_version"],
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 1000,
                "occurred_at": "2026-09-19T10:00:00Z",
                "answer": correct_answer(&question)
            }]
        })
    };

    let first = common::send(app.clone(), "POST", "/v1/sync", Some(batch(Uuid::new_v4())));
    let second = common::send(app.clone(), "POST", "/v1/sync", Some(batch(Uuid::new_v4())));
    let (first_result, second_result) = tokio::join!(first, second);

    assert_eq!(first_result.0, StatusCode::OK, "{:?}", first_result.1);
    assert_eq!(second_result.0, StatusCode::OK, "{:?}", second_result.1);

    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    let mut attempts: Vec<i32> = events.iter().map(|event| event.attempt_number).collect();
    attempts.sort();
    assert_eq!(
        attempts,
        vec![1, 2],
        "concurrent syncs must not assign the same attempt number"
    );
}

#[tokio::test]
async fn completed_mission_rejects_further_answers() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue(&app, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");
    let question = question(&registry, "monitoring-classification-001");

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/complete"),
        Some(json!({ "device_id": device })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "complete failed: {body}");
    assert_eq!(body["status"], "completed");

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &question.id,
            mission["content_version"]
                .as_str()
                .expect("mission content version"),
            Uuid::new_v4(),
            correct_answer(&question),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "conflict");
}

#[tokio::test]
async fn unknown_mission_returns_404() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();

    let (status, body) = common::send(
        app,
        "POST",
        &format!("/v1/missions/{}/answers", Uuid::new_v4()),
        Some(answer_body(
            device,
            "00000000-0000-0000-0000-000000000000",
            "monitoring-classification-001",
            "soa-c03-content-v1",
            Uuid::new_v4(),
            json!({ "placements": {} }),
        )),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}

fn version_question(registry: &ContentRegistry, version: &str, id: &str) -> Question {
    registry
        .question(version, id)
        .expect("question exists")
        .clone()
}

async fn issue_task(
    app: &Router,
    device: Uuid,
    certification_id: &str,
    certification_version: &str,
    task_id: &str,
) -> Value {
    let (status, body) = common::send(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": certification_id,
            "certification_version": certification_version,
            "task_id": task_id
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "issue failed: {body}");
    body
}

#[tokio::test]
async fn demo_mission_hides_answers_and_scores_every_new_interaction() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D2.1").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    for question in mission["questions"].as_array().expect("questions array") {
        assert!(
            question.get("canonical_answer").is_none(),
            "answer key must not be sent with a demo mission"
        );
    }

    let ids = [
        "demo-reconstruction-nat-001",
        "demo-evidence-vpc-001",
        "demo-fault-route-001",
        "demo-fill-route-001",
        "demo-troubleshooting-alb-001",
        "demo-scenario-alarm-001",
        "demo-config-nat-001",
        "demo-placement-dr-001",
    ];

    for id in ids {
        let question = version_question(&registry, "soa-c03-demo", id);
        let (status, body) = common::send(
            app.clone(),
            "POST",
            &format!("/v1/missions/{mission_id}/answers"),
            Some(answer_body(
                device,
                mission_id,
                &question.id,
                "soa-c03-demo-content-v1",
                Uuid::new_v4(),
                correct_answer(&question),
            )),
        )
        .await;

        assert_eq!(status, StatusCode::OK, "{id} failed: {body}");
        assert_eq!(body["correct"], true, "{id}");
        assert_eq!(body["score"], 1.0, "{id}");
        assert!(
            body["canonical_answer"].is_object(),
            "canonical answer is revealed after scoring {id}"
        );
    }
}

#[tokio::test]
async fn new_interactions_return_partial_credit_and_structured_errors() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D2.1").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    // Fill slots: one correct, one wrong, one missing.
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "demo-fill-route-001",
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({
                "slot_values": {
                    "destination": "all_ipv4",
                    "target": "internet_gateway"
                }
            }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "fill failed: {body}");
    assert!((body["score"].as_f64().expect("score") - 1.0 / 3.0).abs() < 1e-9);
    let codes = body["error_codes"].as_array().expect("error codes");
    assert!(codes.iter().any(|code| code == "slot_incorrect"));
    assert!(codes.iter().any(|code| code == "slot_unfilled"));

    // Evidence selection: one hit plus one false positive.
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "demo-evidence-vpc-001",
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({ "evidence_ids": ["vpc_flow_logs", "cpu_utilization"] }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "evidence failed: {body}");
    let codes = body["error_codes"].as_array().expect("error codes");
    assert!(
        codes
            .iter()
            .any(|code| code == "evidence_selected_irrelevant")
    );
    assert!(codes.iter().any(|code| code == "evidence_missing_relevant"));
}

#[tokio::test]
async fn sync_rejects_a_malformed_new_interaction_payload() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D2.1").await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");

    let batch = json!({
        "device_id": device,
        "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": "demo-reconstruction-nat-001",
            "content_version": "soa-c03-demo-content-v1",
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 2000,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": {
                "reconstruction": {
                    "placements": { "slot_1": "ghost_piece" },
                    "edges": []
                }
            }
        }]
    });

    let (status, body) = common::send(app, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    assert_eq!(body["results"][0]["accepted"], false);
    assert_eq!(body["results"][0]["error_code"], "unknown_piece");
}

#[tokio::test]
async fn branching_and_configuration_return_structured_errors() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D2.1").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    // A wrong first diagnostic decision that stops early.
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "demo-troubleshooting-alb-001",
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({ "choice_path": ["check_rds_metrics"] }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "troubleshooting failed: {body}");
    assert_eq!(body["score"], 0.0);
    let codes = body["error_codes"].as_array().expect("error codes");
    assert!(
        codes
            .iter()
            .any(|code| code == "troubleshooting_wrong_diagnosis")
    );
    assert!(
        codes
            .iter()
            .any(|code| code == "troubleshooting_incomplete_path")
    );

    // A configuration that uses an unnecessary component in one role.
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            "demo-config-nat-001",
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({
                "assignments": {
                    "private_route_target": "nat_gateway",
                    "nat_host_subnet": "public_subnet",
                    "public_route_target": "egress_only_igw"
                }
            }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "configuration failed: {body}");
    assert!((body["score"].as_f64().expect("score") - 1.0 / 3.0).abs() < 1e-9);
    let codes = body["error_codes"].as_array().expect("error codes");
    assert!(
        codes
            .iter()
            .any(|code| code == "config_unnecessary_component")
    );
}

#[tokio::test]
async fn command_assembly_and_placement_score_through_the_api() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D1.1").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let question = version_question(&registry, "soa-c03-demo", "demo-command-presign-001");
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &question.id,
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            correct_answer(&question),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "command failed: {body}");
    assert_eq!(body["score"], 1.0);

    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &question.id,
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({
                "token_values": {
                    "service_action": "s3_presign",
                    "target": "object_uri",
                    "expiry_flag": "expires_in",
                    "expiry_value": "recursive"
                }
            }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "command failed: {body}");
    assert_eq!(body["score"], 0.75);
    assert!(
        body["error_codes"]
            .as_array()
            .expect("error codes")
            .iter()
            .any(|code| code == "command_token_wrong")
    );
}

#[tokio::test]
async fn reconstruction_payloads_hide_placements_until_scoring() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D1.1").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let mut seen_reconstruction = false;
    for question in mission["questions"].as_array().expect("questions array") {
        if question["interaction_type"] != "reconstruction" {
            continue;
        }
        seen_reconstruction = true;
        assert!(
            question["interaction"].get("placements").is_none(),
            "the interaction must not expose canonical placements"
        );
        assert!(
            question.get("canonical_answer").is_none(),
            "the answer key must not be sent with a mission"
        );
    }
    assert!(
        seen_reconstruction,
        "demo mission should include a reconstruction"
    );

    // The graph reconstruction scores placements and topology together.
    let graph = version_question(
        &registry,
        "soa-c03-demo",
        "demo-reconstruction-alarm-graph-001",
    );
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &graph.id,
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            correct_answer(&graph),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "graph failed: {body}");
    assert_eq!(body["correct"], true);
    assert_eq!(body["score"], 1.0);
    assert!(body["canonical_answer"].is_object());
}
