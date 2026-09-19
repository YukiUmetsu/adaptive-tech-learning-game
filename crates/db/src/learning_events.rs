use adaptive_learn_domain::{
    AssessmentMode, ConceptWeight, InteractionType, LearningEvent, reward_bits,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::DbError;
use crate::wallets::{self, BitTransaction};

#[derive(sqlx::FromRow)]
struct LearningEventRow {
    event_id: Uuid,
    user_id: Option<Uuid>,
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
            user_id: row.user_id,
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

/// One recent accepted event, summarized for adaptive question selection.
#[derive(Debug, Clone, PartialEq)]
pub struct UserHistoryEntry {
    /// Question that was answered.
    pub question_id: String,
    /// Accepted partial score in `[0, 1]`.
    pub score: f64,
    /// When the attempt occurred on the device.
    pub occurred_at: DateTime<Utc>,
    /// Concept ids mapped to the question.
    pub concepts: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct HistoryRow {
    question_id: String,
    score: f64,
    occurred_at: DateTime<Utc>,
    concepts: Json<Vec<ConceptWeight>>,
}

/// Accepts a learning event, assigns the next server-derived attempt number,
/// and settles Bits for it in one transaction.
///
/// The mission row is locked so concurrent syncs cannot assign the same attempt
/// number. Returns the attempt number when the event was newly inserted, or
/// `None` when the `event_id` already existed (idempotent retry).
///
/// Anonymous demo events (`user_id = None`) are recorded as evidence but never
/// settle a wallet: there is no account to own the Bits.
pub async fn accept_answer(
    pool: &PgPool,
    event: &LearningEvent,
    difficulty_prior: f64,
) -> Result<Option<i32>, DbError> {
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
            (event_id, user_id, device_id, mission_instance_id, certification_id,
             certification_version, domain_id, task_id, question_id, content_version, concepts,
             assessment_mode, interaction_type, score, attempt_number, hint_count, response_ms,
             structured_error_codes, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id",
    )
    .bind(event.event_id)
    .bind(event.user_id)
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

    if inserted.is_none() {
        tx.commit().await?;
        return Ok(None);
    }

    // Settlement requires an owning account. Anonymous demo attempts only
    // produce evidence.
    if let Some(user_id) = event.user_id {
        let amount = reward_bits(attempt_number, event.score, difficulty_prior);
        let reason = if attempt_number <= 1 {
            "first_attempt"
        } else {
            "recovery"
        };
        let transaction = BitTransaction {
            user_id,
            device_id: Some(event.device_id),
            event_id: event.event_id,
            mission_instance_id: event.mission_instance_id,
            question_id: event.question_id.clone(),
            amount,
            reason: reason.to_owned(),
        };
        wallets::settle(&mut tx, &transaction).await?;
    }

    tx.commit().await?;
    Ok(Some(attempt_number))
}

/// Returns a learner's recent accepted events for a certification, newest
/// first, combining every device the learner has signed in on.
pub async fn recent_for_user(
    pool: &PgPool,
    user_id: Uuid,
    certification_id: &str,
    limit: i64,
) -> Result<Vec<UserHistoryEntry>, DbError> {
    let rows = sqlx::query_as::<_, HistoryRow>(
        "SELECT question_id, score, occurred_at, concepts
         FROM learning_events
         WHERE user_id = $1 AND certification_id = $2
         ORDER BY received_at DESC
         LIMIT $3",
    )
    .bind(user_id)
    .bind(certification_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| UserHistoryEntry {
            question_id: row.question_id,
            score: row.score,
            occurred_at: row.occurred_at,
            concepts: row.concepts.0.into_iter().map(|c| c.concept_id).collect(),
        })
        .collect())
}

/// Lists accepted events for a mission in occurrence order.
pub async fn list_for_mission(
    pool: &PgPool,
    mission_instance_id: Uuid,
) -> Result<Vec<LearningEvent>, DbError> {
    let rows = sqlx::query_as::<_, LearningEventRow>(
        "SELECT event_id, user_id, device_id, mission_instance_id, certification_id,
                certification_version, domain_id, task_id, question_id, content_version, concepts,
                assessment_mode, interaction_type, score, attempt_number, hint_count, response_ms,
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
