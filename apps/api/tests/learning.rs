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
        CanonicalAnswer::MultipleChoice { choice_id } => json!({ "choice_id": choice_id }),
        CanonicalAnswer::MultipleResponse { choice_ids } => json!({ "choice_ids": choice_ids }),
        CanonicalAnswer::PythonCode { tests } => json!({
            "python_results": { "passed": tests.len(), "total": tests.len() }
        }),
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
            "mode": "task_practice",
            "task_id": "1.1"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "issue failed: {body}");
    body
}

async fn issue_as(app: &Router, subject: &str, device: Uuid) -> Value {
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

    // The mission is issued against the certification version's content version.
    let bundle = registry.bundle_for_version("soa-c03").expect("bundle");
    assert_eq!(
        mission["content_version"],
        Value::from(bundle.version.content_version.clone())
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
async fn sync_rejects_events_for_another_user() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let owner = "owner-user";
    let attacker = "attacker-user";
    let mission = issue_as(&app, owner, Uuid::new_v4()).await;
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

    let (status, body) = common::send_as(app, attacker, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["accepted"], false);
    assert_eq!(body["results"][0]["error_code"], "forbidden");
}

#[tokio::test]
async fn another_user_cannot_answer_or_complete_a_mission() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let owner = "mission-owner";
    let attacker = "mission-attacker";
    let mission = issue_as(&app, owner, Uuid::new_v4()).await;
    let mission_id = mission["id"].as_str().expect("mission id").to_owned();
    let question = question(&registry, "monitoring-classification-001");

    let (status, body) = common::send_as(
        app.clone(),
        attacker,
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            Uuid::new_v4(),
            &mission_id,
            &question.id,
            mission["content_version"].as_str().expect("version"),
            Uuid::new_v4(),
            correct_answer(&question),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = common::send_as(
        app,
        attacker,
        "POST",
        &format!("/v1/missions/{mission_id}/complete"),
        Some(json!({ "device_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
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
            "mode": "task_practice",
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
async fn typed_fill_blank_scores_through_the_api() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();
    let mission = issue_task(&app, device, "aws-soa-c03-demo", "soa-c03-demo", "D2.2").await;
    let mission_id = mission["id"].as_str().expect("mission id");

    let question = version_question(&registry, "soa-c03-demo", "demo-typed-sg-nacl-001");

    // Messy whitespace and trailing punctuation normalize to a full score.
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
                "typed_answers": {
                    "sg_behavior": " Stateful. ",
                    "nacl_behavior": "STATELESS"
                }
            }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "typed failed: {body}");
    assert_eq!(body["score"], 1.0);

    // One wrong blank makes the whole question incorrect.
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
                "typed_answers": {
                    "sg_behavior": "stateful",
                    "nacl_behavior": "stateful"
                }
            }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "typed failed: {body}");
    assert_eq!(body["score"], 0.5);
    assert!(
        body["error_codes"]
            .as_array()
            .expect("error codes")
            .iter()
            .any(|code| code == "typed_fill_blank_incorrect")
    );

    // A similar-looking service name is not accepted through fuzzy matching.
    let sqs = version_question(&registry, "soa-c03-demo", "demo-typed-sqs-001");
    let (status, body) = common::send(
        app.clone(),
        "POST",
        &format!("/v1/missions/{mission_id}/answers"),
        Some(answer_body(
            device,
            mission_id,
            &sqs.id,
            "soa-c03-demo-content-v1",
            Uuid::new_v4(),
            json!({ "typed_answers": { "service": "SNS" } }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "typed failed: {body}");
    assert_eq!(body["score"], 0.0);
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

async fn issue_mode(
    app: &Router,
    device: Uuid,
    mode: &str,
    domain_id: Option<&str>,
    task_id: Option<&str>,
) -> (StatusCode, Value) {
    common::send(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": mode,
            "domain_id": domain_id,
            "task_id": task_id
        })),
    )
    .await
}

async fn issue_mode_as(
    app: &Router,
    subject: &str,
    device: Uuid,
    mode: &str,
    domain_id: Option<&str>,
    task_id: Option<&str>,
) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": mode,
            "domain_id": domain_id,
            "task_id": task_id
        })),
    )
    .await
}

