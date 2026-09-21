//! Integration tests for account-wide study-day persistence.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

use adaptive_learn_db as db;
use adaptive_learn_domain::NewUser;
use chrono::NaiveDate;
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
    let pool = db::connect(&url, 2).await.expect("connect to database");
    db::MIGRATOR.run(&pool).await.expect("apply migrations");
    Some(pool)
}

async fn insert_user(pool: &PgPool) -> Uuid {
    let new_user = NewUser::workos(format!("study_days_{}", Uuid::new_v4()), None);
    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

fn day(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid date")
}

#[tokio::test]
async fn recording_the_same_day_twice_is_idempotent() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    for _ in 0..3 {
        db::study_days::record(&pool, user_id, day("2026-09-20"))
            .await
            .expect("record day");
    }

    let days = db::study_days::list_days(&pool, user_id, 100)
        .await
        .expect("list days");
    assert_eq!(days, vec![day("2026-09-20")]);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}

#[tokio::test]
async fn list_days_returns_recent_days_newest_first() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    for value in ["2026-09-18", "2026-09-19", "2026-09-20"] {
        db::study_days::record(&pool, user_id, day(value))
            .await
            .expect("record day");
    }

    let days = db::study_days::list_days(&pool, user_id, 2)
        .await
        .expect("list days");
    assert_eq!(days, vec![day("2026-09-20"), day("2026-09-19")]);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}
