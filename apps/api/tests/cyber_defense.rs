//! Integration tests for the Cyber Defense Stage 2 profile and campaign rewards.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_db as db;
use adaptive_learn_domain::xp_for_hero_level;
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
        "/v1/cyber-defense/campaign/sql-injection/complete",
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
        "/v1/cyber-defense/campaign/sql-injection/complete",
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
        "/v1/cyber-defense/campaign/mixed-defense/complete",
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
    let app = app_with_pool(pool);
    let user = subject("operation-flow");

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

    // Complete settles rewards.
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
    let app = app_with_pool(pool);
    let owner = subject("operation-owner");
    let other = subject("operation-other");

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
    let app = app_with_pool(pool);
    let user = subject("operation-abandon");

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
    let app = app_with_pool(pool);
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

    let payload = json!({
        "result_id": Uuid::new_v4(),
        "stars": 3,
        "health": 70,
        "duration_ms": 90_000,
        "hero_id": null,
    });
    let (status, body) = send_as(
        app.clone(),
        &user,
        "POST",
        "/v1/cyber-defense/campaign/botnet-boss/complete",
        Some(payload),
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

    let payload = json!({
        "missions": {
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
