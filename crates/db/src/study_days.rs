//! Persistence for the account-wide daily study streak.
//!
//! One row per qualified `(user, local_day)`. Inserts are idempotent, so a
//! duplicate sync or retry can never record the same day twice. This is
//! motivational state only: it never shares a transaction with learning events,
//! concept state, or rewards, and callers treat writes as best-effort.

use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

/// Records that the learner studied on `local_day`.
///
/// Idempotent by `(user_id, local_day)`; a replayed day is a no-op.
pub async fn record(pool: &PgPool, user_id: Uuid, local_day: NaiveDate) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO user_study_days (user_id, local_day)
         VALUES ($1, $2)
         ON CONFLICT (user_id, local_day) DO NOTHING",
    )
    .bind(user_id)
    .bind(local_day)
    .execute(pool)
    .await?;

    Ok(())
}

/// Lists the learner's most recent active days, newest first.
pub async fn list_days(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<NaiveDate>, DbError> {
    let days = sqlx::query_scalar::<_, NaiveDate>(
        "SELECT local_day
         FROM user_study_days
         WHERE user_id = $1
         ORDER BY local_day DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(days)
}
