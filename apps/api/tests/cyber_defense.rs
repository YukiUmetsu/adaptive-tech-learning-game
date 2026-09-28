//! Integration tests for the Cyber Defense Stage 2 profile and campaign rewards.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_db as db;
use adaptive_learn_domain::xp_for_hero_level;
use axum::Router;
use common::{app_with_pool, database_pool, send_anonymous, send_as};
use db::PgPool;
use serde_json::json;
use uuid::Uuid;

fn subject(label: &str) -> String {
    format!("cyber-{label}-{}", Uuid::new_v4())
}

/// Resolves the internal user id created for a dev subject.
async fn user_id(pool: &PgPool, subject: &str) -> Uuid {
    db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

/// Credits a wallet directly so a test can exercise spending paths.
async fn fund(pool: &PgPool, user_id: Uuid, amount: i64) {
    let mut tx = pool.begin().await.expect("begin funding");
    let transaction = db::wallets::BitTransaction {
        user_id,
        device_id: None,
        event_id: Uuid::new_v4(),
        mission_instance_id: Uuid::new_v4(),
        question_id: "test_funding".to_owned(),
        amount,
        reason: "test_funding".to_owned(),
    };
    db::wallets::settle(&mut tx, &transaction)
        .await
        .expect("settle funding");
    tx.commit().await.expect("commit funding");
}

/// Marks every Chapter 1 mission complete directly in the DB.
///
/// This unlocks Operations without settling campaign Bits, which keeps the
/// operation tests' wallet assertions exact.
async fn unlock_operations(pool: &PgPool, user_id: Uuid) {
    let mut tx = pool.begin().await.expect("begin unlock");
    for mission_id in [
        "ddos-basics",
        "sql-injection",
        "credential-stuffing",
        "mixed-defense",
        "botnet-boss",
    ] {
        db::cyber_defense::upsert_campaign_result(&mut tx, user_id, mission_id, true, 3, 90, true)
            .await
            .expect("campaign result");
    }
    tx.commit().await.expect("commit unlock");
}

/// Creates the user (via a profile read) and unlocks Operations.
async fn ensure_operations_unlocked(app: Router, pool: &PgPool, subject: &str) {
    let (status, _) = send_as(app, subject, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200);
    unlock_operations(pool, user_id(pool, subject).await).await;
}

/// Backdates a run's start so the server-elapsed integrity floor is satisfied.
///
/// Real runs are played over minutes; tests settle immediately, so they age the
/// run instead of weakening the guard.
async fn backdate_run(pool: &PgPool, run_id: Uuid, seconds: i64) {
    let mut conn = pool.acquire().await.expect("acquire");
    sqlx::query(
        "UPDATE cyber_operation_runs
         SET started_at = now() - make_interval(secs => $2)
         WHERE id = $1",
    )
    .bind(run_id)
    .bind(seconds as f64)
    .execute(&mut *conn)
    .await
    .expect("backdate run");
}

/// Starts an Operation and returns its run id.
async fn start_operation(app: Router, subject: &str, threat: i32) -> String {
    let (status, body) = send_as(
        app,
        subject,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": threat })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    body["run_id"].as_str().unwrap().to_owned()
}

/// Reads a run id (as a `Uuid`) so tests can backdate it.
fn run_uuid(run_id: &str) -> Uuid {
    Uuid::parse_str(run_id).expect("run id is a uuid")
}

#[tokio::test]
async fn profile_requires_authentication() {
    let app = common::app_without_database();
    let (status, body) = send_anonymous(app, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 401, "{body}");
}

#[tokio::test]
async fn profile_creates_defaults_and_lists_heroes() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("defaults");

    let (status, body) =
        send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["career"]["level"], 1);
    assert_eq!(body["career"]["xp"], 0);
    assert_eq!(body["bits_balance"], 0);
    assert_eq!(body["tower_level"], 1);
    assert_eq!(body["recommended_threat_level"], 1);
    assert_eq!(body["unlocked_threat_level"], 3);
    assert_eq!(body["story"]["active_chapter"], "chapter-1");

    let heroes = body["heroes"].as_array().expect("heroes array");
    assert_eq!(heroes.len(), 2);
    let ids: Vec<&str> = heroes
        .iter()
        .map(|hero| hero["hero_id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"security_engineer"));
    assert!(ids.contains(&"sre"));
    assert!(heroes.iter().all(|hero| hero["xp"] == 0));
}

#[tokio::test]
async fn campaign_first_clear_settles_bits_and_xp_once() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("first-clear");
    let result_id = Uuid::new_v4();

    let payload = json!({
        "result_id": result_id,
        "stars": 3,
        "health": 80,
        "duration_ms": 60_000,
        "hero_id": "security_engineer",
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["reward"]["bits"], 75);
    assert_eq!(body["reward"]["career_xp"], 115);
    assert_eq!(body["reward"]["hero_xp"], 35);
    assert_eq!(body["bits_balance"], 75);
    assert_eq!(body["career"]["xp"], 115);
    assert_eq!(body["career"]["level"], 2);
    assert_eq!(body["career"]["level_up"], true);
    assert_eq!(body["newly_settled"], true);
    assert_eq!(body["campaign"]["best_stars"], 3);

    // A retried completion with the same idempotency key settles nothing.
    let payload = json!({
        "result_id": result_id,
        "stars": 3,
        "health": 80,
        "duration_ms": 60_000,
        "hero_id": "security_engineer",
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["newly_settled"], false);
    assert_eq!(body["reward"]["bits"], 0);
    assert_eq!(body["bits_balance"], 75, "duplicate settled no Bits");

    let (status, wallet) = send_as(app.clone(), &user, "GET", "/v1/wallet", None).await;
    assert_eq!(status, 200);
    assert_eq!(wallet["bits_balance"], 75);

    let (status, profile) =
        send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200);
    assert_eq!(profile["career"]["xp"], 115, "duplicate granted no XP");
    let hero_xp = profile["heroes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|hero| hero["hero_id"] == "security_engineer")
        .unwrap()["xp"]
        .clone();
    assert_eq!(hero_xp, 35);
}

#[tokio::test]
async fn campaign_replay_does_not_repeat_first_clear_bonus() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("replay");

    let first = json!({
        "result_id": Uuid::new_v4(),
        "stars": 1,
        "health": 12,
        "duration_ms": 90_000,
        "hero_id": null,
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(first),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let first_bits = body["reward"]["bits"].as_i64().unwrap();
    assert!(first_bits > 0);

    let replay = json!({
        "result_id": Uuid::new_v4(),
        "stars": 3,
        "health": 95,
        "duration_ms": 90_000,
        "hero_id": null,
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(replay),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["reward"]["bits"], 0, "replay grants no Bits");
    assert_eq!(body["reward"]["hero_xp"], 0, "no hero named, no hero XP");
    assert_eq!(body["campaign"]["best_stars"], 3, "best stars improve");
    assert_eq!(body["campaign"]["best_health"], 95);
    assert_eq!(body["campaign"]["first_clear_reward_settled"], true);
}

#[tokio::test]
async fn campaign_rejects_unknown_mission_and_bad_stars() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("reject");

    let unknown = json!({
        "result_id": Uuid::new_v4(),
        "stars": 3,
        "health": 50,
        "duration_ms": 60_000,
        "hero_id": null,
    });
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/not-a-mission/complete",
        Some(unknown),
    )
    .await;
    assert_eq!(status, 400);

    let bad_stars = json!({
        "result_id": Uuid::new_v4(),
        "stars": 5,
        "health": 50,
        "duration_ms": 60_000,
        "hero_id": null,
    });
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(bad_stars),
    )
    .await;
    assert_eq!(status, 400);

    let bad_duration = json!({
        "result_id": Uuid::new_v4(),
        "stars": 1,
        "health": 50,
        "duration_ms": 10,
        "hero_id": null,
    });
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(bad_duration),
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn campaign_progress_is_isolated_per_user() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let owner = subject("owner");
    let other = subject("other");

    let payload = json!({
        "result_id": Uuid::new_v4(),
        "stars": 3,
        "health": 70,
        "duration_ms": 60_000,
        "hero_id": null,
    });
    let (status, _) = send_as(
        app.clone(),
        &owner,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200);

    let (status, profile) = send_as(
        app.clone(),
        &other,
        "GET",
        "/v1/cyber-defense/profile",
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(profile["campaign"].as_array().unwrap().len(), 0);
    assert_eq!(profile["bits_balance"], 0);
    assert_eq!(profile["career"]["xp"], 0);
}

#[tokio::test]
async fn tower_purchase_spends_bits_and_is_idempotent() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("tower-buy");
    let (status, _) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200);
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 100).await;

    let event_id = Uuid::new_v4();
    let body = json!({ "event_id": event_id });
    let (status, response) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/soc",
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, 200, "{response}");
    assert_eq!(response["spent"], 40);
    assert_eq!(response["level"], 1);
    assert_eq!(response["tower_level"], 2);
    assert_eq!(response["bits_balance"], 60);
    assert_eq!(response["newly_settled"], true);

    // A retry with the same idempotency key settles nothing.
    let (status, response) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/soc",
        Some(body),
    )
    .await;
    assert_eq!(status, 200, "{response}");
    assert_eq!(response["newly_settled"], false);
    assert_eq!(response["bits_balance"], 60);

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    let soc = profile["tower_upgrades"]
        .as_array()
        .unwrap()
        .iter()
        .find(|room| room["upgrade_id"] == "soc")
        .unwrap();
    assert_eq!(soc["level"], 1);
    assert_eq!(soc["next_cost"], 90);
}

