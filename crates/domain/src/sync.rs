use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::DomainError;

/// Lifecycle of a client-submitted batch of learning events.
///
/// Batches are metadata only. Raw learning events are appended to cheap object
/// storage and referenced by accepted server records; they are not stored
/// indefinitely in PostgreSQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncBatchStatus {
    /// Received but not yet reconciled against canonical content.
    Pending,
    /// Reconciled and accepted.
    Applied,
    /// Rejected by server-side validation.
    Rejected,
}

impl SyncBatchStatus {
    /// Canonical string stored in PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Applied => "applied",
            Self::Rejected => "rejected",
        }
    }
}

impl std::fmt::Display for SyncBatchStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TryFrom<&str> for SyncBatchStatus {
    type Error = DomainError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "pending" => Ok(Self::Pending),
            "applied" => Ok(Self::Applied),
            "rejected" => Ok(Self::Rejected),
            _ => Err(DomainError::invalid(
                "sync_batch_status",
                "must be one of pending, applied, rejected",
            )),
        }
    }
}

/// A deduplicated batch of learning events uploaded by one device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncBatch {
    /// Server-side batch identifier.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Device that produced the batch.
    pub device_id: Uuid,
    /// Client-generated batch identifier used to deduplicate retries.
    pub client_batch_id: Uuid,
    /// Current reconciliation status.
    pub status: SyncBatchStatus,
    /// Number of events claimed in the batch.
    pub event_count: i32,
    /// Time the batch was produced on the device.
    pub created_at: DateTime<Utc>,
    /// Time the server received the batch.
    pub received_at: DateTime<Utc>,
}

/// Values required to record a new [`SyncBatch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSyncBatch {
    /// Owning learner.
    pub user_id: Uuid,
    /// Device that produced the batch.
    pub device_id: Uuid,
    /// Client-generated batch identifier used to deduplicate retries.
    pub client_batch_id: Uuid,
    /// Number of events claimed in the batch.
    pub event_count: i32,
    /// Time the batch was produced on the device.
    pub created_at: DateTime<Utc>,
}

impl NewSyncBatch {
    /// Validates the values before they reach the database.
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.event_count < 0 {
            return Err(DomainError::invalid("event_count", "must not be negative"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_round_trips_through_string() {
        for status in [
            SyncBatchStatus::Pending,
            SyncBatchStatus::Applied,
            SyncBatchStatus::Rejected,
        ] {
            let parsed = SyncBatchStatus::try_from(status.as_str());
            assert_eq!(parsed, Ok(status));
            assert_eq!(status.to_string(), status.as_str());
        }
    }

    #[test]
    fn status_rejects_unknown_value() {
        assert!(SyncBatchStatus::try_from("unknown").is_err());
    }

    #[test]
    fn status_serializes_as_snake_case() {
        let json = serde_json::to_string(&SyncBatchStatus::Applied).expect("serialize status");
        assert_eq!(json, "\"applied\"");
    }

    #[test]
    fn new_batch_rejects_negative_event_count() {
        let batch = NewSyncBatch {
            user_id: Uuid::nil(),
            device_id: Uuid::nil(),
            client_batch_id: Uuid::nil(),
            event_count: -1,
            created_at: Utc::now(),
        };

        assert!(batch.validate().is_err());
    }
}