fn wrong_classification_answer(question: &Question) -> Value {
    let CanonicalAnswer::Classification { placements } = &question.canonical_answer else {
        panic!("expected classification canonical answer");
    };
    let Interaction::Classification { categories, .. } = &question.interaction else {
        panic!("expected classification interaction");
    };
    // Flip every placement into a different category so the answer is an
    // unambiguous failure (partial credit for one flipped item can otherwise
    // clear the success threshold).
    let mut wrong = placements.clone();
    for (item, correct) in placements {
        let other = categories
            .iter()
            .find(|category| &category.id != correct)
            .expect("another category")
            .id
            .clone();
        wrong.insert(item.clone(), other);
    }
    json!({ "placements": wrong })
}

#[tokio::test]
async fn quick_quiz_selects_a_short_cross_domain_set() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let (status, body) = issue_mode(&app, Uuid::new_v4(), "quick_adaptive", None, None).await;
    assert_eq!(status, StatusCode::OK, "quick failed: {body}");
    assert_eq!(body["mode"], "quick_adaptive");

    let questions = body["questions"].as_array().expect("questions");
    assert_eq!(questions.len(), 3);
    let mut domains: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for question in questions {
        assert!(question.get("canonical_answer").is_none());
        let id = question["id"].as_str().expect("id");
        ids.insert(id);
        let resolved = registry.question("soa-c03", id).expect("question");
        domains.insert(resolved.domain_id.clone());
    }
    assert_eq!(ids.len(), 3, "quick quiz must not repeat questions");
    assert!(
        domains.len() >= 3,
        "quick quiz should cover several domains: {domains:?}"
    );
}

#[tokio::test]
async fn domain_quiz_scopes_to_a_domain_and_requires_one() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();

    let (status, body) =
        issue_mode(&app, Uuid::new_v4(), "domain_quiz", Some("domain-2"), None).await;
    assert_eq!(status, StatusCode::OK, "domain failed: {body}");
    assert_eq!(body["mode"], "domain_quiz");
    assert_eq!(body["domain_id"], "domain-2");
    let questions = body["questions"].as_array().expect("questions");
    assert_eq!(questions.len(), 20);
    for question in questions {
        let id = question["id"].as_str().expect("id");
        let resolved = registry.question("soa-c03", id).expect("question");
        assert_eq!(resolved.domain_id, "domain-2");
    }

    let (status, _) = issue_mode(&app, Uuid::new_v4(), "domain_quiz", None, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn full_practice_produces_a_full_unique_set() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let (status, body) = issue_mode(&app, Uuid::new_v4(), "full_practice", None, None).await;
    assert_eq!(status, StatusCode::OK, "full failed: {body}");
    assert_eq!(body["mode"], "full_practice");
    assert!(body["domain_id"].is_null());

    let questions = body["questions"].as_array().expect("questions");
    assert_eq!(questions.len(), 65);
    let ids: std::collections::HashSet<&str> = questions
        .iter()
        .map(|question| question["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids.len(), 65, "no duplicate question ids");
}

#[tokio::test]
async fn task_practice_requires_a_task() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let (status, _) = issue_mode(&app, Uuid::new_v4(), "task_practice", None, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

async fn issue_section_quiz_as(
    app: &Router,
    subject: &str,
    device: Uuid,
    domain_id: Option<&str>,
    module_id: Option<&str>,
) -> (StatusCode, Value) {
    common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03",
            "certification_version": "soa-c03",
            "mode": "section_quiz",
            "domain_id": domain_id,
            "module_id": module_id
        })),
    )
    .await
}

