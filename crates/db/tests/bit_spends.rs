//! Integration tests for the server-authoritative Bits spend ledger.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

use adaptive_learn_db as db;
use adaptive_learn_domain::NewUser;
use db::PgPool;
use uuid::Uuid;

fn database_url() -> Option<String> {
    match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => Some(url),
        _ => {
            assert_ne!(
                std::env::var("REQUIRE_DB_TESTS").as_deref(),
                Ok("1"),
                "DATABASE_URL must be set when REQUIRE_DB_TESTS=1"
            );
            eprintln!("skipping database test: DATABASE_URL is not set");
            None
        }
    }
}

async fn pool() -> Option<PgPool> {
    let url = database_url()?;
    let pool = db::connect(&url, 4).await.expect("connect to database");
    db::MIGRATOR.run(&pool).await.expect("apply migrations");
    Some(pool)
}

async fn insert_user(pool: &PgPool) -> Uuid {
    let new_user = NewUser::workos(format!("bits_{}", Uuid::new_v4()), None);
    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

async fn cleanup(pool: &PgPool, user_id: Uuid) {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("delete user");
}

/// Credits a wallet through the reward path so the test starts from a real
/// settled balance.
async fn fund(pool: &PgPool, user_id: Uuid, amount: i64) -> i64 {
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
    db::wallets::balance(pool, user_id).await.expect("balance")
}

fn spend(user_id: Uuid, event_id: Uuid, amount: i64) -> db::wallets::BitSpend {
    db::wallets::BitSpend {
        user_id,
        device_id: None,
        event_id,
        run_id: Uuid::new_v4(),
        item_id: "traffic_blocker".to_owned(),
        amount,
        reason: "cyber_defense_upgrade".to_owned(),
    }
}

/// Runs one spend in its own transaction, rolling back on a rejected spend the
/// way the API service does.
async fn run_spend(pool: &PgPool, spend: &db::wallets::BitSpend) -> db::wallets::SpendOutcome {
    let mut tx = pool.begin().await.expect("begin spend");
    let outcome = db::wallets::spend(&mut tx, spend).await.expect("spend");
    match outcome {
        db::wallets::SpendOutcome::Settled { .. } => tx.commit().await.expect("commit spend"),
        _ => tx.rollback().await.expect("rollback spend"),
    }
    outcome
}

async fn debit_rows(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM bit_transactions WHERE user_id = $1 AND amount < 0",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .expect("count debit rows")
}

#[tokio::test]
async fn spend_debits_once_and_a_retry_is_idempotent() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    fund(&pool, user_id, 100).await;

    let event_id = Uuid::new_v4();
    let request = spend(user_id, event_id, 15);
    let first = run_spend(&pool, &request).await;
    assert_eq!(
        first,
        db::wallets::SpendOutcome::Settled { balance: 85 },
        "a funded spend debits exactly the amount"
    );
    assert_eq!(db::wallets::balance(&pool, user_id).await.unwrap(), 85);

    // A retried request with the same idempotency key must not debit again.
    let retry = run_spend(&pool, &request).await;
    assert_eq!(retry, db::wallets::SpendOutcome::AlreadySettled);
    assert_eq!(db::wallets::balance(&pool, user_id).await.unwrap(), 85);
    assert_eq!(debit_rows(&pool, user_id).await, 1);

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn spend_rejects_a_key_reused_for_a_different_debit() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    fund(&pool, user_id, 100).await;

    let event_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let mut first = spend(user_id, event_id, 15);
    first.run_id = run_id;
    let settled = run_spend(&pool, &first).await;
    assert!(matches!(settled, db::wallets::SpendOutcome::Settled { .. }));

    // Same key and run, but a different control: not an idempotent retry.
    let mut other = spend(user_id, event_id, 15);
    other.run_id = run_id;
    other.item_id = "different_control".to_owned();
    let outcome = run_spend(&pool, &other).await;

    assert_eq!(outcome, db::wallets::SpendOutcome::KeyReused);
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.unwrap(),
        85,
        "a reused key must not debit again"
    );
    assert_eq!(debit_rows(&pool, user_id).await, 1);

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn spend_cannot_reuse_a_reward_event_id() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    fund(&pool, user_id, 100).await;

    // Rewards and spends share the `event_id` namespace.
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

    let outcome = run_spend(&pool, &spend(user_id, reward_event_id, 15)).await;

    assert_eq!(outcome, db::wallets::SpendOutcome::KeyReused);
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.unwrap(),
        110,
        "a reward's event id cannot settle a debit"
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn spend_beyond_balance_is_rejected_without_writing_anything() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    fund(&pool, user_id, 10).await;

    let outcome = run_spend(&pool, &spend(user_id, Uuid::new_v4(), 15)).await;
    assert_eq!(outcome, db::wallets::SpendOutcome::InsufficientFunds);
    assert_eq!(
        db::wallets::balance(&pool, user_id).await.unwrap(),
        10,
        "a rejected spend leaves the balance untouched"
    );
    assert_eq!(
        debit_rows(&pool, user_id).await,
        0,
        "a rejected spend leaves no ledger row"
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn concurrent_spends_cannot_overdraw_the_wallet() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    fund(&pool, user_id, 30).await;

    let a = spend(user_id, Uuid::new_v4(), 25);
    let b = spend(user_id, Uuid::new_v4(), 25);
    let (first, second) = tokio::join!(run_spend(&pool, &a), run_spend(&pool, &b));

    let settled = [first, second]
        .iter()
        .filter(|outcome| matches!(outcome, db::wallets::SpendOutcome::Settled { .. }))
        .count();
    let rejected = [first, second]
        .iter()
        .filter(|outcome| matches!(outcome, db::wallets::SpendOutcome::InsufficientFunds))
        .count();

    assert_eq!(settled, 1, "only one of two 25-Bit spends can succeed");
    assert_eq!(rejected, 1, "the other must be rejected");
    assert_eq!(db::wallets::balance(&pool, user_id).await.unwrap(), 5);
    assert_eq!(debit_rows(&pool, user_id).await, 1);

    cleanup(&pool, user_id).await;
}
