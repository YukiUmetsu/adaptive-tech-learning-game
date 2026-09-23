use adaptive_learn_domain::{MissionInstance, MissionStatus, QuizMode};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct MissionRow {
    id: Uuid,
    user_id: Option<Uuid>,
    device_id: Uuid,
    certification_id: String,
    certification_version: String,
    content_version: String,
    mode: String,
    recommendation_id: Option<Uuid>,
    daily_mission_id: Option<Uuid>,
    daily_item_position: Option<i32>,
    domain_id: Option<String>,
    task_id: Option<String>,
    question_ids: Json<Vec<String>>,
    status: String,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    module_id: Option<String>,
}

impl TryFrom<MissionRow> for MissionInstance {
    type Error = DbError;

    fn try_from(row: MissionRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            user_id: row.user_id,
            device_id: row.device_id,
            certification_id: row.certification_id,
            certification_version: row.certification_version,
            content_version: row.content_version,
            mode: QuizMode::try_from(row.mode.as_str())?,
            recommendation_id: row.recommendation_id,
            daily_mission_id: row.daily_mission_id,
            daily_item_position: row.daily_item_position,
            domain_id: row.domain_id,
            task_id: row.task_id,
            question_ids: row.question_ids.0,
            status: MissionStatus::try_from(row.status.as_str())?,
            issued_at: row.issued_at,
            expires_at: row.expires_at,
            completed_at: row.completed_at,
            module_id: row.module_id,
        })
    }
}

/// Persists a server-issued mission.
pub async fn insert(pool: &PgPool, mission: &MissionInstance) -> Result<MissionInstance, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "INSERT INTO mission_instances
            (id, user_id, device_id, certification_id, certification_version, content_version,
             mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
             question_ids, status, issued_at, expires_at, completed_at, module_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id, user_id, device_id, certification_id, certification_version, content_version,
                   mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                   question_ids, status, issued_at, expires_at, completed_at, module_id",
    )
    .bind(mission.id)
    .bind(mission.user_id)
    .bind(mission.device_id)
    .bind(&mission.certification_id)
    .bind(&mission.certification_version)
    .bind(&mission.content_version)
    .bind(mission.mode.as_str())
    .bind(mission.recommendation_id)
    .bind(mission.daily_mission_id)
    .bind(mission.daily_item_position)
    .bind(mission.domain_id.as_deref())
    .bind(mission.task_id.as_deref())
    .bind(Json(&mission.question_ids))
    .bind(mission.status.as_str())
    .bind(mission.issued_at)
    .bind(mission.expires_at)
    .bind(mission.completed_at)
    .bind(mission.module_id.as_deref())
    .fetch_one(pool)
    .await?;

    row.try_into()
}

/// Loads a mission by id, regardless of owner.
pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, user_id, device_id, certification_id, certification_version, content_version,
                mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                question_ids, status, issued_at, expires_at, completed_at, module_id
         FROM mission_instances
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}

/// Finds an issued mission already started for one Daily Mission item.
///
/// Used to resume an item instead of creating a second mission for it.
pub async fn find_active_for_daily_item(
    pool: &PgPool,
    user_id: Uuid,
    daily_mission_id: Uuid,
    position: i32,
) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, user_id, device_id, certification_id, certification_version, content_version,
                mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                question_ids, status, issued_at, expires_at, completed_at, module_id
         FROM mission_instances
         WHERE user_id = $1 AND daily_mission_id = $2 AND daily_item_position = $3
           AND status = 'issued'
         ORDER BY issued_at DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(daily_mission_id)
    .bind(position)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}

/// Finds the most recent mission for one Daily Mission item, any status.
///
/// Used to review a completed item's questions and answers.
pub async fn find_for_daily_item(
    pool: &PgPool,
    user_id: Uuid,
    daily_mission_id: Uuid,
    position: i32,
) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, user_id, device_id, certification_id, certification_version, content_version,
                mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                question_ids, status, issued_at, expires_at, completed_at, module_id
         FROM mission_instances
         WHERE user_id = $1 AND daily_mission_id = $2 AND daily_item_position = $3
         ORDER BY issued_at DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(daily_mission_id)
    .bind(position)
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

/// Marks a mission completed when it belongs to the given authenticated user.
pub async fn mark_completed(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "UPDATE mission_instances
         SET status = 'completed', completed_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, device_id, certification_id, certification_version, content_version,
                   mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                   question_ids, status, issued_at, expires_at, completed_at, module_id",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}

/// Marks an anonymous demo mission completed when it still belongs to the
/// issuing device.
///
/// This only ever matches missions with no owning account, so it cannot be used
/// to complete a user-owned mission. Callers additionally authorize the request.
pub async fn mark_completed_anonymous_device(
    pool: &PgPool,
    id: Uuid,
    device_id: Uuid,
) -> Result<Option<MissionInstance>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "UPDATE mission_instances
         SET status = 'completed', completed_at = now()
         WHERE id = $1 AND user_id IS NULL AND device_id = $2
         RETURNING id, user_id, device_id, certification_id, certification_version, content_version,
                   mode, recommendation_id, daily_mission_id, daily_item_position, domain_id, task_id,
                   question_ids, status, issued_at, expires_at, completed_at, module_id",
    )
    .bind(id)
    .bind(device_id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}
