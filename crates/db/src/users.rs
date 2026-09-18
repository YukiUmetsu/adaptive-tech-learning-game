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
