//! Best-effort auxiliary log of generated study sessions.
//!
//! This is not learning evidence. It exists only so session planning quality can
//! be evaluated later, and writes are optional: callers ignore failures so a
//! persistence problem can never block a session, a mission, or a learning
//! event. It never shares a transaction with learning-event persistence.

use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

/// One generated study session.
#[derive(Debug, Clone, PartialEq)]
pub struct StudySessionLogEntry<'a> {
    /// Stable session id returned to the client.
    pub session_id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Learning track identifier.
    pub track_id: &'a str,
    /// Learning track version identifier.
    pub track_version: &'a str,
    /// Requested session length.
    pub available_minutes: u32,
    /// Planning preference, for example `balanced`.
    pub preference: &'a str,
    /// Estimated total minutes of the produced session.
    pub estimated_minutes: u32,
    /// Number of activities in the produced session.
    pub activity_count: i32,
}

/// Appends one generated session record.
///
/// Callers must treat this as best-effort and ignore errors.
pub async fn log(pool: &PgPool, entry: &StudySessionLogEntry<'_>) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO study_session_log
            (session_id, user_id, track_id, track_version, available_minutes, preference,
             estimated_minutes, activity_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(entry.session_id)
    .bind(entry.user_id)
    .bind(entry.track_id)
    .bind(entry.track_version)
    .bind(entry.available_minutes as i32)
    .bind(entry.preference)
    .bind(entry.estimated_minutes as i32)
    .bind(entry.activity_count)
    .execute(pool)
    .await?;

    Ok(())
}
