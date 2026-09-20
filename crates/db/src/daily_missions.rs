//! Persistence for the immutable Daily Mission snapshot and its item progress.
//!
//! A Daily Mission is generated once per learner/track/day and then never
//! changes. Items and their execution configuration are stored in full so the
//! same plan and ordering can be replayed later. Mission completion and the
//! completion reward are server-authoritative; this module never mutates
//! concept state or learning events.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::types::Json;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::DbError;

/// A newly generated Daily Mission.
#[derive(Debug, Clone)]
pub struct NewDailyMission<'a> {
    /// Owning learner.
    pub user_id: Uuid,
    /// Learning track identifier.
    pub track_id: &'a str,
    /// Learning track version identifier.
    pub track_version: &'a str,
    /// Canonical UTC day key.
    pub day_key: NaiveDate,
    /// Client IANA timezone, stored as metadata only.
    pub timezone: Option<&'a str>,
    /// `adaptive` or `standard`.
    pub plan_type: &'a str,
    /// Bits bonus awarded once on completion.
    pub reward_bits: i32,
}

/// One item in a newly generated Daily Mission.
#[derive(Debug, Clone)]
pub struct NewDailyMissionItem<'a> {
    /// Zero-based position in the plan.
    pub position: i32,
    /// One of `learn_node`, `review_node`, `practice`, `domain_practice`.
    pub kind: &'a str,
    /// Owning domain/topic.
    pub domain_id: &'a str,
    /// Knowledge node, for node items.
    pub node_id: Option<&'a str>,
    /// Learner-facing title.
    pub title: &'a str,
    /// Estimated minutes.
    pub estimated_minutes: i32,
    /// Server-selected execution context, for example `{ "question_ids": [...] }`.
    pub practice_context: serde_json::Value,
}

/// A stored Daily Mission.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDailyMission {
    /// Mission identifier.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Learning track identifier.
    pub track_id: String,
    /// Learning track version identifier.
    pub track_version: String,
    /// Canonical UTC day key.
    pub day_key: NaiveDate,
    /// Client IANA timezone metadata.
    pub timezone: Option<String>,
    /// `adaptive` or `standard`.
    pub plan_type: String,
    /// `active` or `completed`.
    pub status: String,
    /// Bits bonus for completion.
    pub reward_bits: i32,
    /// When the bonus was settled, if ever.
    pub reward_settled_at: Option<DateTime<Utc>>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Completion time.
    pub completed_at: Option<DateTime<Utc>>,
    /// Ordered items.
    pub items: Vec<StoredDailyMissionItem>,
}

impl StoredDailyMission {
    /// Whether the mission is complete.
    pub fn is_completed(&self) -> bool {
        self.status == "completed"
    }

    /// Number of completed items.
    pub fn completed_items(&self) -> usize {
        self.items
            .iter()
            .filter(|item| item.status == "completed")
            .count()
    }
}

/// A stored Daily Mission item.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDailyMissionItem {
    /// Item identifier.
    pub id: Uuid,
    /// Zero-based plan position.
    pub position: i32,
    /// Item kind.
    pub kind: String,
    /// Owning domain/topic.
    pub domain_id: String,
    /// Knowledge node, for node items.
    pub node_id: Option<String>,
    /// Learner-facing title.
    pub title: String,
    /// Estimated minutes.
    pub estimated_minutes: i32,
    /// Server-selected execution context.
    pub practice_context: serde_json::Value,
    /// `pending` or `completed`.
    pub status: String,
    /// Completion time.
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct MissionRow {
    id: Uuid,
    user_id: Uuid,
    track_id: String,
    track_version: String,
    day_key: NaiveDate,
    timezone: Option<String>,
    plan_type: String,
    status: String,
    reward_bits: i32,
    reward_settled_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct ItemRow {
    id: Uuid,
    position: i32,
    kind: String,
    domain_id: String,
    node_id: Option<String>,
    title: String,
    estimated_minutes: i32,
    practice_context: Json<serde_json::Value>,
    status: String,
    completed_at: Option<DateTime<Utc>>,
}

impl From<MissionRow> for StoredDailyMission {
    fn from(row: MissionRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            track_id: row.track_id,
            track_version: row.track_version,
            day_key: row.day_key,
            timezone: row.timezone,
            plan_type: row.plan_type,
            status: row.status,
            reward_bits: row.reward_bits,
            reward_settled_at: row.reward_settled_at,
            created_at: row.created_at,
            completed_at: row.completed_at,
            items: Vec::new(),
        }
    }
}

impl From<ItemRow> for StoredDailyMissionItem {
    fn from(row: ItemRow) -> Self {
        Self {
            id: row.id,
            position: row.position,
            kind: row.kind,
            domain_id: row.domain_id,
            node_id: row.node_id,
            title: row.title,
            estimated_minutes: row.estimated_minutes,
            practice_context: row.practice_context.0,
            status: row.status,
            completed_at: row.completed_at,
        }
    }
}

/// Loads the learner's Daily Mission for a canonical day, if it exists.
pub async fn find_for_day(
    pool: &PgPool,
    user_id: Uuid,
    track_id: &str,
    day_key: NaiveDate,
) -> Result<Option<StoredDailyMission>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, user_id, track_id, track_version, day_key, timezone, plan_type,
                status, reward_bits, reward_settled_at, created_at, completed_at
         FROM daily_missions
         WHERE user_id = $1 AND track_id = $2 AND day_key = $3",
    )
    .bind(user_id)
    .bind(track_id)
    .bind(day_key)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => load_with_items(pool, row.into()).await.map(Some),
        None => Ok(None),
    }
}

