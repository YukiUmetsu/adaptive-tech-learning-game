use adaptive_learn_domain::{NewSyncBatch, SyncBatch, SyncBatchStatus};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct SyncBatchRow {
    id: Uuid,
    user_id: Uuid,
    device_id: Uuid,
    client_batch_id: Uuid,
    status: String,
    event_count: i32,
    created_at: DateTime<Utc>,
    received_at: DateTime<Utc>,
}

impl TryFrom<SyncBatchRow> for SyncBatch {
    type Error = DbError;

    fn try_from(row: SyncBatchRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            user_id: row.user_id,
            device_id: row.device_id,
            client_batch_id: row.client_batch_id,
            status: SyncBatchStatus::try_from(row.status.as_str())?,
            event_count: row.event_count,
            created_at: row.created_at,
            received_at: row.received_at,
        })
    }
}

/// Records a client batch as `pending`.
///
/// `(user_id, client_batch_id)` is unique, so retried uploads are deduplicated
/// by the database rather than by trust in the client.
pub async fn insert(pool: &PgPool, new_batch: &NewSyncBatch) -> Result<SyncBatch, DbError> {
    new_batch.validate()?;

    let row = sqlx::query_as::<_, SyncBatchRow>(
        "INSERT INTO sync_batches (user_id, device_id, client_batch_id, status, event_count, created_at)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         RETURNING id, user_id, device_id, client_batch_id, status, event_count, created_at, received_at",
    )
    .bind(new_batch.user_id)
    .bind(new_batch.device_id)
    .bind(new_batch.client_batch_id)
    .bind(new_batch.event_count)
    .bind(new_batch.created_at)
    .fetch_one(pool)
    .await?;

    row.try_into()
}

/// Finds a batch by the client-generated identifier used to deduplicate retries.
pub async fn find_by_client_batch_id(
    pool: &PgPool,
    user_id: Uuid,
    client_batch_id: Uuid,
) -> Result<Option<SyncBatch>, DbError> {
    let row = sqlx::query_as::<_, SyncBatchRow>(
        "SELECT id, user_id, device_id, client_batch_id, status, event_count, created_at, received_at
         FROM sync_batches
         WHERE user_id = $1 AND client_batch_id = $2",
    )
    .bind(user_id)
    .bind(client_batch_id)
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}