#[tokio::test]
async fn section_quiz_selects_one_module_question_and_settles_bonus_once() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = format!("section-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();

    // A section quiz must name both the domain and the learning module.
    let (status, _) = issue_section_quiz_as(&app, &subject, device, Some("domain-1"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = issue_section_quiz_as(
        &app,
        &subject,
        device,
        Some("domain-1"),
        Some("no-such-module"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, mission) = issue_section_quiz_as(
        &app,
        &subject,
        device,
        Some("domain-1"),
        Some("d1-alarms-events"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "section quiz failed: {mission}");
    assert_eq!(mission["mode"], "section_quiz");
    assert_eq!(mission["domain_id"], "domain-1");
    assert_eq!(mission["module_id"], "d1-alarms-events");

    let questions = mission["questions"].as_array().expect("questions");
    assert_eq!(questions.len(), 1, "a section quiz is exactly one question");
    let question_id = questions[0]["id"].as_str().expect("question id");
    let question = registry.question("soa-c03", question_id).expect("question");
    assert_eq!(question.domain_id, "domain-1");
    assert!(
        ["1.1", "1.2"].contains(&question.task_id.as_str()),
        "question must belong to the module's tasks, got {}",
        question.task_id
    );
    assert!(
        questions[0].get("canonical_answer").is_some(),
        "ordinary missions ship local scoring data"
    );

    let mission_uuid: Uuid = mission["id"].as_str().unwrap().parse().unwrap();
    let content_version = mission["content_version"].as_str().unwrap();
    let batch = json!({
        "device_id": device,
        "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": content_version,
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1500,
            "occurred_at": "2026-09-22T10:00:00Z",
            "answer": correct_answer(question)
        }]
    });
    let (status, body) =
        common::send_as(app.clone(), &subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    let settled = body["results"][0]["bits_settled"].as_i64().expect("bits");
    assert!(settled > 0, "a correct first attempt earns Bits");
    assert_eq!(
        body["bits_balance"],
        settled + 20,
        "completing the section quiz settles its one-time bonus"
    );

    // Retaking the section quiz earns per-answer Bits but never the bonus again.
    let (status, retake) = issue_section_quiz_as(
        &app,
        &subject,
        device,
        Some("domain-1"),
        Some("d1-alarms-events"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{retake}");
    let retake_uuid: Uuid = retake["id"].as_str().unwrap().parse().unwrap();
    let retake_question = registry
        .question(
            "soa-c03",
            retake["questions"][0]["id"].as_str().expect("question id"),
        )
        .expect("question")
        .clone();
    let retake_version = retake["content_version"].as_str().unwrap();
    let batch = json!({
        "device_id": device,
        "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": retake_uuid,
            "question_id": retake_question.id,
            "content_version": retake_version,
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1500,
            "occurred_at": "2026-09-22T10:05:00Z",
            "answer": correct_answer(&retake_question)
        }]
    });
    let (status, body) =
        common::send_as(app.clone(), &subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let retake_bits = body["results"][0]["bits_settled"].as_i64().expect("bits");
    assert_eq!(
        body["bits_balance"],
        settled + 20 + retake_bits,
        "the section bonus must not settle twice"
    );
}

#[tokio::test]
async fn mixed_mission_events_use_question_scope_and_settle_once() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("mixed-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let (status, mission) =
        issue_mode_as(&app, &subject, device, "quick_adaptive", None, None).await;
    assert_eq!(status, StatusCode::OK, "quick failed: {mission}");
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question_id = mission["questions"][0]["id"].as_str().expect("question id");
    let question = registry.question("soa-c03", question_id).expect("question");

    let event_id = Uuid::new_v4();
    let batch = json!({
        "device_id": device,
        "events": [{
            "event_id": event_id,
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": content_version,
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1200,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": correct_answer(question)
        }]
    });

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(batch.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    let settled = body["results"][0]["bits_settled"].as_i64().expect("bits");
    assert!(settled > 0, "first correct attempt should earn Bits");
    assert_eq!(body["bits_balance"], settled);

    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].domain_id, question.domain_id);
    assert_eq!(events[0].task_id, question.task_id);

    // Replaying the event is idempotent and settles nothing further.
    let (status, body) =
        common::send_as(app.clone(), &subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["accepted"], true);
    assert_eq!(body["results"][0]["bits_settled"], 0);
    assert_eq!(body["bits_balance"], settled);
}

#[tokio::test]
async fn wrong_attempt_earns_nothing_and_recovery_earns_less() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = format!("recovery-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_id = mission["id"].as_str().expect("mission id");
    let mission_uuid: Uuid = mission_id.parse().expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question = question(&registry, "monitoring-classification-001");

    // Attempt 1: wrong, no Bits.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({ "device_id": device, "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": content_version,
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1000,
            "occurred_at": "2026-09-19T10:00:00Z",
            "answer": wrong_classification_answer(&question)
        }]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["bits_settled"], 0);
    assert_eq!(body["bits_balance"], 0);

    // Attempt 2: correct recovery, earns Bits but less than a first attempt.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({ "device_id": device, "events": [{
            "event_id": Uuid::new_v4(),
            "mission_instance_id": mission_uuid,
            "question_id": question.id,
            "content_version": content_version,
            "attempt_number": 2,
            "hint_count": 0,
            "response_ms": 1000,
            "occurred_at": "2026-09-19T10:01:00Z",
            "answer": correct_answer(&question)
        }]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let recovery = body["results"][0]["bits_settled"].as_i64().expect("bits");
    assert!(recovery > 0, "recovery must still earn Bits");
    assert!(
        recovery < 10,
        "recovery should be less than the base first-attempt reward: {recovery}"
    );
    assert_eq!(body["bits_balance"], recovery);
}

