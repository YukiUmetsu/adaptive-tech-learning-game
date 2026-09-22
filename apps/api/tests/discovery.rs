//! Integration tests for persisted discovery, batched auxiliary sync, and
//! auxiliary failure isolation.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use std::sync::Arc;

use adaptive_learn_api::auth;
use adaptive_learn_api::config::Config;
use adaptive_learn_api::{AppState, build_router};
use adaptive_learn_content::{ContentRegistry, LearningReveal};
use adaptive_learn_db as db;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{Map, Value, json};
use tower::ServiceExt;
use uuid::Uuid;

fn registry() -> Arc<ContentRegistry> {
    common::content()
}

/// Builds discovery progress that completes every prompt in a domain.
fn full_discovery(version: &str, domain_id: &str) -> Value {
    let registry = registry();
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

async fn get_daily(app: &Router, subject: &str, track_id: &str) -> Value {
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/tracks/{track_id}/daily-mission"),
        Some(json!({ "timezone": "UTC", "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// Issues a task-practice mission and returns its body.
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

/// Maps a question's canonical answer into an answer payload.
fn canonical_answer_value(question: &adaptive_learn_content::Question) -> Value {
    match &question.canonical_answer {
        adaptive_learn_content::CanonicalAnswer::Classification { placements } => {
            json!({ "placements": placements })
        }
        adaptive_learn_content::CanonicalAnswer::Ordering { ordered_ids } => {
            json!({ "ordered_ids": ordered_ids })
        }
        adaptive_learn_content::CanonicalAnswer::NodeConnection { edges } => {
            json!({ "edges": edges })
        }
        adaptive_learn_content::CanonicalAnswer::EvidenceSelection { relevant_ids } => {
            json!({ "evidence_ids": relevant_ids })
        }
        adaptive_learn_content::CanonicalAnswer::SpotTheFault { faulty_ids } => {
            json!({ "faulty_ids": faulty_ids })
        }
        adaptive_learn_content::CanonicalAnswer::FillSlots { values } => {
            json!({ "slot_values": values })
        }
        adaptive_learn_content::CanonicalAnswer::Troubleshooting { expected_path, .. } => {
            json!({ "choice_path": expected_path })
        }
        adaptive_learn_content::CanonicalAnswer::ScenarioChoiceChain { expected_path, .. } => {
            json!({ "choice_path": expected_path })
        }
        adaptive_learn_content::CanonicalAnswer::ConfigurationBuilder { assignments } => {
            json!({ "assignments": assignments })
        }
        adaptive_learn_content::CanonicalAnswer::CommandAssembly { values } => {
            json!({ "token_values": values })
        }
        adaptive_learn_content::CanonicalAnswer::TypedFillBlank { answers } => {
            let typed: Map<String, Value> = answers
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
        adaptive_learn_content::CanonicalAnswer::Reconstruction { placements, edges } => {
            json!({ "reconstruction": { "placements": placements, "edges": edges } })
        }
        adaptive_learn_content::CanonicalAnswer::TwoDimensionalPlacement { regions } => {
            let positions: Map<String, Value> = regions
                .iter()
                .map(|(item_id, region)| {
                    let x = (region.x[0] + region.x[1]) / 2.0;
                    let y = (region.y[0] + region.y[1]) / 2.0;
                    (item_id.clone(), json!({ "x": x, "y": y }))
                })
                .collect();
            json!({ "positions": positions })
        }
        adaptive_learn_content::CanonicalAnswer::MultipleChoice { choice_id } => {
            json!({ "choice_id": choice_id })
        }
        adaptive_learn_content::CanonicalAnswer::MultipleResponse { choice_ids } => {
            json!({ "choice_ids": choice_ids })
        }
        adaptive_learn_content::CanonicalAnswer::PythonCode { tests } => json!({
            "python_results": { "passed": tests.len(), "total": tests.len() }
        }),
    }
}

#[tokio::test]
async fn sync_persists_discovery_and_the_track_endpoint_returns_it() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("discovery-sync-{}", Uuid::new_v4());

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "events": [],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": [{
                    "domain_id": "domain-1",
                    "revealed_prompt_ids": { "n1": ["p1"] },
                    "revealed_element_ids": { "n1": { "p1": ["annotation:a1"] } }
                }]
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["discovery"]["accepted"], true, "{body}");
    assert_eq!(body["auxiliary"]["accepted"], true, "{body}");

    let (status, body) = common::send_as(
        app,
        &subject,
        "GET",
        "/v1/tracks/aws-soa-c03/discovery",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["track_version"], "soa-c03");
    let domains = body["domains"].as_array().expect("domains");
    let domain = domains
        .iter()
        .find(|domain| domain["domain_id"] == "domain-1")
        .expect("domain-1");
    assert_eq!(domain["revealed_prompt_ids"]["n1"], json!(["p1"]));
    assert_eq!(
        domain["revealed_element_ids"]["n1"]["p1"],
        json!(["annotation:a1"])
    );
}

#[tokio::test]
async fn duplicate_discovery_updates_merge_idempotently() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("discovery-dup-{}", Uuid::new_v4());

    let batch = |prompts: Value| {
        json!({
            "events": [],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": [{
                    "domain_id": "domain-1",
                    "revealed_prompt_ids": prompts,
                    "revealed_element_ids": {}
                }]
            }]
        })
    };

    for _ in 0..2 {
        let (status, body) = common::send_as(
            app.clone(),
            &subject,
            "POST",
            "/v1/sync",
            Some(batch(json!({ "n1": ["p1", "p1"] }))),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["discovery"]["accepted"], true);
    }

    let (_, body) = common::send_as(
        app,
        &subject,
        "GET",
        "/v1/tracks/aws-soa-c03/discovery",
        None,
    )
    .await;
    let domain = body["domains"]
        .as_array()
        .expect("domains")
        .iter()
        .find(|domain| domain["domain_id"] == "domain-1")
        .expect("domain-1");
    assert_eq!(domain["revealed_prompt_ids"]["n1"], json!(["p1"]));
}

