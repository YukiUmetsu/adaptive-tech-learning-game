use adaptive_learn_domain::{NewUser, User};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    auth_provider: String,
    auth_subject: Option<String>,
    email: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            auth_provider: row.auth_provider,
            auth_subject: row.auth_subject,
            email: row.email,
            created_at: row.created_at,
        }
    }
}

/// Inserts a user, returning the persisted row.
pub async fn insert(pool: &PgPool, new_user: &NewUser) -> Result<User, DbError> {
    new_user.validate()?;

    let row = sqlx::query_as::<_, UserRow>(
        "INSERT INTO users (auth_provider, auth_subject, email)
         VALUES ($1, $2, $3)
         RETURNING id, auth_provider, auth_subject, email, created_at",
    )
    .bind(&new_user.auth_provider)
    .bind(&new_user.auth_subject)
    .bind(&new_user.email)
    .fetch_one(pool)
    .await?;

    Ok(row.into())
}

/// Looks up a user by internal id.
pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, DbError> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT id, auth_provider, auth_subject, email, created_at
         FROM users
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(Into::into))
}

/// Looks up a user by the stable `(provider, subject)` external identity.
pub async fn find_by_auth_subject(
    pool: &PgPool,
    auth_provider: &str,
    auth_subject: &str,
) -> Result<Option<User>, DbError> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT id, auth_provider, auth_subject, email, created_at
         FROM users
         WHERE auth_provider = $1 AND auth_subject = $2",
    )
    .bind(auth_provider)
    .bind(auth_subject)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(Into::into))
}

/// Resolves the internal user for a verified external identity, creating it on
/// first login.
///
/// Identity is `(auth_provider, auth_subject)`. Email is advisory profile data:
/// a changed email updates the existing row instead of creating a second
/// account, and a missing email never clears a known one. The partial unique
/// index on `(auth_provider, auth_subject)` makes this safe under concurrent
/// first-login requests, so two racing requests both resolve to one row.
pub async fn upsert_by_auth_subject(
    pool: &PgPool,
    auth_provider: &str,
    auth_subject: &str,
    email: Option<&str>,
) -> Result<User, DbError> {
    let row = sqlx::query_as::<_, UserRow>(
        "INSERT INTO users (auth_provider, auth_subject, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (auth_provider, auth_subject) WHERE auth_subject IS NOT NULL
         DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
         RETURNING id, auth_provider, auth_subject, email, created_at",
    )
    .bind(auth_provider)
    .bind(auth_subject)
    .bind(email)
    .fetch_one(pool)
    .await?;

    Ok(row.into())
}

/// Returns the learner's persisted IANA timezone, if one was captured.
pub async fn timezone(pool: &PgPool, user_id: Uuid) -> Result<Option<String>, DbError> {
    let timezone =
        sqlx::query_scalar::<_, Option<String>>("SELECT timezone FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    Ok(timezone.flatten())
}

/// Returns whether the learner opted into unlocking all study materials.
pub async fn unlock_all_materials(pool: &PgPool, user_id: Uuid) -> Result<bool, DbError> {
    let value =
        sqlx::query_scalar::<_, bool>("SELECT unlock_all_materials FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    Ok(value.unwrap_or(false))
}

/// Stores the learner's unlock-all preference, returning the stored value.
pub async fn set_unlock_all_materials(
    pool: &PgPool,
    user_id: Uuid,
    value: bool,
) -> Result<bool, DbError> {
    let stored = sqlx::query_scalar::<_, bool>(
        "UPDATE users SET unlock_all_materials = $2 WHERE id = $1
         RETURNING unlock_all_materials",
    )
    .bind(user_id)
    .bind(value)
    .fetch_optional(pool)
    .await?;

    Ok(stored.unwrap_or(value))
}

/// Stores the learner's IANA timezone only when none is set yet.
///
/// Captured once so the Daily Mission day boundary stays stable; a later
/// timezone change cannot move the boundary or farm extra missions.
pub async fn set_timezone_if_absent(
    pool: &PgPool,
    user_id: Uuid,
    timezone: &str,
) -> Result<(), DbError> {
    sqlx::query("UPDATE users SET timezone = $2 WHERE id = $1 AND timezone IS NULL")
        .bind(user_id)
        .bind(timezone)
        .execute(pool)
        .await?;

    Ok(())
}
