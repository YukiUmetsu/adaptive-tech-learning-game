//! Best-effort auxiliary log of displayed recommendations.
//!
//! This is not learning evidence. It exists only so recommendation quality can be
//! inspected later, and every write is optional: callers ignore failures so a
//! logging problem can never block a recommendation or a learning session.

use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

/// One recommendation shown to a learner.
#[derive(Debug, Clone, PartialEq)]
pub struct RecommendationLogEntry<'a> {
    /// Owning learner.
    pub user_id: Uuid,
    /// Learning track identifier.
    pub track_id: &'a str,
    /// Learning track version identifier.
    pub track_version: &'a str,
    /// Chosen action, for example `learn_node`.
    pub action: &'a str,
    /// Stable reason code, for example `weak_concept`.
    pub reason: &'a str,
    /// Domain/topic the action belongs to.
    pub domain_id: Option<&'a str>,
    /// Knowledge node, when node-based.
    pub node_id: Option<&'a str>,
    /// Question, when question-based.
    pub question_id: Option<&'a str>,
    /// Concepts the recommendation targets.
    pub concept_ids: &'a [String],
}

/// Appends one auxiliary recommendation record.
///
/// Callers must treat this as best-effort and ignore errors.
pub async fn log(pool: &PgPool, entry: &RecommendationLogEntry<'_>) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO recommendation_log
            (user_id, track_id, track_version, action, reason, domain_id, node_id, question_id,
             concept_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(entry.user_id)
    .bind(entry.track_id)
    .bind(entry.track_version)
    .bind(entry.action)
    .bind(entry.reason)
    .bind(entry.domain_id)
    .bind(entry.node_id)
    .bind(entry.question_id)
    .bind(entry.concept_ids)
    .execute(pool)
    .await?;

    Ok(())
}