#[tokio::test]
async fn same_user_on_two_devices_sees_one_wallet() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = "multi-device-user";
    let device_a = Uuid::new_v4();
    let device_b = Uuid::new_v4();

    let mission = issue_as(&app, subject, device_a).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    // Settle a correct answer from device A.
    let batch = json!({
        "device_id": device_a,
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
    let (status, body) =
        common::send_as(app.clone(), subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let earned = body["bits_balance"].as_i64().expect("bits balance");
    assert!(earned > 0, "a correct first attempt should earn Bits");

    // The same account on device B sees the same wallet.
    let (status, body) = common::send_as(app.clone(), subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bits_balance"], earned);

    // A different account has its own wallet.
    let (status, body) = common::send_as(app, "someone-else", "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bits_balance"], 0);
    let _ = device_b;
}

#[tokio::test]
async fn duplicated_sync_event_never_duplicates_bits() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = "idempotent-bits-user";
    let device = Uuid::new_v4();
    let mission = issue_as(&app, subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");
    let event_id = Uuid::new_v4();

    let batch = json!({
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
    });

    let (status, first) = common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/sync",
        Some(batch.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let settled = first["bits_balance"].as_i64().expect("bits balance");
    assert!(settled > 0);

    let (status, second) =
        common::send_as(app.clone(), subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["results"][0]["bits_settled"], 0);
    assert_eq!(second["bits_balance"], settled);
}

#[tokio::test]
async fn adaptive_history_combines_a_users_devices() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = "cross-device-history-user";
    let device_a = Uuid::new_v4();
    let device_b = Uuid::new_v4();

    let mission = issue_as(&app, subject, device_a).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");
    let event = json!({
        "event_id": Uuid::new_v4(),
        "mission_instance_id": mission_uuid,
        "question_id": question.id,
        "content_version": mission["content_version"],
        "attempt_number": 1,
        "hint_count": 0,
        "response_ms": 1000,
        "occurred_at": "2026-09-19T10:00:00Z",
        "answer": correct_answer(&question)
    });
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        "/v1/sync",
        Some(json!({ "device_id": device_a, "events": [event] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The user's history now includes the device-A event, regardless of the
    // device that queries next.
    let user_id = adaptive_learn_db::users::find_by_auth_subject(&pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id;
    let history =
        adaptive_learn_db::learning_events::recent_for_user(&pool, user_id, "aws-soa-c03", 50)
            .await
            .expect("history");
    assert!(
        history.iter().any(|entry| entry.question_id == question.id),
        "history must include the event recorded from device A"
    );

    // Another account has no such history.
    assert!(
        adaptive_learn_db::learning_events::recent_for_user(
            &pool,
            Uuid::new_v4(),
            "aws-soa-c03",
            50,
        )
        .await
        .expect("history")
        .is_empty(),
        "another user's selection must not see this history"
    );
    let _ = device_b;
}

#[tokio::test]
async fn public_demo_missions_work_without_login_and_award_no_bits() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let device = Uuid::new_v4();

    // Anonymous demo issuance is allowed for the demo certification only.
    let (status, mission) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03-demo",
            "certification_version": "soa-c03-demo",
            "mode": "task_practice",
            "task_id": "D2.1"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "anonymous demo issue failed: {mission}"
    );
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");

    // A non-demo certification still requires authentication.
    let (status, body) = common::send_anonymous(
        app.clone(),
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
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");

    // Anonymous demo sync accepts evidence but settles no Bits.
    let question = version_question(&registry, "soa-c03-demo", "demo-reconstruction-nat-001");
    let (status, body) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [{
                "event_id": Uuid::new_v4(),
                "mission_instance_id": mission_uuid,
                "question_id": question.id,
                "content_version": "soa-c03-demo-content-v1",
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 1200,
                "occurred_at": "2026-09-19T10:00:00Z",
                "answer": correct_answer(&question)
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["accepted"], true);
    assert_eq!(body["results"][0]["bits_settled"], 0);
    assert_eq!(body["bits_balance"], 0);
}

#[tokio::test]
async fn sync_reports_authoritative_scoring_fields() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = format!("sync-result-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question = question(&registry, "monitoring-classification-001");
    let event_id = Uuid::new_v4();

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                content_version,
                event_id,
                0,
                correct_answer(&question),
            )]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The sync response mirrors the server's own scoring, never a client claim.
    let result = &body["results"][0];
    assert_eq!(result["event_id"], event_id.to_string());
    assert_eq!(result["accepted"], true);
    assert_eq!(result["correct"], true);
    assert_eq!(result["score"], 1.0);
    assert_eq!(result["error_codes"], json!([]));
}

#[tokio::test]
async fn sync_completes_a_mission_once_every_question_is_answered() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let device = Uuid::new_v4();

    // Anonymous demo task practice keeps the answer loop small and needs no
    // account; completion semantics are the same.
    let (status, mission) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03-demo",
            "certification_version": "soa-c03-demo",
            "mode": "task_practice",
            "task_id": "D2.1"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mission}");
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let questions = mission["questions"].as_array().expect("questions").clone();
    assert!(!questions.is_empty());

    let events: Vec<Value> = questions
        .iter()
        .map(|entry| {
            let question_id = entry["id"].as_str().expect("question id");
            let question = version_question(&registry, "soa-c03-demo", question_id);
            event_body(
                mission_uuid,
                &question,
                content_version,
                Uuid::new_v4(),
                0,
                correct_answer(&question),
            )
        })
        .collect();

    let (status, body) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/sync",
        Some(json!({ "device_id": device, "events": events })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["results"]
            .as_array()
            .expect("results")
            .iter()
            .all(|result| result["accepted"].as_bool() == Some(true)),
        "every answer should be accepted: {body}"
    );

    // Completion is derived from accepted server-side evidence, not a client
    // completion claim.
    let stored = db::missions::find_by_id(&pool, mission_uuid)
        .await
        .expect("lookup mission")
        .expect("mission exists");
    assert_eq!(
        stored.status,
        adaptive_learn_domain::MissionStatus::Completed,
        "mission should complete once every question has accepted evidence"
    );
}

async fn sync_one(app: &Router, subject: &str, batch: Value) -> Value {
    let (status, body) =
        common::send_as(app.clone(), subject, "POST", "/v1/sync", Some(batch)).await;
    assert_eq!(status, StatusCode::OK, "sync failed: {body}");
    body
}

fn event_body(
    mission_uuid: Uuid,
    question: &Question,
    content_version: &str,
    event_id: Uuid,
    hint_count: i64,
    answer: Value,
) -> Value {
    json!({
        "event_id": event_id,
        "mission_instance_id": mission_uuid,
        "question_id": question.id,
        "content_version": content_version,
        "attempt_number": 1,
        "hint_count": hint_count,
        "response_ms": 1500,
        "occurred_at": "2026-09-19T10:00:00Z",
        "answer": answer
    })
}

async fn user_id_for(pool: &adaptive_learn_db::PgPool, subject: &str) -> Uuid {
    adaptive_learn_db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

#[tokio::test]
async fn sync_persists_canonical_difficulty_prior_in_accepted_evidence() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("difficulty-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    sync_one(
        &app,
        &subject,
        json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                mission["content_version"].as_str().expect("version"),
                Uuid::new_v4(),
                0,
                correct_answer(&question),
            )]
        }),
    )
    .await;

    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].difficulty_prior, question.difficulty_prior,
        "accepted evidence must preserve the server difficulty prior"
    );
    assert_eq!(events[0].hint_count, 0);
}

