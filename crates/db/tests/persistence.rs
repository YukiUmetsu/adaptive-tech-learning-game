//! Integration tests for the Phase 0 schema and migrations.
//!
//! These tests require PostgreSQL. They run when `DATABASE_URL` is set and are
//! skipped otherwise. CI sets `REQUIRE_DB_TESTS=1` so a missing database fails
//! the build instead of silently skipping coverage.
//!
//! ```bash
//! docker compose up -d
//! export DATABASE_URL=postgres://app:app@localhost:5432/app
//! cargo test -p adaptive-learn-db
//! ```

use adaptive_learn_db as db;
use adaptive_learn_domain::{NewSyncBatch, NewUser, SyncBatchStatus};
use chrono::Utc;
use db::PgPool;
use uuid::Uuid;

/// Returns the configured database URL, or `None` when tests should be skipped.
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
    let pool = db::connect(&url, 2).await.expect("connect to database");
    db::MIGRATOR.run(&pool).await.expect("apply migrations");
    Some(pool)
}

async fn insert_user(pool: &PgPool) -> Uuid {
    let new_user = NewUser::workos(
        format!("user_{}", Uuid::new_v4()),
        Some(format!("{}@example.test", Uuid::new_v4())),
    );

    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

async fn delete_user(pool: &PgPool, id: Uuid) {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .expect("delete user");
}

/// Rewrites the database name in a PostgreSQL URL, preserving query parameters.
fn with_database(url: &str, name: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (url, None),
    };

    let base = match base.rfind('/') {
        Some(index) => format!("{}{name}", &base[..=index]),
        None => base.to_owned(),
    };

    match query {
        Some(query) => format!("{base}?{query}"),
        None => base,
    }
}

async fn count_foundation_tables(pool: &PgPool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT count(*)
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('users', 'sync_batches')",
    )
    .fetch_one(pool)
    .await
    .expect("count tables")
}

#[tokio::test]
async fn health_check_succeeds_against_postgres() {
    let Some(pool) = pool().await else {
        return;
    };

    db::health_check(&pool).await.expect("health check");
}

#[tokio::test]
async fn user_round_trips_through_postgres() {
    let Some(pool) = pool().await else {
        return;
    };

    let user_id = insert_user(&pool).await;
    let found = db::users::find_by_id(&pool, user_id)
        .await
        .expect("find user")
        .expect("user exists");

    assert_eq!(found.id, user_id);
    assert_eq!(found.auth_provider, "workos");
    assert!(found.auth_subject.is_some());

    delete_user(&pool, user_id).await;
    let missing = db::users::find_by_id(&pool, user_id)
        .await
        .expect("find user");
    assert!(missing.is_none());
}

#[tokio::test]
async fn sync_batch_is_stored_as_pending_and_deduplicated() {
    let Some(pool) = pool().await else {
        return;
    };

    let user_id = insert_user(&pool).await;
    let client_batch_id = Uuid::new_v4();
    let new_batch = NewSyncBatch {
        user_id,
        device_id: Uuid::new_v4(),
        client_batch_id,
        event_count: 12,
        created_at: Utc::now(),
    };

    let stored = db::sync_batches::insert(&pool, &new_batch)
        .await
        .expect("insert batch");
    assert_eq!(stored.status, SyncBatchStatus::Pending);
    assert_eq!(stored.event_count, 12);

    let found = db::sync_batches::find_by_client_batch_id(&pool, user_id, client_batch_id)
        .await
        .expect("find batch")
        .expect("batch exists");
    assert_eq!(found.id, stored.id);

    // The unique constraint rejects a retried upload rather than creating a
    // second batch.
    let duplicate = db::sync_batches::insert(&pool, &new_batch).await;
    assert!(
        duplicate.is_err(),
        "duplicate client batch must be rejected"
    );

    delete_user(&pool, user_id).await;
}

#[tokio::test]
async fn sync_batch_requires_an_existing_user() {
    let Some(pool) = pool().await else {
        return;
    };

    let orphan = NewSyncBatch {
        user_id: Uuid::new_v4(),
        device_id: Uuid::new_v4(),
        client_batch_id: Uuid::new_v4(),
        event_count: 1,
        created_at: Utc::now(),
    };

    let result = db::sync_batches::insert(&pool, &orphan).await;
    assert!(
        result.is_err(),
        "batch for a missing user must violate the foreign key"
    );
}

#[tokio::test]
async fn migrations_apply_and_revert_in_an_isolated_database() {
    let Some(admin_url) = database_url() else {
        return;
    };

    let database_name = format!("al_migration_test_{}", Uuid::new_v4().simple());
    let admin_pool = db::connect(&admin_url, 1).await.expect("connect admin");

    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE DATABASE \"{database_name}\""
    )))
    .execute(&admin_pool)
    .await
    .expect("create isolated database");

    let isolated_url = with_database(&admin_url, &database_name);
    let isolated = db::connect(&isolated_url, 1)
        .await
        .expect("connect isolated database");

    db::MIGRATOR.run(&isolated).await.expect("apply migrations");
    assert_eq!(count_foundation_tables(&isolated).await, 2);

    db::MIGRATOR
        .undo(&isolated, 0)
        .await
        .expect("revert migrations");
    assert_eq!(count_foundation_tables(&isolated).await, 0);

    isolated.close().await;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP DATABASE \"{database_name}\""
    )))
    .execute(&admin_pool)
    .await
    .expect("drop isolated database");
    admin_pool.close().await;
}
