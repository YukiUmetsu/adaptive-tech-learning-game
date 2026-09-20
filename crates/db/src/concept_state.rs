//! Persistence for the derived `user_concept_state` cache.
//!
//! `learning_events` are authoritative; these rows are a deterministic
//! projection that selection reads quickly. Every write happens inside the same
//! transaction that accepts an event, so a replayed event can never advance
//! state twice.

use adaptive_learn_domain::{
    AssessmentMode, ConceptObservation, ConceptState, update_concept_state,
};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::DbError;

#[derive(sqlx::FromRow)]
struct ConceptStateRow {
    user_id: Uuid,
    certification_version: String,
    concept_id: String,
    assessment_mode: String,
    estimate: f64,
    evidence_mass: f64,
    exposure_count: i32,
    success_count: i32,
    failure_count: i32,
    last_practiced_at: Option<chrono::DateTime<chrono::Utc>>,
    last_success_at: Option<chrono::DateTime<chrono::Utc>>,
    model_version: String,
    state_version: i32,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl TryFrom<ConceptStateRow> for ConceptState {
    type Error = DbError;

    fn try_from(row: ConceptStateRow) -> Result<Self, Self::Error> {
        Ok(Self {
            user_id: row.user_id,
            certification_version: row.certification_version,
            concept_id: row.concept_id,
            assessment_mode: AssessmentMode::try_from(row.assessment_mode.as_str())?,
            estimate: row.estimate,
            evidence_mass: row.evidence_mass,
            exposure_count: row.exposure_count,
            success_count: row.success_count,
            failure_count: row.failure_count,
            last_practiced_at: row.last_practiced_at,
            last_success_at: row.last_success_at,
            model_version: row.model_version,
            state_version: row.state_version,
            updated_at: row.updated_at,
        })
    }
}

/// Applies one newly accepted observation on an open transaction.
///
/// The row is locked before it is read, so two events that touch the same
/// `(user, concept, mode)` cannot lose an update. When no row exists yet, the
/// first writer inserts it and a racing writer recomputes from the committed row
/// after its `ON CONFLICT` insert is skipped.
pub async fn apply(
    conn: &mut PgConnection,
    observation: &ConceptObservation<'_>,
) -> Result<ConceptState, DbError> {
    let key = Key::from_observation(observation);

    if let Some(previous) = key.load_for_update(conn).await? {
        let next = update_concept_state(Some(&previous), observation);
        save(conn, &next).await?;
        return Ok(next);
    }

    let next = update_concept_state(None, observation);
    if insert_if_absent(conn, &next).await? {
        return Ok(next);
    }

    let previous = key
        .load_for_update(conn)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let next = update_concept_state(Some(&previous), observation);
    save(conn, &next).await?;
    Ok(next)
}

/// Returns every derived state row for a learner and certification version.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    certification_version: &str,
) -> Result<Vec<ConceptState>, DbError> {
    let rows = sqlx::query_as::<_, ConceptStateRow>(
        "SELECT user_id, certification_version, concept_id, assessment_mode,
                estimate, evidence_mass, exposure_count, success_count, failure_count,
                last_practiced_at, last_success_at, model_version, state_version, updated_at
         FROM user_concept_state
         WHERE user_id = $1 AND certification_version = $2",
    )
    .bind(user_id)
    .bind(certification_version)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(TryInto::try_into).collect()
}

/// Returns one derived state row, if it exists.
pub async fn find_one(
    pool: &PgPool,
    user_id: Uuid,
    certification_version: &str,
    concept_id: &str,
    assessment_mode: AssessmentMode,
) -> Result<Option<ConceptState>, DbError> {
    let row = sqlx::query_as::<_, ConceptStateRow>(
        "SELECT user_id, certification_version, concept_id, assessment_mode,
                estimate, evidence_mass, exposure_count, success_count, failure_count,
                last_practiced_at, last_success_at, model_version, state_version, updated_at
         FROM user_concept_state
         WHERE user_id = $1 AND certification_version = $2
           AND concept_id = $3 AND assessment_mode = $4",
    )
    .bind(user_id)
    .bind(certification_version)
    .bind(concept_id)
    .bind(assessment_mode.as_str())
    .fetch_optional(pool)
    .await?;

    row.map(TryInto::try_into).transpose()
}

/// Identifies one derived state row.
struct Key {
    user_id: Uuid,
    certification_version: String,
    concept_id: String,
    assessment_mode: &'static str,
}

impl Key {
    fn from_observation(observation: &ConceptObservation<'_>) -> Self {
        Self {
            user_id: observation.user_id,
            certification_version: observation.certification_version.to_owned(),
            concept_id: observation.concept.concept_id.clone(),
            assessment_mode: observation.assessment_mode.as_str(),
        }
    }

    async fn load_for_update(
        &self,
        conn: &mut PgConnection,
    ) -> Result<Option<ConceptState>, DbError> {
        let row = sqlx::query_as::<_, ConceptStateRow>(
            "SELECT user_id, certification_version, concept_id, assessment_mode,
                    estimate, evidence_mass, exposure_count, success_count, failure_count,
                    last_practiced_at, last_success_at, model_version, state_version, updated_at
             FROM user_concept_state
             WHERE user_id = $1 AND certification_version = $2
               AND concept_id = $3 AND assessment_mode = $4
             FOR UPDATE",
        )
        .bind(self.user_id)
        .bind(&self.certification_version)
        .bind(&self.concept_id)
        .bind(self.assessment_mode)
        .fetch_optional(conn)
        .await?;

        row.map(TryInto::try_into).transpose()
    }
}

async fn insert_if_absent(conn: &mut PgConnection, state: &ConceptState) -> Result<bool, DbError> {
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO user_concept_state
            (user_id, certification_version, concept_id, assessment_mode,
             estimate, evidence_mass, exposure_count, success_count, failure_count,
             last_practiced_at, last_success_at, model_version, state_version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (user_id, certification_version, concept_id, assessment_mode) DO NOTHING
         RETURNING user_id",
    )
    .bind(state.user_id)
    .bind(&state.certification_version)
    .bind(&state.concept_id)
    .bind(state.assessment_mode.as_str())
    .bind(state.estimate)
    .bind(state.evidence_mass)
    .bind(state.exposure_count)
    .bind(state.success_count)
    .bind(state.failure_count)
    .bind(state.last_practiced_at)
    .bind(state.last_success_at)
    .bind(&state.model_version)
    .bind(state.state_version)
    .bind(state.updated_at)
    .fetch_optional(conn)
    .await?;

    Ok(inserted.is_some())
}

async fn save(conn: &mut PgConnection, state: &ConceptState) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE user_concept_state
         SET estimate = $5, evidence_mass = $6, exposure_count = $7, success_count = $8,
             failure_count = $9, last_practiced_at = $10, last_success_at = $11,
             model_version = $12, state_version = $13, updated_at = $14
         WHERE user_id = $1 AND certification_version = $2
           AND concept_id = $3 AND assessment_mode = $4",
    )
    .bind(state.user_id)
    .bind(&state.certification_version)
    .bind(&state.concept_id)
    .bind(state.assessment_mode.as_str())
    .bind(state.estimate)
    .bind(state.evidence_mass)
    .bind(state.exposure_count)
    .bind(state.success_count)
    .bind(state.failure_count)
    .bind(state.last_practiced_at)
    .bind(state.last_success_at)
    .bind(&state.model_version)
    .bind(state.state_version)
    .bind(state.updated_at)
    .execute(conn)
    .await?;

    Ok(())
}