#[tokio::test]
async fn auxiliary_failure_does_not_reject_accepted_learning_events() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("discovery-isolation-{}", Uuid::new_v4());
    let device = Uuid::new_v4();

    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question_id = mission["questions"][0]["id"]
        .as_str()
        .expect("question id")
        .to_owned();
    let question = registry
        .question("soa-c03", &question_id)
        .expect("question")
        .clone();
    let answer = canonical_answer_value(&question);

    // The telemetry event has a blank track id (violates a DB check) so the
    // auxiliary section fails. The valid discovery update still lands, and the
    // accepted learning event must survive both.
    let (status, body) = common::send_as(
        app,
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [{
                "event_id": Uuid::new_v4(),
                "mission_instance_id": mission_id,
                "question_id": question_id,
                "content_version": content_version,
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 1200,
                "occurred_at": "2026-09-20T10:00:00Z",
                "answer": answer
            }],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": [{ "domain_id": "domain-1", "revealed_prompt_ids": { "n1": ["p1"] }, "revealed_element_ids": {} }]
            }],
            "auxiliary_events": [{
                "event_id": Uuid::new_v4(),
                "track_id": "",
                "recommendation_id": Uuid::new_v4(),
                "event": "shown"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["accepted"], true, "{body}");
    assert_eq!(body["discovery"]["accepted"], true, "{body}");
    assert_eq!(body["auxiliary"]["accepted"], false, "{body}");

    // The accepted event really was persisted.
    let accepted: i64 =
        sqlx::query_scalar("SELECT count(*) FROM learning_events WHERE mission_instance_id = $1")
            .bind(mission_id)
            .fetch_one(&pool)
            .await
            .expect("count events");
    assert_eq!(accepted, 1);
}

#[tokio::test]
async fn malformed_auxiliary_entries_do_not_fail_the_batch() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let registry = registry();
    let subject = format!("discovery-malformed-{}", Uuid::new_v4());
    let device = Uuid::new_v4();

    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");
    let content_version = mission["content_version"].as_str().expect("version");
    let question_id = mission["questions"][0]["id"]
        .as_str()
        .expect("question id")
        .to_owned();
    let question = registry
        .question("soa-c03", &question_id)
        .expect("question")
        .clone();
    let answer = canonical_answer_value(&question);

    // Malformed auxiliary entries (wrong types, unknown enum value, bad uuid)
    // must be dropped rather than turning the batch into a 400 that would discard
    // the accepted learning event.
    let (status, body) = common::send_as(
        app,
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "device_id": device,
            "events": [{
                "event_id": Uuid::new_v4(),
                "mission_instance_id": mission_id,
                "question_id": question_id,
                "content_version": content_version,
                "attempt_number": 1,
                "hint_count": 0,
                "response_ms": 1200,
                "occurred_at": "2026-09-20T10:00:00Z",
                "answer": answer
            }],
            "discovery_updates": [
                { "track_version": 123, "content_version": "soa-c03-content-v1" },
                { "track_version": "soa-c03", "content_version": "soa-c03-content-v1", "domains": "not-an-array" }
            ],
            "auxiliary_events": [
                { "event_id": "not-a-uuid", "track_id": "aws-soa-c03", "recommendation_id": Uuid::new_v4(), "event": "shown" },
                { "event_id": Uuid::new_v4(), "track_id": "aws-soa-c03", "recommendation_id": Uuid::new_v4(), "event": "bogus" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["accepted"], true, "{body}");

    let accepted: i64 =
        sqlx::query_scalar("SELECT count(*) FROM learning_events WHERE mission_instance_id = $1")
            .bind(mission_id)
            .fetch_one(&pool)
            .await
            .expect("count events");
    assert_eq!(accepted, 1);
}

#[tokio::test]
async fn auxiliary_data_piggybacks_on_a_normal_sync() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("discovery-piggyback-{}", Uuid::new_v4());

    let (status, body) = common::send_as(
        app,
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "events": [],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": [{ "domain_id": "domain-1", "revealed_prompt_ids": { "n1": ["p1"] }, "revealed_element_ids": {} }]
            }],
            "auxiliary_events": [{
                "event_id": Uuid::new_v4(),
                "track_id": "aws-soa-c03",
                "recommendation_id": Uuid::new_v4(),
                "event": "shown",
                "action": "learn_node",
                "domain_id": "domain-1",
                "node_id": "n1"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["discovery"]["accepted"], true, "{body}");
    assert_eq!(body["auxiliary"]["accepted"], true, "{body}");
}

