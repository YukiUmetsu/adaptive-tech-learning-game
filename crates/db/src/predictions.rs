//! Auxiliary prediction measurement persistence.
//!
//! Snapshots are captured at question issuance and are immutable. Outcomes are
//! appended when an accepted learning event arrives. Nothing here is used by
//! scoring, rewards, or concept state; callers treat every write as best-effort
//! so measurement can never block learning.

use adaptive_learn_domain::ConceptWeight;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::DbError;

/// One prediction snapshot to persist before the answer is known.
#[derive(Debug, Clone)]
pub struct NewPredictionSnapshot<'a> {
    /// Owning learner.
    pub user_id: Uuid,
    /// Mission the question was issued in.
    pub mission_instance_id: Uuid,
    /// Question identifier.
    pub question_id: &'a str,
    /// Learning track identifier.
    pub track_id: &'a str,
    /// Learning track version identifier.
    pub track_version: &'a str,
    /// Immutable content version.
    pub content_version: &'a str,
    /// Owning domain/topic.
    pub domain_id: &'a str,
    /// Evidence mode the question measures.
    pub assessment_mode: &'a str,
    /// Interaction family.
    pub interaction_type: &'a str,
    /// Question difficulty prior.
    pub difficulty_prior: f64,
    /// Authored concept mappings with weights.
    pub concepts: &'a [ConceptWeight],
    /// Per-concept detail used to build the prediction.
    pub concept_detail: serde_json::Value,
    /// Predicted score in `[0, 1]`.
    pub predicted_score: f64,
    /// Model version, for example `heuristic-v1`.
    pub model_version: &'a str,
    /// Where the question came from.
    pub practice_source: &'a str,
    /// Whether this was a spaced delayed-retrieval item.
    pub delayed_retrieval: bool,
    /// Seconds since the most recent practice of any contributing concept.
    pub seconds_since_previous_practice: Option<i32>,
}

