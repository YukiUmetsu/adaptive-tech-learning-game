//! Device association.
//!
//! A device may be linked to an authenticated account for context, offline
//! reconciliation, analytics, and multi-device modelling. Association is never
//! an authentication factor: protected routes always verify the WorkOS token.

use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

/// Associates a device with a user, or refreshes its activity time.
pub async fn upsert(pool: &PgPool, device_id: Uuid, user_id: Uuid) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO devices (device_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (device_id)
         DO UPDATE SET user_id = EXCLUDED.user_id, last_seen_at = now()",
    )
    .bind(device_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}