/// Loads a Daily Mission by id, regardless of owner.
pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<StoredDailyMission>, DbError> {
    let row = sqlx::query_as::<_, MissionRow>(
        "SELECT id, user_id, track_id, track_version, day_key, timezone, plan_type,
                status, reward_bits, reward_settled_at, created_at, completed_at
         FROM daily_missions
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => load_with_items(pool, row.into()).await.map(Some),
        None => Ok(None),
    }
}

async fn load_with_items(
    pool: &PgPool,
    mut mission: StoredDailyMission,
) -> Result<StoredDailyMission, DbError> {
    mission.items = load_items(pool, mission.id).await?;
    Ok(mission)
}

async fn load_items(
    pool: &PgPool,
    mission_id: Uuid,
) -> Result<Vec<StoredDailyMissionItem>, DbError> {
    let rows = sqlx::query_as::<_, ItemRow>(
        "SELECT id, position, kind, domain_id, node_id, title, estimated_minutes,
                practice_context, status, completed_at
         FROM daily_mission_items
         WHERE daily_mission_id = $1
         ORDER BY position",
    )
    .bind(mission_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Inserts a Daily Mission and its items, or returns the existing one.
///
/// The unique `(user_id, track_id, day_key)` constraint makes concurrent first
/// requests safe: one writer inserts, the others read the committed mission.
pub async fn create(
    pool: &PgPool,
    new_mission: &NewDailyMission<'_>,
    items: &[NewDailyMissionItem<'_>],
) -> Result<StoredDailyMission, DbError> {
    let mut tx = pool.begin().await?;

    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO daily_missions
            (user_id, track_id, track_version, day_key, timezone, plan_type, status, reward_bits)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
         ON CONFLICT (user_id, track_id, day_key) DO NOTHING
         RETURNING id",
    )
    .bind(new_mission.user_id)
    .bind(new_mission.track_id)
    .bind(new_mission.track_version)
    .bind(new_mission.day_key)
    .bind(new_mission.timezone)
    .bind(new_mission.plan_type)
    .bind(new_mission.reward_bits)
    .fetch_optional(&mut *tx)
    .await?;

    let mission_id = match inserted {
        Some(id) => {
            for item in items {
                insert_item(&mut tx, id, item).await?;
            }
            id
        }
        None => {
            // Another request won the race; return its mission unchanged.
            let existing = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM daily_missions
                 WHERE user_id = $1 AND track_id = $2 AND day_key = $3",
            )
            .bind(new_mission.user_id)
            .bind(new_mission.track_id)
            .bind(new_mission.day_key)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            return find_by_id(pool, existing)
                .await?
                .ok_or_else(|| DbError::from(sqlx::Error::RowNotFound));
        }
    };

    tx.commit().await?;
    find_by_id(pool, mission_id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound.into())
}

async fn insert_item(
    conn: &mut PgConnection,
    mission_id: Uuid,
    item: &NewDailyMissionItem<'_>,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO daily_mission_items
            (daily_mission_id, position, kind, domain_id, node_id, title, estimated_minutes,
             practice_context, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')",
    )
    .bind(mission_id)
    .bind(item.position)
    .bind(item.kind)
    .bind(item.domain_id)
    .bind(item.node_id)
    .bind(item.title)
    .bind(item.estimated_minutes)
    .bind(Json(&item.practice_context))
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Marks one item complete and closes the mission when nothing remains.
///
/// Idempotent: completing an already-complete item leaves the stored plan
/// untouched. Returns the updated mission, or `None` when it does not exist.
pub async fn mark_item_complete(
    pool: &PgPool,
    mission_id: Uuid,
    position: i32,
) -> Result<Option<StoredDailyMission>, DbError> {
    let mut tx = pool.begin().await?;

    // Lock the mission so concurrent completions serialize.
    let exists =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM daily_missions WHERE id = $1 FOR UPDATE")
            .bind(mission_id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        tx.commit().await?;
        return Ok(None);
    }

    sqlx::query(
        "UPDATE daily_mission_items
         SET status = 'completed', completed_at = COALESCE(completed_at, now())
         WHERE daily_mission_id = $1 AND position = $2 AND status = 'pending'",
    )
    .bind(mission_id)
    .bind(position)
    .execute(&mut *tx)
    .await?;

    let pending = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM daily_mission_items
         WHERE daily_mission_id = $1 AND status = 'pending'",
    )
    .bind(mission_id)
    .fetch_one(&mut *tx)
    .await?;

    if pending == 0 {
        sqlx::query(
            "UPDATE daily_missions
             SET status = 'completed', completed_at = COALESCE(completed_at, now())
             WHERE id = $1",
        )
        .bind(mission_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    find_by_id(pool, mission_id).await
}

/// Records that the completion bonus was settled on an open transaction.
pub async fn mark_reward_settled(conn: &mut PgConnection, mission_id: Uuid) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE daily_missions
         SET reward_settled_at = COALESCE(reward_settled_at, now())
         WHERE id = $1",
    )
    .bind(mission_id)
    .execute(&mut *conn)
    .await?;

    Ok(())
}