/// Appends prediction snapshots.
///
/// Callers must treat this as best-effort and ignore errors.
pub async fn insert_snapshots(
    pool: &PgPool,
    snapshots: &[NewPredictionSnapshot<'_>],
) -> Result<(), DbError> {
    if snapshots.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    for snapshot in snapshots {
        sqlx::query(
            "INSERT INTO prediction_snapshots
                (user_id, mission_instance_id, question_id, track_id, track_version, content_version,
                 domain_id, assessment_mode, interaction_type, difficulty_prior, concepts,
                 concept_detail, predicted_score, model_version, practice_source, delayed_retrieval,
                 seconds_since_previous_practice, predicted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
             ON CONFLICT (mission_instance_id, question_id, model_version) DO NOTHING",
        )
        .bind(snapshot.user_id)
        .bind(snapshot.mission_instance_id)
        .bind(snapshot.question_id)
        .bind(snapshot.track_id)
        .bind(snapshot.track_version)
        .bind(snapshot.content_version)
        .bind(snapshot.domain_id)
        .bind(snapshot.assessment_mode)
        .bind(snapshot.interaction_type)
        .bind(snapshot.difficulty_prior)
        .bind(Json(snapshot.concepts))
        .bind(Json(&snapshot.concept_detail))
        .bind(snapshot.predicted_score)
        .bind(snapshot.model_version)
        .bind(snapshot.practice_source)
        .bind(snapshot.delayed_retrieval)
        .bind(snapshot.seconds_since_previous_practice)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Links an accepted event to the prediction captured when it was issued.
///
/// Idempotent: a replayed event cannot create a second outcome row. Callers must
/// treat this as best-effort and ignore errors.
pub async fn record_outcome(pool: &PgPool, entry: &OutcomeEntry) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO prediction_outcomes
            (prediction_id, event_id, attempt_number, observed_score, observed_at)
         SELECT id, $4, $5, $6, $7
         FROM prediction_snapshots
         WHERE mission_instance_id = $1 AND question_id = $2 AND model_version = $3
         ON CONFLICT (prediction_id, event_id) DO NOTHING",
    )
    .bind(entry.mission_instance_id)
    .bind(&entry.question_id)
    .bind(&entry.model_version)
    .bind(entry.event_id)
    .bind(entry.attempt_number)
    .bind(entry.observed_score)
    .bind(entry.observed_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// One accepted outcome linked to a prediction.
#[derive(Debug, Clone)]
pub struct OutcomeEntry {
    /// Mission the event belongs to.
    pub mission_instance_id: Uuid,
    /// Question answered.
    pub question_id: String,
    /// Model version the prediction was made with.
    pub model_version: String,
    /// Stable learning-event id.
    pub event_id: Uuid,
    /// Server-derived attempt number.
    pub attempt_number: i32,
    /// Accepted partial score in `[0, 1]`.
    pub observed_score: f64,
    /// When the attempt occurred.
    pub observed_at: DateTime<Utc>,
}

/// One resolved prediction/outcome pair with slicing metadata.
#[derive(Debug, Clone)]
pub struct ResolvedSample {
    /// Model version.
    pub model_version: String,
    /// Practice source, for example `daily_mission`.
    pub practice_source: String,
    /// Assessment/evidence mode.
    pub assessment_mode: String,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Learning track identifier.
    pub track_id: String,
    /// Question difficulty prior.
    pub difficulty_prior: f64,
    /// Predicted score.
    pub predicted_score: f64,
    /// Whether this was a spaced delayed-retrieval item.
    pub delayed_retrieval: bool,
    /// Seconds since previous practice, when known.
    pub seconds_since_previous_practice: Option<i32>,
    /// Attempt number of the linked event.
    pub attempt_number: i32,
    /// Observed score.
    pub observed_score: f64,
    /// When the attempt occurred.
    pub observed_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ResolvedSampleRow {
    model_version: String,
    practice_source: String,
    assessment_mode: String,
    domain_id: String,
    track_id: String,
    difficulty_prior: f64,
    predicted_score: f64,
    delayed_retrieval: bool,
    seconds_since_previous_practice: Option<i32>,
    attempt_number: i32,
    observed_score: f64,
    observed_at: DateTime<Utc>,
}

/// Lists resolved prediction/outcome pairs for one model version, newest first.
///
/// Only the first accepted attempt for a question is evaluated. Retry attempts
/// are retained in `prediction_outcomes` as operational data, but they are not
/// independent observations of the original pre-answer prediction, so including
/// them would inflate evaluation samples.
pub async fn list_resolved(
    pool: &PgPool,
    model_version: &str,
    limit: i64,
) -> Result<Vec<ResolvedSample>, DbError> {
    let rows = sqlx::query_as::<_, ResolvedSampleRow>(
        "SELECT p.model_version, p.practice_source, p.assessment_mode, p.domain_id, p.track_id,
                p.difficulty_prior, p.predicted_score, p.delayed_retrieval,
                p.seconds_since_previous_practice, o.attempt_number, o.observed_score, o.observed_at
         FROM prediction_snapshots p
         JOIN prediction_outcomes o ON o.prediction_id = p.id
         WHERE p.model_version = $1 AND o.attempt_number = 1
         ORDER BY o.observed_at DESC
         LIMIT $2",
    )
    .bind(model_version)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ResolvedSample {
            model_version: row.model_version,
            practice_source: row.practice_source,
            assessment_mode: row.assessment_mode,
            domain_id: row.domain_id,
            track_id: row.track_id,
            difficulty_prior: row.difficulty_prior,
            predicted_score: row.predicted_score,
            delayed_retrieval: row.delayed_retrieval,
            seconds_since_previous_practice: row.seconds_since_previous_practice,
            attempt_number: row.attempt_number,
            observed_score: row.observed_score,
            observed_at: row.observed_at,
        })
        .collect())
}