#[tokio::test]
async fn tower_purchase_rejects_insufficient_bits_and_prerequisites() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("tower-reject");
    send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    let uid = user_id(&pool, &user).await;

    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/soc",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 409, "an empty wallet cannot afford a purchase");

    fund(&pool, uid, 1_000).await;
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/engineering_lab",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 409, "prerequisite not met: {body}");

    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/not-a-room",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn tower_purchase_stops_at_max_level() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("tower-max");
    send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 1_000).await;

    for expected_level in 1..=4 {
        let (status, body) = send_as(
            app.clone(),
            &user,
            "POST",
            "/v1/cyber-defense/tower/upgrades/soc",
            Some(json!({ "event_id": Uuid::new_v4() })),
        )
        .await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["level"], expected_level);
    }
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/soc",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 409, "level 4 is the cap");
}

#[tokio::test]
async fn tower_purchases_are_isolated_per_user() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let owner = subject("tower-owner");
    let other = subject("tower-other");
    send_as(
        app.clone(),
        &owner,
        "GET",
        "/v1/cyber-defense/profile",
        None,
    )
    .await;
    send_as(
        app.clone(),
        &other,
        "GET",
        "/v1/cyber-defense/profile",
        None,
    )
    .await;
    fund(&pool, user_id(&pool, &owner).await, 200).await;

    let (status, _) = send_as(
        app.clone(),
        &owner,
        "POST",
        "/v1/cyber-defense/tower/upgrades/soc",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 200);

    let (_, profile) = send_as(
        app.clone(),
        &other,
        "GET",
        "/v1/cyber-defense/profile",
        None,
    )
    .await;
    assert_eq!(profile["tower_level"], 1, "the other user is unaffected");
}