#[tokio::test]
async fn accepted_sync_updates_derived_concept_state_idempotently() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("concept-state-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");
    let concept_id = question.concepts[0].concept_id.clone();
    let event_id = Uuid::new_v4();
    let batch = json!({
        "device_id": device,
        "events": [event_body(
            mission_uuid,
            &question,
            mission["content_version"].as_str().expect("version"),
            event_id,
            0,
            correct_answer(&question),
        )]
    });

    sync_one(&app, &subject, batch.clone()).await;
    let user_id = user_id_for(&pool, &subject).await;
    let after_first = adaptive_learn_db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        &concept_id,
        question.assessment_mode,
    )
    .await
    .expect("find state")
    .expect("state row");
    assert_eq!(after_first.model_version, "heuristic-v1");
    assert_eq!(after_first.exposure_count, 1);
    assert_eq!(after_first.success_count, 1);
    assert!(after_first.estimate > 0.5);

    // Replaying the exact same event must not advance the derived cache.
    sync_one(&app, &subject, batch).await;
    let after_replay = adaptive_learn_db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        &concept_id,
        question.assessment_mode,
    )
    .await
    .expect("find state")
    .expect("state row");
    assert_eq!(
        after_replay.exposure_count, 1,
        "replay must not double count"
    );
    assert_eq!(after_replay.state_version, after_first.state_version);
    assert_eq!(after_replay.estimate, after_first.estimate);
}

