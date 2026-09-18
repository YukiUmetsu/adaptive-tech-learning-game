use adaptive_learn_domain::{AssessmentMode, ConceptWeight, InteractionType, LearningEvent};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct LearningEventRow {
    event_id: Uuid,
    device_id: Uuid,
    mission_instance_id: Uuid,
    certification_id: String,
    certification_version: String,
    domain_id: String,
    task_id: String,
    question_id: String,
    content_version: String,
    concepts: Json<Vec<ConceptWeight>>,
    assessment_mode: String,
    interaction_type: String,
    score: f64,
    attempt_number: i32,
    hint_count: i32,
    response_ms: i32,
    structured_error_codes: Vec<String>,
    occurred_at: DateTime<Utc>,
}

impl TryFrom<LearningEventRow> for LearningEvent {
    type Error = DbError;

    fn try_from(row: LearningEventRow) -> Result<Self, Self::Error> {
        Ok(Self {
            event_id: row.event_id,
            device_id: row.device_id,
            mission_instance_id: row.mission_instance_id,
            certification_id: row.certification_id,
            certification_version: row.certification_version,
            domain_id: row.domain_id,
            task_id: row.task_id,
            question_id: row.question_id,
            content_version: row.content_version,
            concepts: row.concepts.0,
            assessment_mode: AssessmentMode::try_from(row.assessment_mode.as_str())?,
            interaction_type: InteractionType::try_from(row.interaction_type.as_str())?,
            score: row.score,
            attempt_number: row.attempt_number,
            hint_count: row.hint_count,
            response_ms: row.response_ms,
            structured_error_codes: row.structured_error_codes,
            occurred_at: row.occurred_at,
        })
    }
}

/// Inserts an accepted learning event, deduplicating by `event_id`.
///
/// Returns `true` when the event was inserted and `false` when it already
/// existed, so retries are idempotent.
/// Atomically inserts an accepted event with the next server-derived attempt
/// number for its question.
///
/// The mission row is locked for the transaction so concurrent syncs cannot
/// both assign the same attempt number. Returns `true` when a row was inserted
/// and `false` when the `event_id` already existed (idempotent retry).
pub async fn insert_with_next_attempt(
    pool: &PgPool,
    event: &LearningEvent,
) -> Result<bool, DbError> {
    let mut tx = pool.begin().await?;
    crate::missions::lock_for_update(&mut *tx, event.mission_instance_id).await?;

    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT count(*)
         FROM learning_events
         WHERE mission_instance_id = $1 AND question_id = $2",
    )
    .bind(event.mission_instance_id)
    .bind(&event.question_id)
    .fetch_one(&mut *tx)
    .await?;
    let attempt_number = (existing + 1).clamp(1, 50) as i32;

    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO learning_events
            (event_id, device_id, mission_instance_id, certification_id, certification_version,
             domain_id, task_id, question_id, content_version, concepts, assessment_mode,
             interaction_type, score, attempt_number, hint_count, response_ms,
             structured_error_codes, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id",
    )
    .bind(event.event_id)
    .bind(event.device_id)
    .bind(event.mission_instance_id)
    .bind(&event.certification_id)
    .bind(&event.certification_version)
    .bind(&event.domain_id)
    .bind(&event.task_id)
    .bind(&event.question_id)
    .bind(&event.content_version)
    .bind(Json(&event.concepts))
    .bind(event.assessment_mode.as_str())
    .bind(event.interaction_type.as_str())
    .bind(event.score)
    .bind(attempt_number)
    .bind(event.hint_count)
    .bind(event.response_ms)
    .bind(&event.structured_error_codes)
    .bind(event.occurred_at)
    .fetch_optional(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(inserted.is_some())
}

/// Lists accepted events for a mission in occurrence order.
pub async fn list_for_mission(
    pool: &PgPool,
    mission_instance_id: Uuid,
) -> Result<Vec<LearningEvent>, DbError> {
    let rows = sqlx::query_as::<_, LearningEventRow>(
        "SELECT event_id, device_id, mission_instance_id, certification_id, certification_version,
                domain_id, task_id, question_id, content_version, concepts, assessment_mode,
                interaction_type, score, attempt_number, hint_count, response_ms,
                structured_error_codes, occurred_at
         FROM learning_events
         WHERE mission_instance_id = $1
         ORDER BY occurred_at, attempt_number",
    )
    .bind(mission_instance_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(TryInto::try_into).collect()
}