#[tokio::test]
async fn hero_talents_require_unlock_and_validate_choices() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("hero-talents");
    send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    let uid = user_id(&pool, &user).await;

    // A fresh hero is level 1, so the level-5 milestone is locked.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/heroes/security_engineer/talents",
        Some(json!({ "talents": { "5": "rapid_response" } })),
    )
    .await;
    assert_eq!(status, 409);

    // Unlock level 5 by awarding hero XP directly.
    let mut conn = pool.acquire().await.expect("acquire");
    db::cyber_defense::increment_hero_xp(
        &mut conn,
        uid,
        "security_engineer",
        xp_for_hero_level(5).unwrap(),
    )
    .await
    .expect("grant hero xp");
    drop(conn);

    let (status, _) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/heroes/security_engineer/talents",
        Some(json!({ "talents": { "5": "not_a_talent" } })),
    )
    .await;
    assert_eq!(status, 400);

    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/heroes/security_engineer/talents",
        Some(json!({ "talents": { "5": "rapid_response" } })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["selected_talents"]["5"], "rapid_response");
    assert_eq!(body["level"], 5);

    // Respec replaces the choice cleanly.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/heroes/security_engineer/talents",
        Some(json!({ "talents": { "5": "deep_hardening" } })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["selected_talents"]["5"], "deep_hardening");

    let (status, _) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/heroes/not-a-hero/talents",
        Some(json!({ "talents": {} })),
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn operation_start_read_complete_flow() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("operation-flow");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2, "hero_id": "security_engineer" })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let run_id = body["run_id"].as_str().unwrap().to_owned();
    let seed = body["seed"].clone();
    assert_eq!(body["status"], "active");
    // Run-start progression is frozen into the immutable Operation.
    assert_eq!(
        body["operation"]["progression_snapshot"]["tower"]["soc_level"],
        0
    );
    assert_eq!(
        body["operation"]["progression_snapshot"]["hero"]["hero_id"],
        "security_engineer"
    );
    assert_eq!(body["threat_level"], 2);
    assert_eq!(body["operation"]["threat_level"], 2);
    assert!(body["operation"]["waves"].as_array().unwrap().len() >= 3);

    // A second start while one is active is a conflict carrying the run id.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["error"]["code"], "active_operation_exists");
    assert_eq!(body["error"]["active_run_id"], run_id);

    // Read restores the exact run.
    let (status, read) = send_as(
        app.clone(),
        &user,
        "GET",
        &format!("/v1/cyber-defense/operations/{run_id}"),
        None,
    )
    .await;
    assert_eq!(status, 200, "{read}");
    assert_eq!(read["seed"], seed);

    // A run cannot settle the instant it is created.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 3, "health": 90, "duration_ms": 120_000 })),
    )
    .await;
    assert_eq!(status, 400, "{body}");

    // Age the run, then complete; rewards settle.
    backdate_run(&pool, run_uuid(&run_id), 600).await;
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 3, "health": 90, "duration_ms": 120_000 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["newly_settled"], true);
    assert!(body["reward"]["bits"].as_i64().unwrap() > 0);
    assert!(body["bits_balance"].as_i64().unwrap() > 0);
    assert_eq!(body["run"]["status"], "completed");
    assert_eq!(body["adversary"]["victories"], 1);

    // A duplicate completion settles nothing.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 3, "health": 90, "duration_ms": 120_000 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["newly_settled"], false);
    assert_eq!(body["reward"]["bits"], 0);
}

