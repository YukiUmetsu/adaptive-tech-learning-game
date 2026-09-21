//! Server-persisted Knowledge Map discovery progress.
//!
//! Discovery is "I revealed/explored learning material", never "I demonstrated
//! knowledge". This module only stores raw monotonic reveals; it never touches
//! `learning_events`, `user_concept_state`, wallets, or rewards. Callers treat
//! every write as auxiliary: a failure here must never fail an accepted learning
//! event or block the learner.
//!
//! Merging is a monotonic set-union. A row lock serializes concurrent writes for
//! the same `(user, track, domain)`, so an older device can never remove a newer
//! reveal and duplicate batches are idempotent.

use adaptive_learn_content::{DomainDiscoveryInput, merge_domain_discovery};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::DbError;

/// Stored discovery progress for one `(user, track version, domain)`.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDiscovery {
    /// Learning track version the progress belongs to.
    pub track_version: String,
    /// Domain the progress belongs to.
    pub domain_id: String,
    /// Learning content version the progress was recorded against.
    pub content_version: String,
    /// Raw revealed prompt ids by node.
    pub revealed_prompt_ids: BTreeMap<String, Vec<String>>,
    /// Raw revealed element ids by node and prompt.
    pub revealed_element_ids: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    /// Time this row was last merged.
    pub updated_at: DateTime<Utc>,
}

impl StoredDiscovery {
    /// Converts the stored row into the planner's raw discovery input.
    pub fn to_input(&self) -> DomainDiscoveryInput {
        DomainDiscoveryInput {
            domain_id: self.domain_id.clone(),
            revealed_prompt_ids: self.revealed_prompt_ids.clone(),
            revealed_element_ids: self.revealed_element_ids.clone(),
        }
    }
}

#[derive(sqlx::FromRow)]
struct DiscoveryRow {
    track_version: String,
    domain_id: String,
    content_version: String,
    revealed_prompt_ids: Json<BTreeMap<String, Vec<String>>>,
    revealed_element_ids: Json<BTreeMap<String, BTreeMap<String, Vec<String>>>>,
    updated_at: DateTime<Utc>,
}

impl From<DiscoveryRow> for StoredDiscovery {
    fn from(row: DiscoveryRow) -> Self {
        Self {
            track_version: row.track_version,
            domain_id: row.domain_id,
            content_version: row.content_version,
            revealed_prompt_ids: row.revealed_prompt_ids.0,
            revealed_element_ids: row.revealed_element_ids.0,
            updated_at: row.updated_at,
        }
    }
}

/// Loads a learner's persisted discovery for one track version.
///
/// Best-effort callers treat a failure as "no persisted progress" and continue
/// with whatever the current request supplied.
pub async fn list_for_user_track(
    pool: &PgPool,
    user_id: Uuid,
    track_version: &str,
) -> Result<Vec<StoredDiscovery>, DbError> {
    let rows = sqlx::query_as::<_, DiscoveryRow>(
        "SELECT track_version, domain_id, content_version, revealed_prompt_ids,
                revealed_element_ids, updated_at
         FROM discovery_progress
         WHERE user_id = $1 AND track_version = $2
         ORDER BY domain_id",
    )
    .bind(user_id)
    .bind(track_version)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(StoredDiscovery::from).collect())
}

/// Merges incoming discovery into persisted progress with set-union semantics.
///
/// Each domain is locked for the duration of its merge, so concurrent devices
/// cannot lose a reveal to last-write-wins. The whole batch is one transaction:
/// it either lands or leaves the previous progress untouched. Callers must treat
/// errors as auxiliary and never let them affect authoritative learning work.
pub async fn merge(
    pool: &PgPool,
    user_id: Uuid,
    track_version: &str,
    content_version: &str,
    updates: &[DomainDiscoveryInput],
) -> Result<(), DbError> {
    if updates.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    // Merge domains in a stable order so concurrent multi-domain batches always
    // acquire row locks in the same order and cannot deadlock.
    let mut ordered: Vec<&DomainDiscoveryInput> = updates.iter().collect();
    ordered.sort_by(|a, b| a.domain_id.cmp(&b.domain_id));

    for update in ordered {
        // Ensure a row exists so the following SELECT ... FOR UPDATE always
        // locks something, even on the first write from this device.
        sqlx::query(
            "INSERT INTO discovery_progress
                (user_id, track_version, domain_id, content_version)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, track_version, domain_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(track_version)
        .bind(&update.domain_id)
        .bind(content_version)
        .execute(&mut *tx)
        .await?;

        let existing = sqlx::query_as::<_, DiscoveryRow>(
            "SELECT track_version, domain_id, content_version, revealed_prompt_ids,
                    revealed_element_ids, updated_at
             FROM discovery_progress
             WHERE user_id = $1 AND track_version = $2 AND domain_id = $3
             FOR UPDATE",
        )
        .bind(user_id)
        .bind(track_version)
        .bind(&update.domain_id)
        .fetch_optional(&mut *tx)
        .await?;

        let merged = match existing {
            Some(row) => {
                let stored = StoredDiscovery::from(row);
                merge_domain_discovery(&stored.to_input(), update)
            }
            None => update.clone(),
        };

        sqlx::query(
            "UPDATE discovery_progress
             SET content_version = $4,
                 revealed_prompt_ids = $5,
                 revealed_element_ids = $6,
                 updated_at = now()
             WHERE user_id = $1 AND track_version = $2 AND domain_id = $3",
        )
        .bind(user_id)
        .bind(track_version)
        .bind(&update.domain_id)
        .bind(content_version)
        .bind(Json(&merged.revealed_prompt_ids))
        .bind(Json(&merged.revealed_element_ids))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_discovery_converts_to_planner_input() {
        let stored = StoredDiscovery {
            track_version: "v1".to_owned(),
            domain_id: "d1".to_owned(),
            content_version: "c1".to_owned(),
            revealed_prompt_ids: BTreeMap::from([("n1".to_owned(), vec!["p1".to_owned()])]),
            revealed_element_ids: BTreeMap::from([(
                "n1".to_owned(),
                BTreeMap::from([("p1".to_owned(), vec!["annotation:a1".to_owned()])]),
            )]),
            updated_at: Utc::now(),
        };

        let input = stored.to_input();
        assert_eq!(input.domain_id, "d1");
        assert_eq!(input.revealed_prompt_ids["n1"], vec!["p1"]);
        assert_eq!(
            input.revealed_element_ids["n1"]["p1"],
            vec!["annotation:a1"]
        );
    }
}