#[tokio::test]
async fn failure_then_recovery_advances_counters_in_order() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("recovery-state-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question = question(&registry, "monitoring-classification-001");
    let concept_id = question.concepts[0].concept_id.clone();

    sync_one(
        &app,
        &subject,
        json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                content_version,
                Uuid::new_v4(),
                0,
                wrong_classification_answer(&question),
            )]
        }),
    )
    .await;
    sync_one(
        &app,
        &subject,
        json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                content_version,
                Uuid::new_v4(),
                2,
                correct_answer(&question),
            )]
        }),
    )
    .await;

    let user_id = user_id_for(&pool, &subject).await;
    let state = adaptive_learn_db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        &concept_id,
        question.assessment_mode,
    )
    .await
    .expect("find state")
    .expect("state row");
    assert_eq!(state.exposure_count, 2);
    assert_eq!(state.failure_count, 1);
    assert_eq!(state.success_count, 1);
    assert_eq!(state.state_version, 2);

    // The hinted recovery is still recorded, including its hint count.
    let events = db::learning_events::list_for_mission(&pool, mission_uuid)
        .await
        .expect("list events");
    assert_eq!(events.len(), 2);
    let recovery = events
        .iter()
        .find(|event| event.attempt_number == 2)
        .expect("recovery event");
    assert_eq!(recovery.hint_count, 2);
}

#[tokio::test]
async fn anonymous_demo_attempts_create_no_derived_user_state() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let device = Uuid::new_v4();

    let (status, mission) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/missions/issue",
        Some(json!({
            "device_id": device,
            "certification_id": "aws-soa-c03-demo",
            "certification_version": "soa-c03-demo",
            "mode": "task_practice",
            "task_id": "D2.1"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mission}");
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = version_question(&registry, "soa-c03-demo", "demo-reconstruction-nat-001");

    let (status, body) = common::send_anonymous(
        app.clone(),
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                "soa-c03-demo-content-v1",
                Uuid::new_v4(),
                0,
                correct_answer(&question),
            )]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["accepted"], true);

    // Anonymous attempts write immutable evidence but must not create a derived
    // user row. Demo content never reaches this table, so the count stays zero.
    let demo_state_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM user_concept_state WHERE certification_version = 'soa-c03-demo'",
    )
    .fetch_one(&pool)
    .await
    .expect("count demo state");
    assert_eq!(demo_state_count, 0);
}

#[tokio::test]
async fn sync_rejects_out_of_range_hints() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let registry = registry();
    let subject = format!("hint-range-user-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    let mission = issue_as(&app, &subject, device).await;
    let mission_uuid: Uuid = mission["id"]
        .as_str()
        .expect("mission id")
        .parse()
        .expect("uuid");
    let question = question(&registry, "monitoring-classification-001");

    let body = sync_one(
        &app,
        &subject,
        json!({
            "device_id": device,
            "events": [event_body(
                mission_uuid,
                &question,
                mission["content_version"].as_str().expect("version"),
                Uuid::new_v4(),
                99,
                correct_answer(&question),
            )]
        }),
    )
    .await;
    assert_eq!(body["results"][0]["accepted"], false);
    assert_eq!(body["results"][0]["error_code"], "bad_request");
}