#[tokio::test]
async fn operation_cannot_be_read_or_settled_by_another_user() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let owner = subject("operation-owner");
    let other = subject("operation-other");
    ensure_operations_unlocked(app.clone(), &pool, &owner).await;

    let (status, body) = send_as(
        app.clone(),
        &owner,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 1 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let run_id = body["run_id"].as_str().unwrap().to_owned();

    let (status, _) = send_as(
        app.clone(),
        &other,
        "GET",
        &format!("/v1/cyber-defense/operations/{run_id}"),
        None,
    )
    .await;
    assert_eq!(status, 404);

    let (status, _) = send_as(
        app.clone(),
        &other,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 1, "health": 10, "duration_ms": 60_000 })),
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn operation_abandon_grants_no_reward() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("operation-abandon");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let run_id = body["run_id"].as_str().unwrap().to_owned();

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/abandon"),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "abandoned");

    // An abandoned run cannot later be completed.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 3, "health": 90, "duration_ms": 120_000 })),
    )
    .await;
    assert_eq!(status, 200, "a duplicate-style response, no reward");

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["bits_balance"], 0);
    assert_eq!(profile["total_operations_completed"], 0);
}

#[tokio::test]
async fn operation_rejects_locked_threat_and_malformed_result() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("operation-reject");

    // A brand-new player cannot start Threat 10.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 10 })),
    )
    .await;
    assert_eq!(status, 400);

    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 3 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let run_id = body["run_id"].as_str().unwrap().to_owned();

    // A completed operation needs at least one star.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 0, "health": 10, "duration_ms": 60_000 })),
    )
    .await;
    assert_eq!(status, 400);

    // An absurd duration is rejected.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 2, "health": 10, "duration_ms": 1 })),
    )
    .await;
    assert_eq!(status, 400);

    // A failure cannot earn stars.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": false, "stars": 2, "health": 0, "duration_ms": 60_000 })),
    )
    .await;
    assert_eq!(status, 400);

    // A claimed duration that outruns the server wall clock is rejected.
    backdate_run(&pool, run_uuid(&run_id), 60).await;
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 2, "health": 10, "duration_ms": 10_000_000 })),
    )
    .await;
    assert_eq!(status, 400, "{body}");

    // A valid failure settles with no Bits.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": false, "stars": 0, "health": 0, "duration_ms": 60_000 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["reward"]["bits"], 0);
    assert_eq!(body["bits_balance"], 0);
    assert!(body["reward"]["career_xp"].as_i64().unwrap() > 0);
}

