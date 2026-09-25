use adaptive_learn_domain::{
    AssessmentMode, ConceptObservation, ConceptWeight, InteractionType, LearningEvent, reward_bits,
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
    difficulty_prior: f64,
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
            difficulty_prior: row.difficulty_prior,
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
    /// Assessment/evidence mode the attempt was collected in.
    pub assessment_mode: AssessmentMode,
    /// When the attempt occurred on the device.
    pub occurred_at: DateTime<Utc>,
    /// Concept mappings with their authored weights.
    pub concepts: Vec<ConceptWeight>,
    /// Server-derived 1-based attempt number for the question.
    ///
    /// Exposed so the pedagogy policy can tell a clean first-attempt success
    /// from a recovery; it is read straight from the accepted event, never
    /// stored again.
    pub attempt_number: i32,
    /// Hints used before submitting.
    ///
    /// A heavily hinted success is weaker evidence and must not fade
    /// scaffolding aggressively.
    pub hint_count: i32,
}

#[derive(sqlx::FromRow)]
struct HistoryRow {
    question_id: String,
    score: f64,
    assessment_mode: String,
    occurred_at: DateTime<Utc>,
    concepts: Json<Vec<ConceptWeight>>,
    attempt_number: i32,
    hint_count: i32,
}

/// Accepts a learning event, assigns the next server-derived attempt number,
/// settles Bits for it, and advances the derived concept state in one
/// transaction.
///
/// The mission row is locked so concurrent syncs cannot assign the same attempt
/// number. Returns the attempt number when the event was newly inserted, or
/// `None` when the `event_id` already existed (idempotent retry). Duplicate
/// events therefore never settle Bits or update concept state twice.
///
/// Anonymous demo events (`user_id = None`) are recorded as evidence but never
/// settle a wallet or create derived user state: there is no account to own
/// either.
pub async fn accept_answer(pool: &PgPool, event: &LearningEvent) -> Result<Option<i32>, DbError> {
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
             certification_version, domain_id, task_id, question_id, content_version,
             difficulty_prior, concepts, assessment_mode, interaction_type, score,
             attempt_number, hint_count, response_ms, structured_error_codes, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
    .bind(event.difficulty_prior)
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

    // Settlement and derived state require an owning account. Anonymous demo
    // attempts only produce evidence.
    if let Some(user_id) = event.user_id {
        let amount = reward_bits(attempt_number, event.score, event.difficulty_prior);
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

        // Accepted events are authoritative; this is only a derived cache. The
        // server-derived attempt number is used, never the client's claim.
        // Concepts are applied in id order so two concurrent events that share
        // concepts always acquire row locks in the same order.
        let mut concepts: Vec<&ConceptWeight> = event.concepts.iter().collect();
        concepts.sort_by(|a, b| a.concept_id.cmp(&b.concept_id));
        for concept in concepts {
            let observation = ConceptObservation {
                user_id,
                certification_version: &event.certification_version,
                concept,
                assessment_mode: event.assessment_mode,
                score: event.score,
                attempt_number,
                hint_count: event.hint_count,
                occurred_at: event.occurred_at,
            };
            crate::concept_state::apply(&mut tx, &observation).await?;
        }
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
        "SELECT question_id, score, assessment_mode, occurred_at, concepts,
                attempt_number, hint_count
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

    rows.into_iter()
        .map(|row| {
            Ok(UserHistoryEntry {
                question_id: row.question_id,
                score: row.score,
                assessment_mode: AssessmentMode::try_from(row.assessment_mode.as_str())?,
                occurred_at: row.occurred_at,
                concepts: row.concepts.0,
                attempt_number: row.attempt_number,
                hint_count: row.hint_count,
            })
        })
        .collect()
}

/// Counts the distinct questions of a mission that have accepted evidence.
///
/// Used to derive server-known mission completion without trusting any client
/// completion claim.
pub async fn covered_question_count(
    pool: &PgPool,
    mission_instance_id: Uuid,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(DISTINCT question_id)
         FROM learning_events
         WHERE mission_instance_id = $1",
    )
    .bind(mission_instance_id)
    .fetch_one(pool)
    .await?;

    Ok(count)
}

/// Lists accepted events for a mission in occurrence order.
pub async fn list_for_mission(
    pool: &PgPool,
    mission_instance_id: Uuid,
) -> Result<Vec<LearningEvent>, DbError> {
    let rows = sqlx::query_as::<_, LearningEventRow>(
        "SELECT event_id, user_id, device_id, mission_instance_id, certification_id,
                certification_version, domain_id, task_id, question_id, content_version,
                difficulty_prior, concepts, assessment_mode, interaction_type, score,
                attempt_number, hint_count, response_ms, structured_error_codes, occurred_at
         FROM learning_events
         WHERE mission_instance_id = $1
         ORDER BY occurred_at, attempt_number",
    )
    .bind(mission_instance_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(TryInto::try_into).collect()
}