#[tokio::test]
async fn persisted_discovery_completes_a_daily_node_without_a_client_delta() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("discovery-daily-{}", Uuid::new_v4());

    let mission = get_daily(&app, &subject, "aws-soa-c03").await;
    let item = item_of_kind(&mission, "learn_node").expect("a learning node item");
    let position = item["position"].as_i64().expect("position");
    let mission_id = mission["id"].as_str().expect("mission id");
    let domain_id = item["domain_id"].as_str().expect("domain id").to_owned();

    // Persist full discovery for the node's domain.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "events": [],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": full_discovery("soa-c03", &domain_id)
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["discovery"]["accepted"], true, "{body}");

    // The completion request carries no client discovery, yet the server unions
    // the persisted progress and completes the item.
    let (status, body) = common::send_as(
        app,
        &subject,
        "POST",
        &format!("/v1/daily-missions/{mission_id}/items/{position}/complete"),
        Some(json!({ "discovery": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["item_completed"], true, "{body}");
}

#[tokio::test]
async fn todays_mission_is_unchanged_after_new_discovery_syncs() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("discovery-immutable-{}", Uuid::new_v4());

    let first = get_daily(&app, &subject, "aws-soa-c03").await;
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/sync",
        Some(json!({
            "events": [],
            "discovery_updates": [{
                "track_version": "soa-c03",
                "content_version": "soa-c03-content-v1",
                "domains": full_discovery("soa-c03", "domain-1")
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let second = get_daily(&app, &subject, "aws-soa-c03").await;
    assert_eq!(first["id"], second["id"]);
    assert_eq!(first["day_key"], second["day_key"]);
    assert_eq!(first["items"], second["items"]);
}

#[tokio::test]
async fn discovery_endpoint_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let (status, _) =
        common::send_anonymous(app, "GET", "/v1/tracks/aws-soa-c03/discovery", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

async fn send_with_internal_token(
    app: Router,
    token: Option<&str>,
    uri: &str,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method("GET")
        .uri(uri)
        .header("authorization", "Bearer dev:internal-test");
    if let Some(token) = token {
        builder = builder.header("x-internal-token", token);
    }
    let request = builder.body(Body::empty()).expect("build request");
    let response = app.oneshot(request).await.expect("send request");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read body");
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

fn app_with_internal_config(pool: db::PgPool, enabled: bool, token: Option<&str>) -> Router {
    let mut source = vec![
        ("APP_ENV", "test"),
        ("DATABASE_URL", "postgres://app:app@127.0.0.1:1/app"),
    ];
    if enabled {
        source.push(("INTERNAL_EVALUATION_ENABLED", "true"));
    } else {
        source.push(("INTERNAL_EVALUATION_ENABLED", "false"));
    }
    if let Some(token) = token {
        source.push(("INTERNAL_API_TOKEN", token));
    }
    let config = Config::from_source(source).expect("valid config");
    let authenticator = auth::build_authenticator(&config);
    build_router(AppState::new(pool, registry(), authenticator), &config)
}

#[tokio::test]
async fn internal_evaluation_is_hidden_when_disabled() {
    // No database is needed: a disabled endpoint is not mounted at all, so it
    // returns 404 before authentication is attempted.
    let app = app_with_internal_config(common::unreachable_pool(), false, None);
    let (status, _) = send_with_internal_token(app, None, "/internal/model-evaluation").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn internal_evaluation_requires_its_token_when_configured() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = app_with_internal_config(pool, true, Some("internal-secret"));

    let (status, _) =
        send_with_internal_token(app.clone(), None, "/internal/model-evaluation").await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a learner token alone is not enough"
    );

    let (status, _) =
        send_with_internal_token(app, Some("internal-secret"), "/internal/model-evaluation").await;
    assert_eq!(status, StatusCode::OK);
}
