use adaptive_learn_domain::{MissionInstance, MissionStatus, QuizMode};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct MissionRow {
    id: Uuid,
    device_id: Uuid,
    certification_id: String,
    certification_version: String,
    content_version: String,
    mode: String,
    domain_id: Option<String>,
    task_id: Option<String>,
    question_ids: Json<Vec<String>>,
    status: String,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

impl TryFrom<MissionRow> for MissionInstance {
    type Error = DbError;

    fn try_from(row: MissionRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            device_id: row.device_id,
            certification_id: row.certification_id,
            certification_version: row.certification_version,
            content_version: row.content_version,
            mode: QuizMode::try_from(row.mode.as_str())?,
            domain_id: row.domain_id,
            task_id: row.task_id,
            question_ids: row.question_ids.0,
            status: MissionStatus::try_from(row.status.as_str())?,
            issued_at: row.issued_at,
            expires_at: row.expires_at,
            completed_at: row.completed_at,
        })
    }
}

/// Persists a server-issued mission.
pub async fn insert(pool: &PgPool, mission: &MissionInstance) -> Result<MissionInstance, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "INSERT INTO mission_instances
            (id, device_id, certification_id, certification_version, content_version,
             mode, domain_id, task_id, question_ids, status, issued_at, expires_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, device_id, certification_id, certification_version, content_version,
                   mode, domain_id, task_id, question_ids, status, issued_at, expires_at, completed_at",
    )
    .bind(mission.id)
    .bind(mission.device_id)
    .bind(&mission.certification_id)
    .bind(&mission.certification_version)
    .bind(&mission.content_version)
    .bind(mission.mode.as_str())
    .bind(mission.domain_id.as_deref())
    .bind(mission.task_id.as_deref())
    .bind(Json(&mission.question_ids))
    .bind(mission.status.as_str())
    .bind(mission.issued_at)
    .bind(mission.expires_at)
    .bind(mission.completed_at)
    .fetch_one(pool)
    .await?;

    row.try_into()
}

/// Loads a mission by id.
pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, device_id, certification_id, certification_version, content_version,
                mode, domain_id, task_id, question_ids, status, issued_at, expires_at, completed_at
         FROM mission_instances
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}

/// Locks a mission row for the duration of a transaction.
///
/// Used to serialize attempt numbering so concurrent syncs cannot both assign
/// the same attempt number.
pub async fn lock_for_update<'e, E>(executor: E, id: Uuid) -> Result<(), DbError>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query("SELECT id FROM mission_instances WHERE id = $1 FOR UPDATE")
        .bind(id)
        .execute(executor)
        .await?;

    Ok(())
}

/// Marks a mission completed when it belongs to the given device.
pub async fn mark_completed(
    pool: &PgPool,
    id: Uuid,
    device_id: Uuid,
) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "UPDATE mission_instances
         SET status = 'completed', completed_at = now()
         WHERE id = $1 AND device_id = $2
         RETURNING id, device_id, certification_id, certification_version, content_version,
                   mode, domain_id, task_id, question_ids, status, issued_at, expires_at, completed_at",
    )
    .bind(id)
    .bind(device_id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}