#[tokio::test]
async fn campaign_boss_clear_unlocks_operation_story() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("story-unlock");

    // Settle the campaign in the canonical order; the boss cannot be first.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/botnet-boss/complete",
        Some(json!({
            "result_id": Uuid::new_v4(),
            "stars": 3,
            "health": 70,
            "duration_ms": 90_000,
            "hero_id": null,
        })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_campaign_mission_locked");

    for mission_id in [
        "ddos-basics",
        "sql-injection",
        "credential-stuffing",
        "mixed-defense",
    ] {
        let (status, settled) = send_as(
            app.clone(),
            &user,
            "POST",
            &format!("/v1/cyber-defense/campaign/{mission_id}/complete"),
            Some(json!({
                "result_id": Uuid::new_v4(),
                "stars": 3,
                "health": 80,
                "duration_ms": 90_000,
                "hero_id": null,
            })),
        )
        .await;
        assert_eq!(status, 200, "{settled}");
    }
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/botnet-boss/complete",
        Some(json!({
            "result_id": Uuid::new_v4(),
            "stars": 3,
            "health": 70,
            "duration_ms": 90_000,
            "hero_id": null,
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let story = body["story_nodes_completed"].as_array().unwrap();
    assert!(
        story.iter().any(|node| node == "chapter-1-complete"),
        "{body}"
    );

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert!(
        profile["story"]["completed_nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node == "chapter-1-complete")
    );
}

#[tokio::test]
async fn legacy_import_is_one_time_and_grants_no_bits() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("legacy");

    let payload = json!({
        "missions": {
            "ddos-basics": { "completed": true, "stars": 3, "best_health": 80, "attempts": 2 },
            "unknown-mission": { "completed": true, "stars": 3, "best_health": 80, "attempts": 2 }
        }
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["imported"], true);
    assert_eq!(body["missions_imported"], 1);
    assert_eq!(body["career_xp_granted"], 50);
    assert_eq!(body["bits_balance"], 0, "import grants no Bits");

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["legacy_progress_imported"], true);
    assert_eq!(profile["campaign"].as_array().unwrap().len(), 1);
    assert_eq!(profile["career"]["xp"], 50);

    // A second import is a no-op.
    let payload = json!({
        "missions": {
            "ddos-basics": { "completed": true, "stars": 3, "best_health": 80, "attempts": 2 }
        }
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["imported"], false);
    assert_eq!(body["career_xp_granted"], 0);

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["career"]["xp"], 50, "no XP granted twice");
}

#[tokio::test]
async fn legacy_import_clamps_values_and_marks_empty_complete() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("legacy-empty");

    // Only a contiguous prefix is imported, so sql-injection needs the earlier
    // ddos-basics entry to be accepted.
    let payload = json!({
        "missions": {
            "ddos-basics": { "completed": true, "stars": 3, "best_health": 80, "attempts": 1 },
            "sql-injection": { "completed": true, "stars": 9, "best_health": -5, "attempts": -3 }
        }
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["imported"], true);
    assert_eq!(body["missions_imported"], 2);

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    let result = profile["campaign"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["mission_id"] == "sql-injection")
        .unwrap();
    assert_eq!(result["best_stars"], 3, "stars are clamped");
    assert_eq!(result["best_health"], 0, "negative health is clamped");

    // A different user with empty progress still marks the migration complete.
    let other = subject("legacy-other");
    let (status, body) = send_as(
        app.clone(),
        &other,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(json!({ "missions": {} })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["imported"], true);
    assert_eq!(body["career_xp_granted"], 0);
}

#[tokio::test]
async fn legacy_import_requires_a_contiguous_prefix_and_grants_no_first_clear() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let skips = subject("legacy-skip");

    // Claiming only the boss imports nothing and cannot unlock Operations.
    let (status, body) = send_as(
        app.clone(),
        &skips,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(json!({
            "missions": {
                "botnet-boss": { "completed": true, "stars": 3, "best_health": 90, "attempts": 1 }
            }
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["missions_imported"], 0);
    assert_eq!(body["career_xp_granted"], 0, "no valid completion imported");

    let (_, profile) = send_as(
        app.clone(),
        &skips,
        "GET",
        "/v1/cyber-defense/profile",
        None,
    )
    .await;
    assert_eq!(profile["operations_unlocked"], false);
    assert_eq!(profile["campaign"].as_array().unwrap().len(), 0);

    // A contiguous, fully-completed chain imports and unlocks Operations, but
    // the imported completion can never claim a first-clear reward.
    let full = subject("legacy-full");
    let missions: serde_json::Map<String, serde_json::Value> = [
        "ddos-basics",
        "sql-injection",
        "credential-stuffing",
        "mixed-defense",
        "botnet-boss",
    ]
    .iter()
    .map(|id| {
        (
            (*id).to_owned(),
            json!({ "completed": true, "stars": 3, "best_health": 90, "attempts": 1 }),
        )
    })
    .collect();
    let (status, body) = send_as(
        app.clone(),
        &full,
        "POST",
        "/v1/cyber-defense/legacy-progress",
        Some(json!({ "missions": missions })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["missions_imported"], 5);
    assert_eq!(body["career_xp_granted"], 50);

    let (_, profile) = send_as(app.clone(), &full, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["operations_unlocked"], true);
    assert_eq!(profile["bits_balance"], 0);

    // Settling an imported mission is a replay: no first-clear Bits.
    let (status, body) = send_as(
        app.clone(),
        &full,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(json!({
            "result_id": Uuid::new_v4(),
            "stars": 3,
            "health": 95,
            "duration_ms": 90_000,
            "hero_id": null,
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["reward"]["bits"], 0,
        "imported completion is not first clear"
    );
}

#[tokio::test]
async fn telemetry_accepts_known_events_and_rejects_unknown() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("telemetry");

    let payload = json!({
        "events": [
            { "name": "cyber_dashboard_view" },
            { "name": "cyber_operation_started", "threat_level": 3, "stars": null }
        ]
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/telemetry",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["accepted"], 2);

    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/telemetry",
        Some(json!({ "events": [{ "name": "not_a_real_event" }] })),
    )
    .await;
    assert_eq!(status, 400);

    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/telemetry",
        Some(json!({ "events": [{ "name": "cyber_dashboard_view", "threat_level": 99 }] })),
    )
    .await;
    assert_eq!(status, 400);

    // Telemetry requires authentication.
    let (status, _) = send_anonymous(
        app.clone(),
        "POST",
        "/v1/cyber-defense/telemetry",
        Some(json!({ "events": [] })),
    )
    .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn operations_are_locked_until_chapter_one_is_complete() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("ops-lock");

    // The server rejects an Operation before the campaign boss, regardless of UI.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_operations_locked");

    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
}

#[tokio::test]
async fn first_operation_uses_ghost7_and_gates_other_adversaries() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("adversary-gate");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["operations_unlocked"], true);
    assert_eq!(profile["confrontation_available"], false);
    let available: Vec<&str> = profile["available_adversaries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    assert_eq!(available, vec!["ghost-7"]);

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["adversary_id"], "ghost-7");
    let run_id = body["run_id"].as_str().unwrap().to_owned();

    // Abandon so a fresh selection can be made.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/abandon"),
        None,
    )
    .await;
    assert_eq!(status, 200);

    // Offers only contain templates whose adversary is currently unlocked.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations/offers",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let offers = body["offers"].as_array().expect("offers");
    assert!(!offers.is_empty());
    for offer in offers {
        assert_eq!(offer["adversary_id"], "ghost-7", "{body}");
    }
    // A template whose only adversary is locked is never offered.
    assert!(
        !offers
            .iter()
            .any(|offer| offer["template_id"] == "recovery-crisis"),
        "{body}"
    );

    // Ordinary templates cannot be pinned directly; only offers may start them.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2, "template_id": "recovery-crisis" })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
}

#[tokio::test]
async fn confrontation_operation_requires_story_and_rank() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("confrontation");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({
            "requested_threat_level": 2,
            "template_id": "ghost7-confrontation",
        })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_operation_locked");
}

#[tokio::test]
async fn operation_rejects_an_unknown_hero() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("bad-hero");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 2, "hero_id": "oracle" })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
}

#[tokio::test]
async fn confrontation_battle_completes_the_climax_story() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("climax");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;
    let uid = user_id(&pool, &user).await;

    // Reaching the story milestone and GHOST-7 rank must not complete the
    // climax by itself.
    let mut tx = pool.begin().await.expect("begin setup");
    for node in [
        "chapter-1-complete",
        "chapter-2-ghost7",
        "chapter-2-clue",
        "chapter-3-null",
        "chapter-3-viper",
        "chapter-4-biolab",
    ] {
        db::cyber_defense::record_story_progress(&mut tx, uid, node)
            .await
            .expect("record story");
    }
    db::cyber_defense::apply_adversary_encounter(&mut tx, uid, "ghost-7", 200, true, true, 5)
        .await
        .expect("adversary progress");
    tx.commit().await.expect("commit setup");

    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["confrontation_available"], true);
    let nodes: Vec<&str> = profile["story"]["completed_nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node.as_str().unwrap())
        .collect();
    assert!(
        !nodes.contains(&"chapter-5-climax"),
        "the climax must require a battle, not just a rank"
    );

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({
            "requested_threat_level": 3,
            "template_id": "ghost7-confrontation",
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["template_id"], "ghost7-confrontation");
    let run_id = body["run_id"].as_str().unwrap().to_owned();
    backdate_run(&pool, run_uuid(&run_id), 600).await;

    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({
            "completed": true,
            "stars": 3,
            "health": 100,
            "duration_ms": 200_000,
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let completed: Vec<&str> = body["story_nodes_completed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node.as_str().unwrap())
        .collect();
    assert!(completed.contains(&"chapter-5-climax"), "{body}");
    assert!(completed.contains(&"chapter-5-hook"), "{body}");
}

#[tokio::test]
async fn engineering_lab_validates_and_applies_loadout_swaps() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("engineering-lab");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 800).await;

    // Without the room, substitutions are rejected.
    let run_a = start_operation(app.clone(), &user, 2).await;
    let (status, _) = send_as(
        app.clone(),
        &user,
        "PUT",
        &format!("/v1/cyber-defense/operations/{run_a}/loadout"),
        Some(json!({ "defense_swaps": [{ "remove": "rate_limiter", "add": "monitoring" }] })),
    )
    .await;
    assert_eq!(status, 400);
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_a}/abandon"),
        None,
    )
    .await;
    assert_eq!(status, 200);

    // Buy SOC 2 (prerequisite) and the Engineering Lab Lv1.
    for _ in 0..2 {
        let (status, body) = send_as(
            app.clone(),
            &user,
            "POST",
            "/v1/cyber-defense/tower/upgrades/soc",
            Some(json!({ "event_id": Uuid::new_v4() })),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/engineering_lab",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 200, "{body}");

    // A run created now freezes Engineering Lab Lv1 in its snapshot.
    let run_id = start_operation(app.clone(), &user, 2).await;

    // Removing the only required counter must be rejected as unsolvable.
    let (status, _) = send_as(
        app.clone(),
        &user,
        "PUT",
        &format!("/v1/cyber-defense/operations/{run_id}/loadout"),
        Some(json!({ "defense_swaps": [{ "remove": "mfa", "add": "monitoring" }] })),
    )
    .await;
    assert_eq!(status, 400);

    // A safe swap is applied to the persisted run.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        &format!("/v1/cyber-defense/operations/{run_id}/loadout"),
        Some(
            json!({ "defense_swaps": [{ "remove": "traffic_blocker", "add": "xss_protection" }] }),
        ),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["operation"]["progression_snapshot"]["tower"]["engineering_lab_level"],
        1
    );
    let defenses: Vec<&str> = body["operation"]["available_defenses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    assert!(defenses.contains(&"xss_protection"));
    assert!(!defenses.contains(&"traffic_blocker"));
    assert!(defenses.contains(&"mfa"), "required counter remains");

    // The change survives a re-read.
    let (_, read) = send_as(
        app.clone(),
        &user,
        "GET",
        &format!("/v1/cyber-defense/operations/{run_id}"),
        None,
    )
    .await;
    assert!(
        read["operation"]["available_defenses"]
            .as_array()
            .unwrap()
            .iter()
            .any(|id| id == "xss_protection")
    );

    // Upgrading the Lab to Lv2 after the run started must not widen that run's
    // allowance: the snapshot still says Lv1, so two swaps are rejected.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/tower/upgrades/engineering_lab",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        &format!("/v1/cyber-defense/operations/{run_id}/loadout"),
        Some(json!({ "defense_swaps": [
            { "remove": "xss_protection", "add": "monitoring" },
            { "remove": "rate_limiter", "add": "traffic_analyzer" },
        ] })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
}

#[tokio::test]
async fn training_center_bonus_boosts_hero_xp_only() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("training-bonus");

    let (status, _) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200);
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 500).await;

    // Two purchases take the Training Center to level 2 (+10% hero XP).
    for _ in 0..2 {
        let (status, body) = send_as(
            app.clone(),
            &user,
            "POST",
            "/v1/cyber-defense/tower/upgrades/training_center",
            Some(json!({ "event_id": Uuid::new_v4() })),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }

    let payload = json!({
        "result_id": Uuid::new_v4(),
        "stars": 3,
        "health": 80,
        "duration_ms": 60_000,
        "hero_id": "security_engineer",
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/ddos-basics/complete",
        Some(payload),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // Base first-clear hero XP is 35; +10% rounds to 39.
    assert_eq!(body["reward"]["hero_xp"], 39);
    // Bits and career XP are unaffected by the Training Center.
    assert_eq!(body["reward"]["bits"], 75);
    assert_eq!(body["reward"]["career_xp"], 115);
}

#[tokio::test]
async fn campaign_missions_unlock_one_step_at_a_time() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("campaign-order");

    let settle = |mission: &'static str, result: Uuid| {
        let app = app.clone();
        let user = user.clone();
        async move {
            send_as(
                app,
                &user,
                "POST",
                &format!("/v1/cyber-defense/campaign/{mission}/complete"),
                Some(json!({
                    "result_id": result,
                    "stars": 3,
                    "health": 80,
                    "duration_ms": 90_000,
                    "hero_id": null,
                })),
            )
            .await
        }
    };

    // Nothing before the first mission.
    let (status, body) = settle("sql-injection", Uuid::new_v4()).await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_campaign_mission_locked");

    let (status, body) = settle("ddos-basics", Uuid::new_v4()).await;
    assert_eq!(status, 200, "{body}");

    let (status, body) = settle("credential-stuffing", Uuid::new_v4()).await;
    assert_eq!(status, 403, "{body}");

    let (status, body) = settle("sql-injection", Uuid::new_v4()).await;
    assert_eq!(status, 200, "{body}");

    // Operations stay locked until the final mission is legitimately cleared.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({ "requested_threat_level": 1 })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_operations_locked");
}

#[tokio::test]
async fn operation_offers_are_stable_and_start_the_offered_template() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("offers");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;

    let (status, first) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations/offers",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    assert_eq!(status, 200, "{first}");
    let offers = first["offers"].as_array().expect("offers");
    assert!(!offers.is_empty() && offers.len() <= 3, "{first}");
    assert_eq!(first["preview_threat_level"], 2);

    // A second request reuses the same offers, so the UI never reshuffles.
    let (_, second) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations/offers",
        Some(json!({ "requested_threat_level": 2 })),
    )
    .await;
    let ids: Vec<&str> = offers
        .iter()
        .map(|offer| offer["offer_id"].as_str().unwrap())
        .collect();
    let second_ids: Vec<&str> = second["offers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|offer| offer["offer_id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, second_ids);

    let chosen = &offers[0];
    let offer_id = chosen["offer_id"].as_str().unwrap();
    let template_id = chosen["template_id"].as_str().unwrap().to_owned();
    let adversary_id = chosen["adversary_id"].as_str().unwrap().to_owned();
    assert!(chosen["estimated_minutes"].as_i64().unwrap() >= 3);

    let (status, run) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({
            "requested_threat_level": 2,
            "hero_id": "sre",
            "offer_id": offer_id,
        })),
    )
    .await;
    assert_eq!(status, 200, "{run}");
    assert_eq!(run["template_id"], template_id);
    assert_eq!(run["adversary_id"], adversary_id);
    assert_eq!(run["hero_id"], "sre");

    // Abandon, then an unknown offer id is rejected.
    let run_id = run["run_id"].as_str().unwrap();
    let (status, _) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/abandon"),
        None,
    )
    .await;
    assert_eq!(status, 200);
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations",
        Some(json!({
            "requested_threat_level": 2,
            "offer_id": Uuid::new_v4(),
        })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
}

