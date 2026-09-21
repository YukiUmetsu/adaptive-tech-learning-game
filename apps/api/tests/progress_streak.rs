//! Integration tests for the Track Hub Knowledge Signal and account-wide streak.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db as db;
use axum::Router;
use axum::http::StatusCode;
use chrono::Utc;
use chrono_tz::Tz;
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn registry() -> std::sync::Arc<ContentRegistry> {
    common::content()
}

async fn user_id_for(pool: &db::PgPool, subject: &str) -> Uuid {
    db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

async fn create_account(app: &Router, subject: &str) {
    let (status, _) = common::send_as(app.clone(), subject, "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK);
}

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
    }
}

/// Syncs one accepted event and returns the response body.
async fn sync_answer(
    app: &Router,
    subject: &str,
    device: Uuid,
    mission: &Value,
    event_id: Uuid,
    timezone: Option<&str>,
) -> Value {
    let mission_id = mission["id"].as_str().expect("id");
    let content_version = mission["content_version"].as_str().expect("version");
    let question_id = mission["questions"][0]["id"].as_str().expect("question id");
    let question = registry()
        .question("soa-c03", question_id)
        .expect("question")
        .clone();
    let answer = canonical_answer_value(&question);

    let mut body = json!({
        "device_id": device,
        "events": [{
            "event_id": event_id,
            "mission_instance_id": mission_id,
            "question_id": question_id,
            "content_version": content_version,
            "attempt_number": 1,
            "hint_count": 0,
            "response_ms": 1200,
            "occurred_at": "2026-09-20T10:00:00Z",
            "answer": answer
        }]
    });
    if let Some(timezone) = timezone {
        body["timezone"] = json!(timezone);
    }

    let (status, response) =
        common::send_as(app.clone(), subject, "POST", "/v1/sync", Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    response
}

async fn me_streak(app: &Router, subject: &str) -> Value {
    let (status, body) = common::send_as(app.clone(), subject, "GET", "/v1/me", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["streak"].clone()
}

// ---------------------------------------------------------------------------
// Knowledge Signal
// ---------------------------------------------------------------------------

#[tokio::test]
async fn track_progress_returns_coarse_signals_without_mastery_claims() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("progress-signal-{}", Uuid::new_v4());
    create_account(&app, &subject).await;

    let (status, body) = common::send_as(
        app,
        &subject,
        "GET",
        "/v1/tracks/aws-soa-c03/progress",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["track_id"], "aws-soa-c03");
    let domains = body["domains"].as_array().expect("domains");
    assert!(!domains.is_empty());

    let node = &domains[0]["nodes"][0];
    assert_eq!(node["discovery_state"], "unexplored");
    assert_eq!(node["evidence_level"], "none");
    assert_eq!(node["freshness_state"], "unknown");

    // No percentages, probabilities, or mastery claims are exposed.
    let serialized = body.to_string();
    for forbidden in ["percent", "mastery", "probability", "pass_chance", "score"] {
        assert!(
            !serialized.contains(forbidden),
            "progress must not expose {forbidden}: {serialized}"
        );
    }
}

#[tokio::test]
async fn track_progress_requires_authentication() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let (status, _) =
        common::send_anonymous(app, "GET", "/v1/tracks/aws-soa-c03/progress", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn track_progress_and_map_work_for_non_certification_tracks() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("progress-track-{}", Uuid::new_v4());
    create_account(&app, &subject).await;

    for track_id in ["ai-python-fluency", "ai-pytorch-core"] {
        let (status, map) = common::send_as(
            app.clone(),
            &subject,
            "GET",
            &format!("/v1/tracks/{track_id}/map"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{track_id} map: {map}");
        assert_eq!(map["track_id"], track_id);
        assert!(!map["domains"].as_array().expect("domains").is_empty());

        let (status, progress) = common::send_as(
            app.clone(),
            &subject,
            "GET",
            &format!("/v1/tracks/{track_id}/progress"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{track_id} progress: {progress}");
        assert!(!progress["domains"].as_array().expect("domains").is_empty());
    }
}

#[tokio::test]
async fn track_progress_evidence_and_freshness_follow_concept_state() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("progress-evidence-{}", Uuid::new_v4());
    create_account(&app, &subject).await;
    let user_id = user_id_for(&pool, &subject).await;

    // Seed a strong-but-stale concept state directly.
    let concept = adaptive_learn_domain::ConceptWeight {
        concept_id: "aws.monitoring_vs_logging".to_owned(),
        weight: 1.0,
    };
    let mut tx = pool.begin().await.expect("begin");
    adaptive_learn_db::concept_state::apply(
        &mut tx,
        &adaptive_learn_domain::ConceptObservation {
            user_id,
            certification_version: "soa-c03",
            concept: &concept,
            assessment_mode: adaptive_learn_domain::AssessmentMode::Recognition,
            score: 1.0,
            attempt_number: 1,
            hint_count: 0,
            occurred_at: Utc::now() - chrono::Duration::days(200),
        },
    )
    .await
    .expect("seed concept state");
    tx.commit().await.expect("commit");

    let (status, body) = common::send_as(
        app,
        &subject,
        "GET",
        "/v1/tracks/aws-soa-c03/progress",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Find a node that references the seeded concept and assert its signal.
    let nodes: Vec<&Value> = body["domains"]
        .as_array()
        .expect("domains")
        .iter()
        .flat_map(|domain| domain["nodes"].as_array().expect("nodes"))
        .collect();
    let signal = nodes
        .iter()
        .find(|node| {
            node["mode_signals"]
                .as_array()
                .expect("modes")
                .iter()
                .any(|mode| mode["assessment_mode"] == "recognition")
        })
        .expect("a node with recognition evidence");
    assert_eq!(signal["evidence_level"], "early");
    // Two hundred days later the evidence has decayed: the node still reads as
    // learned (early evidence), but review is useful.
    assert_eq!(signal["freshness_state"], "due");
}

#[tokio::test]
async fn track_map_returns_all_domains() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("progress-map-{}", Uuid::new_v4());
    create_account(&app, &subject).await;

    let (status, body) =
        common::send_as(app, &subject, "GET", "/v1/tracks/aws-soa-c03/map", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let domains = body["domains"].as_array().expect("domains");
    assert!(domains.len() >= 2);
    assert!(
        domains
            .iter()
            .all(|domain| domain["modules"].as_array().is_some()),
        "each domain carries its modules"
    );
}

// ---------------------------------------------------------------------------
// Daily study streak
// ---------------------------------------------------------------------------

#[tokio::test]
async fn first_accepted_event_activates_todays_streak() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("streak-first-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    create_account(&app, &subject).await;

    let before = me_streak(&app, &subject).await;
    assert_eq!(before["current"], 0);
    assert_eq!(before["active_today"], false);

    let mission = issue_task(&app, &subject, device).await;
    sync_answer(
        &app,
        &subject,
        device,
        &mission,
        Uuid::new_v4(),
        Some("UTC"),
    )
    .await;

    let after = me_streak(&app, &subject).await;
    assert_eq!(after["current"], 1, "{after}");
    assert_eq!(after["active_today"], true, "{after}");

    let user_id = user_id_for(&pool, &subject).await;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}

#[tokio::test]
async fn duplicate_sync_does_not_advance_the_streak_twice() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("streak-duplicate-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    create_account(&app, &subject).await;

    let mission = issue_task(&app, &subject, device).await;
    let event_id = Uuid::new_v4();
    sync_answer(&app, &subject, device, &mission, event_id, Some("UTC")).await;
    // Replay the exact same event.
    sync_answer(&app, &subject, device, &mission, event_id, Some("UTC")).await;

    let user_id = user_id_for(&pool, &subject).await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_study_days WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("count days");
    assert_eq!(count, 1);

    let streak = me_streak(&app, &subject).await;
    assert_eq!(streak["current"], 1);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}

#[tokio::test]
async fn streak_derivation_spans_tracks_and_resets_after_a_gap() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("streak-derive-{}", Uuid::new_v4());
    create_account(&app, &subject).await;
    let user_id = user_id_for(&pool, &subject).await;

    // Seed consecutive days including today: the current streak counts them.
    let today = Utc::now().date_naive();
    for offset in 0..3 {
        db::study_days::record(&pool, user_id, today - chrono::Duration::days(offset))
            .await
            .expect("record day");
    }
    let streak = me_streak(&app, &subject).await;
    assert_eq!(streak["current"], 3, "{streak}");
    assert_eq!(streak["longest"], 3);

    // A separate account with an old gap has no current streak.
    let gap_subject = format!("streak-gap-{}", Uuid::new_v4());
    create_account(&app, &gap_subject).await;
    let gap_user = user_id_for(&pool, &gap_subject).await;
    for offset in 5..8 {
        db::study_days::record(&pool, gap_user, today - chrono::Duration::days(offset))
            .await
            .expect("record day");
    }
    let gap = me_streak(&app, &gap_subject).await;
    assert_eq!(gap["current"], 0, "{gap}");
    assert_eq!(gap["longest"], 3, "{gap}");

    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(vec![user_id, gap_user])
        .execute(&pool)
        .await
        .expect("delete users");
}

#[tokio::test]
async fn streak_uses_the_persisted_timezone_boundary() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("streak-timezone-{}", Uuid::new_v4());
    create_account(&app, &subject).await;
    let user_id = user_id_for(&pool, &subject).await;

    let timezone: Tz = "Pacific/Kiritimati".parse().expect("valid tz");
    db::users::set_timezone_if_absent(&pool, user_id, "Pacific/Kiritimati")
        .await
        .expect("set timezone");

    // Record the learner's local today; the derivation must use the same zone.
    let local_today = Utc::now().with_timezone(&timezone).date_naive();
    db::study_days::record(&pool, user_id, local_today)
        .await
        .expect("record day");

    let streak = me_streak(&app, &subject).await;
    assert_eq!(streak["active_today"], true, "{streak}");
    assert_eq!(streak["current"], 1, "{streak}");
    assert_eq!(
        streak["last_active_day"],
        local_today.format("%Y-%m-%d").to_string()
    );

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}

#[tokio::test]
async fn timezone_change_cannot_farm_study_days() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool.clone());
    let subject = format!("streak-tz-abuse-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    create_account(&app, &subject).await;

    // The first sync captures the timezone; a later change cannot move the day.
    let mission = issue_task(&app, &subject, device).await;
    sync_answer(
        &app,
        &subject,
        device,
        &mission,
        Uuid::new_v4(),
        Some("America/Los_Angeles"),
    )
    .await;
    sync_answer(
        &app,
        &subject,
        device,
        &mission,
        Uuid::new_v4(),
        Some("Pacific/Kiritimati"),
    )
    .await;

    let user_id = user_id_for(&pool, &subject).await;
    let timezone = db::users::timezone(&pool, user_id).await.expect("timezone");
    assert_eq!(timezone.as_deref(), Some("America/Los_Angeles"));

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_study_days WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("count days");
    assert_eq!(count, 1, "a timezone change must not add study days");

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}

// ---------------------------------------------------------------------------
// Mission review and settings
// ---------------------------------------------------------------------------

async fn complete_mission(app: &Router, subject: &str, mission_id: Uuid) {
    let (status, body) = common::send_as(
        app.clone(),
        subject,
        "POST",
        &format!("/v1/missions/{mission_id}/complete"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn mission_review_returns_answers_only_after_completion() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("review-mission-{}", Uuid::new_v4());
    let device = Uuid::new_v4();
    create_account(&app, &subject).await;
    let mission = issue_task(&app, &subject, device).await;
    let mission_id: Uuid = mission["id"].as_str().expect("id").parse().expect("uuid");

    // Canonical answers are hidden until the mission is complete.
    let (status, _) = common::send_as(
        app.clone(),
        &subject,
        "GET",
        &format!("/v1/missions/{mission_id}/review"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    sync_answer(
        &app,
        &subject,
        device,
        &mission,
        Uuid::new_v4(),
        Some("UTC"),
    )
    .await;
    complete_mission(&app, &subject, mission_id).await;

    let (status, body) = common::send_as(
        app,
        &subject,
        "GET",
        &format!("/v1/missions/{mission_id}/review"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let questions = body["questions"].as_array().expect("questions");
    assert!(!questions.is_empty());
    assert!(questions[0].get("canonical_answer").is_some());
    assert!(questions[0].get("interaction").is_some());
    assert!(!body["attempts"].as_array().expect("attempts").is_empty());
}

#[tokio::test]
async fn user_settings_round_trip_through_me() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let app = common::app_with_pool(pool);
    let subject = format!("settings-{}", Uuid::new_v4());
    create_account(&app, &subject).await;

    let (_, me) = common::send_as(app.clone(), &subject, "GET", "/v1/me", None).await;
    assert_eq!(me["settings"]["unlock_all_materials"], false);

    let (status, updated) = common::send_as(
        app.clone(),
        &subject,
        "PUT",
        "/v1/me/settings",
        Some(json!({ "unlock_all_materials": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["unlock_all_materials"], true);

    let (_, me) = common::send_as(app, &subject, "GET", "/v1/me", None).await;
    assert_eq!(me["settings"]["unlock_all_materials"], true);
}
