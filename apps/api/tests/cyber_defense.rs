//! Integration tests for server-authoritative Cyber Defense spending.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

mod common;

use adaptive_learn_db as db;
use axum::http::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

async fn user_id_for(pool: &db::PgPool, subject: &str) -> Uuid {
    db::users::find_by_auth_subject(pool, "workos", subject)
        .await
        .expect("lookup user")
        .expect("user exists")
        .id
}

/// Credits a wallet through the reward path so a spend starts from a real
/// settled balance.
async fn fund(pool: &db::PgPool, user_id: Uuid, amount: i64) {
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

async fn cleanup(pool: &db::PgPool, user_id: Uuid) {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("delete user");
}

fn upgrade_body(defense_id: &str, event_id: Uuid, run_id: Uuid, from_level: i32) -> Value {
    json!({
        "event_id": event_id,
        "run_id": run_id,
        "defense_id": defense_id,
        "from_level": from_level,
    })
}

#[tokio::test]
async fn anonymous_spend_is_rejected() {
    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body(
            "traffic_blocker",
            Uuid::new_v4(),
            Uuid::new_v4(),
            1,
        )),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn spend_debits_once_and_a_retry_is_idempotent() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    // The first authenticated call upserts the account.
    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    fund(&pool, user_id, 40).await;

    let event_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("traffic_blocker", event_id, run_id, 1)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bits_balance"], 25);
    assert_eq!(body["spent"], 15);
    assert_eq!(body["newly_settled"], true);

    // The same idempotency key must not debit twice.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("traffic_blocker", event_id, run_id, 1)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bits_balance"], 25);
    assert_eq!(body["newly_settled"], false);

    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        25,
        "the wallet was debited exactly once"
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn spend_beyond_the_balance_is_rejected_without_debiting() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;

    // No funding: the wallet is empty.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body(
            "traffic_blocker",
            Uuid::new_v4(),
            Uuid::new_v4(),
            1,
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "insufficient_bits");
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        0
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn an_out_of_sequence_upgrade_level_is_rejected() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    fund(&pool, user_id, 40).await;

    // Nothing has settled for this run/control, so the server derives level 1.
    // A client claiming a different level is rejected without debiting.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body(
            "traffic_blocker",
            Uuid::new_v4(),
            Uuid::new_v4(),
            99,
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "conflict");
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        40,
        "an out-of-sequence upgrade never debits"
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn a_second_upgrade_costs_the_second_tier() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    fund(&pool, user_id, 100).await;

    let run_id = Uuid::new_v4();
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("traffic_blocker", Uuid::new_v4(), run_id, 1)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["spent"], 15);
    assert_eq!(body["bits_balance"], 85);

    // The server derives level 2 from the first settled upgrade, so the second
    // upgrade of the same control in the same run costs the second tier.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("traffic_blocker", Uuid::new_v4(), run_id, 2)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["spent"], 25);
    assert_eq!(body["bits_balance"], 60);
    assert_eq!(body["newly_settled"], true);

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn a_reused_event_id_for_a_different_control_is_rejected() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    fund(&pool, user_id, 100).await;

    let run_id = Uuid::new_v4();
    let event_id = Uuid::new_v4();
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("traffic_blocker", event_id, run_id, 1)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The same key for a different control must not settle as an idempotent
    // retry; otherwise the debit could be skipped.
    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body("waf", event_id, run_id, 1)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "conflict");
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        85,
        "the reused key must not debit again"
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn a_reward_event_id_cannot_settle_an_upgrade() {
    let Some(pool) = common::database_pool().await else {
        return;
    };
    let subject = format!("cyber-{}", Uuid::new_v4());
    let app = common::app_with_pool(pool.clone());

    let (status, _) = common::send_as(app.clone(), &subject, "GET", "/v1/wallet", None).await;
    assert_eq!(status, StatusCode::OK);
    let user_id = user_id_for(&pool, &subject).await;
    fund(&pool, user_id, 100).await;

    // Rewards and spends share the `event_id` namespace. A reward id returned to
    // the client must not be accepted as an already-settled debit.
    let reward_event_id = Uuid::new_v4();
    let mut tx = pool.begin().await.expect("begin reward");
    let reward = db::wallets::BitTransaction {
        user_id,
        device_id: None,
        event_id: reward_event_id,
        mission_instance_id: Uuid::new_v4(),
        question_id: "first_attempt_question".to_owned(),
        amount: 10,
        reason: "first_attempt".to_owned(),
    };
    db::wallets::settle(&mut tx, &reward)
        .await
        .expect("settle reward");
    tx.commit().await.expect("commit reward");

    let (status, body) = common::send_as(
        app.clone(),
        &subject,
        "POST",
        "/v1/cyber-defense/upgrades",
        Some(upgrade_body(
            "traffic_blocker",
            reward_event_id,
            Uuid::new_v4(),
            1,
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "conflict");
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.expect("balance"),
        110,
        "the reward is untouched and no debit is written"
    );

    cleanup(&pool, user_id).await;
}