#[tokio::test]
async fn operation_offers_require_a_completed_campaign() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("offers-locked");
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/operations/offers",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["error"]["code"], "cyber_operations_locked");
}

#[tokio::test]
async fn run_snapshot_freezes_soc_and_training_center() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("snapshot-freeze");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 1000).await;

    // Start at SOC 0 / Training Center 0.
    let run_id = start_operation(app.clone(), &user, 2).await;

    // Upgrade both rooms after the run started.
    for _ in 0..4 {
        let (status, body) = send_as(
            app.clone(),
            &user,
            "POST",
            "/v1/cyber-defense/tower/upgrades/soc",
            Some(json!({ "event_id": Uuid::new_v4() })),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }
    for _ in 0..2 {
        let (status, body) = send_as(
            app.clone(),
            &user,
            "POST",
            "/v1/cyber-defense/tower/upgrades/training_center",
            Some(json!({ "event_id": Uuid::new_v4() })),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }

    // The run still reports its pre-upgrade snapshot.
    let (_, run) = send_as(
        app.clone(),
        &user,
        "GET",
        &format!("/v1/cyber-defense/operations/{run_id}"),
        None,
    )
    .await;
    assert_eq!(
        run["operation"]["progression_snapshot"]["tower"]["soc_level"],
        0
    );
    assert_eq!(
        run["operation"]["progression_snapshot"]["tower"]["training_center_level"],
        0
    );

    // And the settlement uses the frozen Training Center level (base hero XP).
    backdate_run(&pool, run_uuid(&run_id), 600).await;
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": false, "stars": 0, "health": 0, "duration_ms": 60_000 })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // Base failed-run hero XP is 5; a Training Center Lv2 multiplier would
    // round it to 6. The frozen snapshot keeps it at 5.
    assert_eq!(body["reward"]["hero_xp"], 5);
}

#[tokio::test]
async fn cosmetics_purchase_equip_and_persist() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("cosmetics");
    let (status, _) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(status, 200);
    let uid = user_id(&pool, &user).await;
    fund(&pool, uid, 200).await;

    let event = Uuid::new_v4();
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/cosmetics/neon-blue/purchase",
        Some(json!({ "event_id": event })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["spent"], 180);
    assert_eq!(body["newly_settled"], true);
    assert_eq!(body["state"]["bits_balance"], 20);

    // A duplicate event settles nothing.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/cosmetics/neon-blue/purchase",
        Some(json!({ "event_id": event })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["newly_settled"], false);
    assert_eq!(body["spent"], 0);
    assert_eq!(body["state"]["bits_balance"], 20);

    // A fresh event for an owned cosmetic is a no-op, not a double charge.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/cosmetics/neon-blue/purchase",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["spent"], 0);
    assert_eq!(body["state"]["bits_balance"], 20);

    // Equip it, and confirm it persists on the profile.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/cosmetics/equipped",
        Some(json!({ "theme_id": "neon-blue" })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["equipped_theme"], "neon-blue");
    let (_, profile) = send_as(app.clone(), &user, "GET", "/v1/cyber-defense/profile", None).await;
    assert_eq!(profile["equipped_theme"], "neon-blue");
    let owned = profile["cosmetics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["cosmetic_id"] == "neon-blue")
        .unwrap();
    assert_eq!(owned["owned"], true);
    assert_eq!(owned["equipped"], true);

    // Equipping a cosmetic you do not own is rejected.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "PUT",
        "/v1/cyber-defense/cosmetics/equipped",
        Some(json!({ "theme_id": "red-alert" })),
    )
    .await;
    assert_eq!(status, 400, "{body}");

    // Insufficient Bits are rejected.
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/cosmetics/red-alert/purchase",
        Some(json!({ "event_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, 409, "{body}");

    // A cosmetic has no gameplay effect: the aggregate Tower level is unchanged.
    assert_eq!(profile["tower_level"], 1);
}

#[tokio::test]
async fn settlement_rate_guard_blocks_impossible_frequency() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool.clone());
    let user = subject("rate-guard");
    ensure_operations_unlocked(app.clone(), &pool, &user).await;
    let uid = user_id(&pool, &user).await;

    // Seed more than the per-window ceiling of already-settled runs.
    {
        let mut conn = pool.acquire().await.expect("acquire");
        for _ in 0..31 {
            sqlx::query(
                "INSERT INTO cyber_operation_runs
                     (id, user_id, seed, template_id, adversary_id, hero_id, threat_level,
                      status, generated_config, completed_at, duration_ms)
                 VALUES ($1, $2, 1, 'identity-breach', 'ghost-7', NULL, 1,
                         'completed', '{}'::jsonb, now(), 60000)",
            )
            .bind(Uuid::new_v4())
            .bind(uid)
            .execute(&mut *conn)
            .await
            .expect("seed run");
        }
    }

    let run_id = start_operation(app.clone(), &user, 1).await;
    backdate_run(&pool, run_uuid(&run_id), 600).await;
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        &format!("/v1/cyber-defense/operations/{run_id}/complete"),
        Some(json!({ "completed": true, "stars": 3, "health": 90, "duration_ms": 120_000 })),
    )
    .await;
    assert_eq!(status, 409, "{body}");
}

#[tokio::test]
async fn legacy_temporary_upgrade_route_is_removed() {
    let Some(pool) = database_pool().await else {
        return;
    };
    let app = app_with_pool(pool);
    let user = subject("legacy-route");
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(json!({
            "event_id": Uuid::new_v4(),
            "run_id": Uuid::new_v4(),
            "defense_id": "waf",
            "from_level": 1,
        })),
    )
    .await;
    assert_ne!(status, 200, "{body}");
    assert_eq!(status, 404, "{body}");
}
