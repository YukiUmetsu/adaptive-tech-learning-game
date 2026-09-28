//! Persistence for Cyber Defense Stage 2 progression.
//!
//! Explicit SQL only: this module stores and loads progression state and never
//! applies business rules. Reward values, level curves, and cost rules live in
//! `adaptive_learn_domain::cyber_defense`; callers settle Bits through
//! [`crate::wallets`].
//!
//! Functions take a `&mut PgConnection` so a caller can compose several
//! progression changes into one transaction (for example an Operation
//! completion that awards Bits, career XP, hero XP, and adversary progress).

use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::DbError;

/// A learner's persistent Cyber Defense profile.
#[derive(Debug, Clone, PartialEq)]
pub struct CyberDefenseProfile {
    /// Owning learner.
    pub user_id: Uuid,
    /// Non-spendable career XP.
    pub career_xp: i64,
    /// Total completed repeatable Operations.
    pub total_operations_completed: i32,
    /// Highest Threat Level ever cleared.
    pub highest_threat_level_cleared: i32,
    /// Server-recommended Threat Level.
    pub recommended_threat_level: i32,
    /// Active story chapter id.
    pub active_story_chapter: String,
    /// Whether legacy local progress was imported once.
    pub legacy_progress_imported: bool,
    /// Equipped Tower theme cosmetic id, when one is equipped.
    pub equipped_theme: Option<String>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    user_id: Uuid,
    career_xp: i64,
    total_operations_completed: i32,
    highest_threat_level_cleared: i32,
    recommended_threat_level: i32,
    active_story_chapter: String,
    legacy_progress_imported: bool,
    equipped_theme: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ProfileRow> for CyberDefenseProfile {
    fn from(row: ProfileRow) -> Self {
        Self {
            user_id: row.user_id,
            career_xp: row.career_xp,
            total_operations_completed: row.total_operations_completed,
            highest_threat_level_cleared: row.highest_threat_level_cleared,
            recommended_threat_level: row.recommended_threat_level,
            active_story_chapter: row.active_story_chapter,
            legacy_progress_imported: row.legacy_progress_imported,
            equipped_theme: row.equipped_theme,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Returns the learner's profile, creating a default one on first access.
pub async fn get_or_create_profile(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<CyberDefenseProfile, DbError> {
    sqlx::query(
        "INSERT INTO cyber_defense_profiles (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(user_id)
    .execute(&mut *conn)
    .await?;

    let row = sqlx::query_as::<_, ProfileRow>(
        "SELECT user_id, career_xp, total_operations_completed,
                highest_threat_level_cleared, recommended_threat_level,
                active_story_chapter, legacy_progress_imported, equipped_theme,
                created_at, updated_at
         FROM cyber_defense_profiles
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// Returns the learner's profile if it already exists.
pub async fn get_profile(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<CyberDefenseProfile>, DbError> {
    let row = sqlx::query_as::<_, ProfileRow>(
        "SELECT user_id, career_xp, total_operations_completed,
                highest_threat_level_cleared, recommended_threat_level,
                active_story_chapter, legacy_progress_imported, equipped_theme,
                created_at, updated_at
         FROM cyber_defense_profiles
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(Into::into))
}

/// Adds career XP, returning the new total.
pub async fn increment_career_xp(
    conn: &mut PgConnection,
    user_id: Uuid,
    amount: i64,
) -> Result<i64, DbError> {
    let xp = sqlx::query_scalar::<_, i64>(
        "UPDATE cyber_defense_profiles
         SET career_xp = career_xp + $2, updated_at = now()
         WHERE user_id = $1
         RETURNING career_xp",
    )
    .bind(user_id)
    .bind(amount.max(0))
    .fetch_one(&mut *conn)
    .await?;

    Ok(xp)
}

/// Raises the profile's highest-cleared Threat Level and recommendation.
pub async fn update_threat_progress(
    conn: &mut PgConnection,
    user_id: Uuid,
    highest_cleared: i32,
    recommended: i32,
    operations_completed: i32,
) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE cyber_defense_profiles
         SET highest_threat_level_cleared =
                 GREATEST(highest_threat_level_cleared, $2),
             recommended_threat_level = $3,
             total_operations_completed =
                 total_operations_completed + $4,
             updated_at = now()
         WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(highest_cleared.max(0))
    .bind(recommended)
    .bind(operations_completed.max(0))
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Sets the active story chapter.
pub async fn set_active_story_chapter(
    conn: &mut PgConnection,
    user_id: Uuid,
    chapter: &str,
) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE cyber_defense_profiles
         SET active_story_chapter = $2, updated_at = now()
         WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(chapter)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Marks legacy local progress as imported. Returns `true` when this call
/// performed the transition (and thus may grant a one-time bonus).
pub async fn mark_legacy_progress_imported(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<bool, DbError> {
    let updated = sqlx::query_scalar::<_, Uuid>(
        "UPDATE cyber_defense_profiles
         SET legacy_progress_imported = TRUE, updated_at = now()
         WHERE user_id = $1 AND legacy_progress_imported = FALSE
         RETURNING user_id",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(updated.is_some())
}

/// A learner's persistent hero progression row.
#[derive(Debug, Clone, PartialEq)]
pub struct HeroProgress {
    /// Owning learner.
    pub user_id: Uuid,
    /// Hero identifier.
    pub hero_id: String,
    /// Non-spendable hero XP.
    pub xp: i64,
    /// Selected talent choices, keyed by milestone.
    pub selected_talents: serde_json::Value,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct HeroProgressRow {
    user_id: Uuid,
    hero_id: String,
    xp: i64,
    selected_talents: Json<serde_json::Value>,
    updated_at: DateTime<Utc>,
}

impl From<HeroProgressRow> for HeroProgress {
    fn from(row: HeroProgressRow) -> Self {
        Self {
            user_id: row.user_id,
            hero_id: row.hero_id,
            xp: row.xp,
            selected_talents: row.selected_talents.0,
            updated_at: row.updated_at,
        }
    }
}

/// Lists a learner's hero progression rows.
pub async fn list_hero_progress(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<HeroProgress>, DbError> {
    let rows = sqlx::query_as::<_, HeroProgressRow>(
        "SELECT user_id, hero_id, xp, selected_talents, updated_at
         FROM cyber_hero_progress
         WHERE user_id = $1
         ORDER BY hero_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Adds hero XP, creating the row on first award. Returns the new total.
pub async fn increment_hero_xp(
    conn: &mut PgConnection,
    user_id: Uuid,
    hero_id: &str,
    amount: i64,
) -> Result<i64, DbError> {
    let xp = sqlx::query_scalar::<_, i64>(
        "INSERT INTO cyber_hero_progress (user_id, hero_id, xp)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, hero_id)
         DO UPDATE SET xp = cyber_hero_progress.xp + EXCLUDED.xp,
                       updated_at = now()
         RETURNING xp",
    )
    .bind(user_id)
    .bind(hero_id)
    .bind(amount.max(0))
    .fetch_one(&mut *conn)
    .await?;

    Ok(xp)
}

/// Stores a hero's selected talents, replacing any previous selection.
pub async fn set_hero_talents(
    conn: &mut PgConnection,
    user_id: Uuid,
    hero_id: &str,
    talents: &serde_json::Value,
) -> Result<HeroProgress, DbError> {
    let row = sqlx::query_as::<_, HeroProgressRow>(
        "INSERT INTO cyber_hero_progress (user_id, hero_id, selected_talents)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, hero_id)
         DO UPDATE SET selected_talents = EXCLUDED.selected_talents,
                       updated_at = now()
         RETURNING user_id, hero_id, xp, selected_talents, updated_at",
    )
    .bind(user_id)
    .bind(hero_id)
    .bind(Json(talents))
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// One Tower/HQ room upgrade level.
#[derive(Debug, Clone, PartialEq)]
pub struct TowerUpgrade {
    /// Owning learner.
    pub user_id: Uuid,
    /// Upgrade (room) identifier.
    pub upgrade_id: String,
    /// Current level.
    pub level: i32,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct TowerUpgradeRow {
    user_id: Uuid,
    upgrade_id: String,
    level: i32,
    updated_at: DateTime<Utc>,
}

impl From<TowerUpgradeRow> for TowerUpgrade {
    fn from(row: TowerUpgradeRow) -> Self {
        Self {
            user_id: row.user_id,
            upgrade_id: row.upgrade_id,
            level: row.level,
            updated_at: row.updated_at,
        }
    }
}

/// Lists a learner's Tower/HQ upgrade levels.
pub async fn list_tower_upgrades(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<TowerUpgrade>, DbError> {
    let rows = sqlx::query_as::<_, TowerUpgradeRow>(
        "SELECT user_id, upgrade_id, level, updated_at
         FROM cyber_tower_upgrades
         WHERE user_id = $1
         ORDER BY upgrade_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Returns one Tower upgrade level, defaulting to `0` when never purchased.
pub async fn get_tower_upgrade_level(
    conn: &mut PgConnection,
    user_id: Uuid,
    upgrade_id: &str,
) -> Result<i32, DbError> {
    let level = sqlx::query_scalar::<_, i32>(
        "SELECT level FROM cyber_tower_upgrades
         WHERE user_id = $1 AND upgrade_id = $2",
    )
    .bind(user_id)
    .bind(upgrade_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(level.unwrap_or(0))
}

/// Increments one Tower upgrade level by one, returning the new level.
pub async fn increment_tower_upgrade(
    conn: &mut PgConnection,
    user_id: Uuid,
    upgrade_id: &str,
) -> Result<i32, DbError> {
    let level = sqlx::query_scalar::<_, i32>(
        "INSERT INTO cyber_tower_upgrades (user_id, upgrade_id, level)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, upgrade_id)
         DO UPDATE SET level = cyber_tower_upgrades.level + 1,
                       updated_at = now()
         RETURNING level",
    )
    .bind(user_id)
    .bind(upgrade_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(level)
}

/// A learner's progress against one recurring adversary.
#[derive(Debug, Clone, PartialEq)]
pub struct AdversaryProgress {
    /// Owning learner.
    pub user_id: Uuid,
    /// Adversary identifier.
    pub adversary_id: String,
    /// Accumulated progress (never regresses).
    pub progress: i64,
    /// Total encounters.
    pub encounters: i32,
    /// Total victories.
    pub victories: i32,
    /// Highest Threat Level cleared against this adversary.
    pub highest_threat_level_cleared: i32,
    /// Unlocked dossier flags.
    pub dossier_flags: Vec<String>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct AdversaryProgressRow {
    user_id: Uuid,
    adversary_id: String,
    progress: i64,
    encounters: i32,
    victories: i32,
    highest_threat_level_cleared: i32,
    dossier_flags: Json<Vec<String>>,
    updated_at: DateTime<Utc>,
}

impl From<AdversaryProgressRow> for AdversaryProgress {
    fn from(row: AdversaryProgressRow) -> Self {
        Self {
            user_id: row.user_id,
            adversary_id: row.adversary_id,
            progress: row.progress,
            encounters: row.encounters,
            victories: row.victories,
            highest_threat_level_cleared: row.highest_threat_level_cleared,
            dossier_flags: row.dossier_flags.0,
            updated_at: row.updated_at,
        }
    }
}

/// Lists a learner's adversary progress rows.
pub async fn list_adversary_progress(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<AdversaryProgress>, DbError> {
    let rows = sqlx::query_as::<_, AdversaryProgressRow>(
        "SELECT user_id, adversary_id, progress, encounters, victories,
                highest_threat_level_cleared, dossier_flags, updated_at
         FROM cyber_adversary_progress
         WHERE user_id = $1
         ORDER BY adversary_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Applies one encounter's progress to an adversary, returning the updated row.
pub async fn apply_adversary_encounter(
    conn: &mut PgConnection,
    user_id: Uuid,
    adversary_id: &str,
    progress_delta: i64,
    encounter: bool,
    victory: bool,
    highest_threat_cleared: i32,
) -> Result<AdversaryProgress, DbError> {
    let row = sqlx::query_as::<_, AdversaryProgressRow>(
        "INSERT INTO cyber_adversary_progress
             (user_id, adversary_id, progress, encounters, victories,
              highest_threat_level_cleared)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, adversary_id) DO UPDATE SET
             progress = cyber_adversary_progress.progress + EXCLUDED.progress,
             encounters = cyber_adversary_progress.encounters + EXCLUDED.encounters,
             victories = cyber_adversary_progress.victories + EXCLUDED.victories,
             highest_threat_level_cleared = GREATEST(
                 cyber_adversary_progress.highest_threat_level_cleared,
                 EXCLUDED.highest_threat_level_cleared
             ),
             updated_at = now()
         RETURNING user_id, adversary_id, progress, encounters, victories,
                   highest_threat_level_cleared, dossier_flags, updated_at",
    )
    .bind(user_id)
    .bind(adversary_id)
    .bind(progress_delta.max(0))
    .bind(if encounter { 1 } else { 0 })
    .bind(if victory { 1 } else { 0 })
    .bind(highest_threat_cleared.max(0))
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// Adds dossier flags, returning the full set after the union.
///
/// Idempotent: re-adding a known flag leaves the stored set unchanged.
pub async fn add_dossier_flags(
    conn: &mut PgConnection,
    user_id: Uuid,
    adversary_id: &str,
    flags: &[String],
) -> Result<Vec<String>, DbError> {
    let existing = sqlx::query_scalar::<_, Json<Vec<String>>>(
        "SELECT dossier_flags FROM cyber_adversary_progress
         WHERE user_id = $1 AND adversary_id = $2",
    )
    .bind(user_id)
    .bind(adversary_id)
    .fetch_optional(&mut *conn)
    .await?;

    let mut merged = existing.map(|Json(value)| value).unwrap_or_default();
    for flag in flags {
        if !merged.iter().any(|known| known == flag) {
            merged.push(flag.clone());
        }
    }
    merged.sort();

    sqlx::query(
        "INSERT INTO cyber_adversary_progress (user_id, adversary_id, dossier_flags)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, adversary_id)
         DO UPDATE SET dossier_flags = EXCLUDED.dossier_flags, updated_at = now()",
    )
    .bind(user_id)
    .bind(adversary_id)
    .bind(Json(&merged))
    .execute(&mut *conn)
    .await?;

    Ok(merged)
}

/// One completed story node.
#[derive(Debug, Clone, PartialEq)]
pub struct StoryProgress {
    /// Story node identifier.
    pub story_node_id: String,
    /// When the node was acknowledged.
    pub completed_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct StoryProgressRow {
    story_node_id: String,
    completed_at: DateTime<Utc>,
}

/// Lists completed story nodes for a learner.
pub async fn list_story_progress(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<StoryProgress>, DbError> {
    let rows = sqlx::query_as::<_, StoryProgressRow>(
        "SELECT story_node_id, completed_at
         FROM cyber_story_progress
         WHERE user_id = $1
         ORDER BY completed_at, story_node_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| StoryProgress {
            story_node_id: row.story_node_id,
            completed_at: row.completed_at,
        })
        .collect())
}

/// Records a story node as acknowledged. Returns `true` when newly recorded.
pub async fn record_story_progress(
    conn: &mut PgConnection,
    user_id: Uuid,
    story_node_id: &str,
) -> Result<bool, DbError> {
    let inserted = sqlx::query_scalar::<_, String>(
        "INSERT INTO cyber_story_progress (user_id, story_node_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, story_node_id) DO NOTHING
         RETURNING story_node_id",
    )
    .bind(user_id)
    .bind(story_node_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(inserted.is_some())
}

/// Imports one legacy local campaign result without granting retroactive Bits.
///
/// Unlike [`upsert_campaign_result`], the imported attempt count replaces the
/// stored value only when it is larger. A completion imported here is recorded
/// as `first_clear_reward_settled` so imported progress can never claim a
/// first-clear reward later; a non-completed import leaves that flag untouched,
/// so a mission the learner genuinely still has to clear remains rewardable.
pub async fn import_campaign_result(
    conn: &mut PgConnection,
    user_id: Uuid,
    mission_id: &str,
    completed: bool,
    stars: i32,
    health: i32,
    attempts: i32,
) -> Result<CampaignResult, DbError> {
    let row = sqlx::query_as::<_, CampaignResultRow>(
        "INSERT INTO cyber_campaign_results
             (user_id, mission_id, completed, best_stars, best_health, attempts,
              first_clear_reward_settled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, mission_id) DO UPDATE SET
             completed = cyber_campaign_results.completed OR EXCLUDED.completed,
             best_stars = GREATEST(cyber_campaign_results.best_stars, EXCLUDED.best_stars),
             best_health = GREATEST(cyber_campaign_results.best_health, EXCLUDED.best_health),
             attempts = GREATEST(cyber_campaign_results.attempts, EXCLUDED.attempts),
             first_clear_reward_settled =
                 cyber_campaign_results.first_clear_reward_settled
                 OR EXCLUDED.first_clear_reward_settled,
             updated_at = now()
         RETURNING user_id, mission_id, completed, best_stars, best_health,
                   attempts, first_clear_reward_settled, updated_at",
    )
    .bind(user_id)
    .bind(mission_id)
    .bind(completed)
    .bind(stars.clamp(0, 3))
    .bind(health.max(0))
    .bind(attempts.max(0))
    .bind(completed)
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// A learner's authoritative result for one Stage 1 campaign mission.
#[derive(Debug, Clone, PartialEq)]
pub struct CampaignResult {
    /// Owning learner.
    pub user_id: Uuid,
    /// Campaign mission identifier.
    pub mission_id: String,
    /// Whether the mission was ever completed.
    pub completed: bool,
    /// Best stars earned.
    pub best_stars: i32,
    /// Best remaining health.
    pub best_health: i32,
    /// Total recorded attempts.
    pub attempts: i32,
    /// Whether the one-time first-clear reward was settled.
    pub first_clear_reward_settled: bool,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct CampaignResultRow {
    user_id: Uuid,
    mission_id: String,
    completed: bool,
    best_stars: i32,
    best_health: i32,
    attempts: i32,
    first_clear_reward_settled: bool,
    updated_at: DateTime<Utc>,
}

impl From<CampaignResultRow> for CampaignResult {
    fn from(row: CampaignResultRow) -> Self {
        Self {
            user_id: row.user_id,
            mission_id: row.mission_id,
            completed: row.completed,
            best_stars: row.best_stars,
            best_health: row.best_health,
            attempts: row.attempts,
            first_clear_reward_settled: row.first_clear_reward_settled,
            updated_at: row.updated_at,
        }
    }
}

/// Lists campaign results for a learner.
pub async fn list_campaign_results(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<CampaignResult>, DbError> {
    let rows = sqlx::query_as::<_, CampaignResultRow>(
        "SELECT user_id, mission_id, completed, best_stars, best_health,
                attempts, first_clear_reward_settled, updated_at
         FROM cyber_campaign_results
         WHERE user_id = $1
         ORDER BY mission_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Returns one campaign result if it exists.
pub async fn get_campaign_result(
    conn: &mut PgConnection,
    user_id: Uuid,
    mission_id: &str,
) -> Result<Option<CampaignResult>, DbError> {
    let row = sqlx::query_as::<_, CampaignResultRow>(
        "SELECT user_id, mission_id, completed, best_stars, best_health,
                attempts, first_clear_reward_settled, updated_at
         FROM cyber_campaign_results
         WHERE user_id = $1 AND mission_id = $2",
    )
    .bind(user_id)
    .bind(mission_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Records one campaign attempt, merging bests. Returns the updated result.
pub async fn upsert_campaign_result(
    conn: &mut PgConnection,
    user_id: Uuid,
    mission_id: &str,
    completed: bool,
    stars: i32,
    health: i32,
    first_clear_reward_settled: bool,
) -> Result<CampaignResult, DbError> {
    let row = sqlx::query_as::<_, CampaignResultRow>(
        "INSERT INTO cyber_campaign_results
             (user_id, mission_id, completed, best_stars, best_health, attempts,
              first_clear_reward_settled)
         VALUES ($1, $2, $3, $4, $5, 1, $6)
         ON CONFLICT (user_id, mission_id) DO UPDATE SET
             completed = cyber_campaign_results.completed OR EXCLUDED.completed,
             best_stars = GREATEST(cyber_campaign_results.best_stars, EXCLUDED.best_stars),
             best_health = GREATEST(cyber_campaign_results.best_health, EXCLUDED.best_health),
             attempts = cyber_campaign_results.attempts + 1,
             first_clear_reward_settled = cyber_campaign_results.first_clear_reward_settled
                 OR EXCLUDED.first_clear_reward_settled,
             updated_at = now()
         RETURNING user_id, mission_id, completed, best_stars, best_health,
                   attempts, first_clear_reward_settled, updated_at",
    )
    .bind(user_id)
    .bind(mission_id)
    .bind(completed)
    .bind(stars.clamp(0, 3))
    .bind(health.max(0))
    .bind(first_clear_reward_settled)
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// A server-issued repeatable Operation run.
#[derive(Debug, Clone, PartialEq)]
pub struct OperationRun {
    /// Run identifier.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Deterministic generation seed.
    pub seed: i64,
    /// Operation template identifier.
    pub template_id: String,
    /// Adversary identifier.
    pub adversary_id: String,
    /// Selected hero identifier.
    pub hero_id: Option<String>,
    /// Selected Threat Level.
    pub threat_level: i32,
    /// `active`, `completed`, `failed`, or `abandoned`.
    pub status: String,
    /// Full generated Operation snapshot.
    pub generated_config: serde_json::Value,
    /// Start time.
    pub started_at: DateTime<Utc>,
    /// Completion time.
    pub completed_at: Option<DateTime<Utc>>,
    /// Result stars.
    pub result_stars: Option<i32>,
    /// Result remaining health.
    pub result_health: Option<i32>,
    /// Result duration in milliseconds.
    pub duration_ms: Option<i64>,
    /// Bits awarded.
    pub bits_awarded: i64,
    /// Career XP awarded.
    pub career_xp_awarded: i64,
    /// Hero XP awarded.
    pub hero_xp_awarded: i64,
    /// Reward idempotency event id.
    pub reward_event_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct OperationRunRow {
    id: Uuid,
    user_id: Uuid,
    seed: i64,
    template_id: String,
    adversary_id: String,
    hero_id: Option<String>,
    threat_level: i32,
    status: String,
    generated_config: Json<serde_json::Value>,
    started_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    result_stars: Option<i32>,
    result_health: Option<i32>,
    duration_ms: Option<i64>,
    bits_awarded: i64,
    career_xp_awarded: i64,
    hero_xp_awarded: i64,
    reward_event_id: Option<Uuid>,
}

impl From<OperationRunRow> for OperationRun {
    fn from(row: OperationRunRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            seed: row.seed,
            template_id: row.template_id,
            adversary_id: row.adversary_id,
            hero_id: row.hero_id,
            threat_level: row.threat_level,
            status: row.status,
            generated_config: row.generated_config.0,
            started_at: row.started_at,
            completed_at: row.completed_at,
            result_stars: row.result_stars,
            result_health: row.result_health,
            duration_ms: row.duration_ms,
            bits_awarded: row.bits_awarded,
            career_xp_awarded: row.career_xp_awarded,
            hero_xp_awarded: row.hero_xp_awarded,
            reward_event_id: row.reward_event_id,
        }
    }
}

/// Fields needed to persist a freshly generated Operation.
#[derive(Debug, Clone)]
pub struct NewOperationRun<'a> {
    /// Run identifier.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Deterministic generation seed.
    pub seed: i64,
    /// Operation template identifier.
    pub template_id: &'a str,
    /// Adversary identifier.
    pub adversary_id: &'a str,
    /// Selected hero identifier.
    pub hero_id: Option<&'a str>,
    /// Selected Threat Level.
    pub threat_level: i32,
    /// Full generated Operation snapshot.
    pub generated_config: &'a serde_json::Value,
}

/// Persists a newly generated Operation run.
pub async fn create_operation_run(
    conn: &mut PgConnection,
    run: &NewOperationRun<'_>,
) -> Result<OperationRun, DbError> {
    let row = sqlx::query_as::<_, OperationRunRow>(
        "INSERT INTO cyber_operation_runs
             (id, user_id, seed, template_id, adversary_id, hero_id, threat_level,
              status, generated_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         RETURNING id, user_id, seed, template_id, adversary_id, hero_id,
                   threat_level, status, generated_config, started_at, completed_at,
                   result_stars, result_health, duration_ms, bits_awarded,
                   career_xp_awarded, hero_xp_awarded, reward_event_id",
    )
    .bind(run.id)
    .bind(run.user_id)
    .bind(run.seed)
    .bind(run.template_id)
    .bind(run.adversary_id)
    .bind(run.hero_id)
    .bind(run.threat_level)
    .bind(Json(run.generated_config))
    .fetch_one(&mut *conn)
    .await?;

    Ok(row.into())
}

/// Loads one Operation run owned by `user_id`.
pub async fn get_operation_run_for_user(
    conn: &mut PgConnection,
    user_id: Uuid,
    run_id: Uuid,
) -> Result<Option<OperationRun>, DbError> {
    let row = sqlx::query_as::<_, OperationRunRow>(
        "SELECT id, user_id, seed, template_id, adversary_id, hero_id,
                threat_level, status, generated_config, started_at, completed_at,
                result_stars, result_health, duration_ms, bits_awarded,
                career_xp_awarded, hero_xp_awarded, reward_event_id
         FROM cyber_operation_runs
         WHERE id = $1 AND user_id = $2",
    )
    .bind(run_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Loads one Operation run and locks it for update.
pub async fn lock_operation_run(
    conn: &mut PgConnection,
    user_id: Uuid,
    run_id: Uuid,
) -> Result<Option<OperationRun>, DbError> {
    let row = sqlx::query_as::<_, OperationRunRow>(
        "SELECT id, user_id, seed, template_id, adversary_id, hero_id,
                threat_level, status, generated_config, started_at, completed_at,
                result_stars, result_health, duration_ms, bits_awarded,
                career_xp_awarded, hero_xp_awarded, reward_event_id
         FROM cyber_operation_runs
         WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(run_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Returns the learner's active Operation run, if any.
pub async fn find_active_operation_run(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Option<OperationRun>, DbError> {
    let row = sqlx::query_as::<_, OperationRunRow>(
        "SELECT id, user_id, seed, template_id, adversary_id, hero_id,
                threat_level, status, generated_config, started_at, completed_at,
                result_stars, result_health, duration_ms, bits_awarded,
                career_xp_awarded, hero_xp_awarded, reward_event_id
         FROM cyber_operation_runs
         WHERE user_id = $1 AND status = 'active'
         ORDER BY started_at DESC
         LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Marks an active run abandoned. Returns `true` when a row changed.
pub async fn abandon_operation_run(
    conn: &mut PgConnection,
    user_id: Uuid,
    run_id: Uuid,
) -> Result<bool, DbError> {
    let updated = sqlx::query_scalar::<_, Uuid>(
        "UPDATE cyber_operation_runs
         SET status = 'abandoned', completed_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id",
    )
    .bind(run_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(updated.is_some())
}

/// Fields recorded when an Operation run settles.
#[derive(Debug, Clone, Copy)]
pub struct OperationResultUpdate {
    /// Whether the Operation was completed.
    pub completed: bool,
    /// Stars earned.
    pub stars: i32,
    /// Remaining system health.
    pub health: i32,
    /// Duration in milliseconds.
    pub duration_ms: i64,
    /// Bits awarded.
    pub bits: i64,
    /// Career XP awarded.
    pub career_xp: i64,
    /// Hero XP awarded.
    pub hero_xp: i64,
    /// Reward idempotency event id.
    pub reward_event_id: Uuid,
}

/// Settles an active Operation run with its result and rewards.
///
/// Only an `active` run can settle, so a duplicate completion changes nothing.
pub async fn complete_operation_run(
    conn: &mut PgConnection,
    user_id: Uuid,
    run_id: Uuid,
    result: &OperationResultUpdate,
) -> Result<Option<OperationRun>, DbError> {
    let status = if result.completed {
        "completed"
    } else {
        "failed"
    };
    let row = sqlx::query_as::<_, OperationRunRow>(
        "UPDATE cyber_operation_runs
         SET status = $3,
             completed_at = now(),
             result_stars = $4,
             result_health = $5,
             duration_ms = $6,
             bits_awarded = $7,
             career_xp_awarded = $8,
             hero_xp_awarded = $9,
             reward_event_id = $10
         WHERE id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id, user_id, seed, template_id, adversary_id, hero_id,
                   threat_level, status, generated_config, started_at, completed_at,
                   result_stars, result_health, duration_ms, bits_awarded,
                   career_xp_awarded, hero_xp_awarded, reward_event_id",
    )
    .bind(run_id)
    .bind(user_id)
    .bind(status)
    .bind(result.stars.clamp(0, 3))
    .bind(result.health.max(0))
    .bind(result.duration_ms.max(0))
    .bind(result.bits.max(0))
    .bind(result.career_xp.max(0))
    .bind(result.hero_xp.max(0))
    .bind(result.reward_event_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Counts campaign missions completed by a learner.
pub async fn count_completed_campaign_missions(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cyber_campaign_results
         WHERE user_id = $1 AND completed = TRUE",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count)
}

/// Lists distinct Operation templates the learner has completed.
///
/// Used by story evaluation so the Stage 2 climax resolves on a real battle.
pub async fn list_completed_operation_templates(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT template_id FROM cyber_operation_runs
         WHERE user_id = $1 AND status = 'completed'
         ORDER BY template_id",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows)
}

/// Replaces an active run's generated config (Engineering Lab loadout).
///
/// Only an `active` run can be changed, so a loadout cannot be edited after the
/// result is settled.
pub async fn update_operation_run_config(
    conn: &mut PgConnection,
    user_id: Uuid,
    run_id: Uuid,
    generated_config: &serde_json::Value,
) -> Result<Option<OperationRun>, DbError> {
    let row = sqlx::query_as::<_, OperationRunRow>(
        "UPDATE cyber_operation_runs
         SET generated_config = $3
         WHERE id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id, user_id, seed, template_id, adversary_id, hero_id,
                   threat_level, status, generated_config, started_at, completed_at,
                   result_stars, result_health, duration_ms, bits_awarded,
                   career_xp_awarded, hero_xp_awarded, reward_event_id",
    )
    .bind(run_id)
    .bind(user_id)
    .bind(Json(generated_config))
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Claims an idempotency key for a one-off reward settlement.
///
/// Returns `true` when the key is new (the caller may settle), and `false` when
/// the same result was already settled (the caller must not reward again).
pub async fn claim_reward_event(
    conn: &mut PgConnection,
    event_id: Uuid,
    user_id: Uuid,
    kind: &str,
) -> Result<bool, DbError> {
    let claimed = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO cyber_reward_events (event_id, user_id, kind)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id",
    )
    .bind(event_id)
    .bind(user_id)
    .bind(kind)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(claimed.is_some())
}

/// One recent settled Operation result, used by the recommendation rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RecentOperationOutcome {
    /// Whether the Operation was completed.
    pub completed: bool,
    /// Stars earned.
    pub stars: i32,
    /// Remaining health.
    pub health: i32,
    /// Starting health recorded in the run snapshot.
    pub starting_health: i32,
}

#[derive(sqlx::FromRow)]
struct RecentOperationOutcomeRow {
    completed: bool,
    stars: i32,
    health: i32,
    starting_health: i32,
}

/// Lists the most recent settled Operation outcomes, newest first.
pub async fn list_recent_operation_outcomes(
    conn: &mut PgConnection,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<RecentOperationOutcome>, DbError> {
    let rows = sqlx::query_as::<_, RecentOperationOutcomeRow>(
        "SELECT status = 'completed' AS completed,
                COALESCE(result_stars, 0) AS stars,
                COALESCE(result_health, 0) AS health,
                COALESCE((generated_config->>'starting_health')::int, 100) AS starting_health
         FROM cyber_operation_runs
         WHERE user_id = $1
           AND status IN ('completed', 'failed')
           AND result_health IS NOT NULL
         ORDER BY completed_at DESC NULLS LAST, started_at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit.clamp(1, 50))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| RecentOperationOutcome {
            completed: row.completed,
            stars: row.stars,
            health: row.health,
            starting_health: row.starting_health,
        })
        .collect())
}

/// Counts reward-bearing Operations settled since a cutoff.
///
/// Used by the settlement rate guard. Abandoned and still-active runs are not
/// counted, so the guard only limits actual reward settlements.
pub async fn count_settled_operations_since(
    conn: &mut PgConnection,
    user_id: Uuid,
    since: DateTime<Utc>,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cyber_operation_runs
         WHERE user_id = $1
           AND status IN ('completed', 'failed')
           AND completed_at IS NOT NULL
           AND completed_at >= $2",
    )
    .bind(user_id)
    .bind(since)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count)
}

/// One recently started Operation's template/adversary identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationIdentity {
    /// Template identifier.
    pub template_id: String,
    /// Adversary identifier.
    pub adversary_id: String,
}

#[derive(sqlx::FromRow)]
struct OperationIdentityRow {
    template_id: String,
    adversary_id: String,
}

/// Lists recent Operation identities, newest first, for anti-repetition.
///
/// Includes abandoned runs so rapidly abandoned repeats still count as
/// "recently seen"; the caller decides how many to consider.
pub async fn list_recent_operation_identities(
    conn: &mut PgConnection,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<OperationIdentity>, DbError> {
    let rows = sqlx::query_as::<_, OperationIdentityRow>(
        "SELECT template_id, adversary_id
         FROM cyber_operation_runs
         WHERE user_id = $1
         ORDER BY started_at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit.clamp(1, 50))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| OperationIdentity {
            template_id: row.template_id,
            adversary_id: row.adversary_id,
        })
        .collect())
}

/// A server-issued Operation offer awaiting a player's choice.
#[derive(Debug, Clone, PartialEq)]
pub struct OperationOffer {
    /// Offer identifier.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Deterministic preview/run seed.
    pub seed: i64,
    /// Template identifier.
    pub template_id: String,
    /// Adversary identifier.
    pub adversary_id: String,
    /// Adversary rank captured at offer time.
    pub adversary_rank: i32,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Expiry time.
    pub expires_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct OperationOfferRow {
    id: Uuid,
    user_id: Uuid,
    seed: i64,
    template_id: String,
    adversary_id: String,
    adversary_rank: i32,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

impl From<OperationOfferRow> for OperationOffer {
    fn from(row: OperationOfferRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            seed: row.seed,
            template_id: row.template_id,
            adversary_id: row.adversary_id,
            adversary_rank: row.adversary_rank,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }
    }
}

/// One offer to persist.
#[derive(Debug, Clone)]
pub struct NewOperationOffer<'a> {
    /// Offer id.
    pub id: Uuid,
    /// Owning learner.
    pub user_id: Uuid,
    /// Preview/run seed.
    pub seed: i64,
    /// Template id.
    pub template_id: &'a str,
    /// Adversary id.
    pub adversary_id: &'a str,
    /// Adversary rank.
    pub adversary_rank: i32,
    /// Expiry.
    pub expires_at: DateTime<Utc>,
}

/// Inserts a batch of Operation offers.
pub async fn insert_operation_offers(
    conn: &mut PgConnection,
    offers: &[NewOperationOffer<'_>],
) -> Result<(), DbError> {
    for offer in offers {
        sqlx::query(
            "INSERT INTO cyber_operation_offers
                 (id, user_id, seed, template_id, adversary_id, adversary_rank, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(offer.id)
        .bind(offer.user_id)
        .bind(offer.seed)
        .bind(offer.template_id)
        .bind(offer.adversary_id)
        .bind(offer.adversary_rank)
        .bind(offer.expires_at)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Lists a learner's outstanding (unconsumed, unexpired) offers, newest first.
pub async fn list_active_operation_offers(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<OperationOffer>, DbError> {
    let rows = sqlx::query_as::<_, OperationOfferRow>(
        "SELECT id, user_id, seed, template_id, adversary_id, adversary_rank,
                created_at, expires_at
         FROM cyber_operation_offers
         WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Deletes a learner's expired or consumed offers (small housekeeping).
pub async fn delete_stale_operation_offers(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query(
        "DELETE FROM cyber_operation_offers
         WHERE user_id = $1 AND (consumed_at IS NOT NULL OR expires_at <= now())",
    )
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Consumes one offer. Returns it only when it was outstanding and unexpired.
pub async fn consume_operation_offer(
    conn: &mut PgConnection,
    user_id: Uuid,
    offer_id: Uuid,
) -> Result<Option<OperationOffer>, DbError> {
    let row = sqlx::query_as::<_, OperationOfferRow>(
        "UPDATE cyber_operation_offers
         SET consumed_at = now()
         WHERE id = $1 AND user_id = $2
           AND consumed_at IS NULL AND expires_at > now()
         RETURNING id, user_id, seed, template_id, adversary_id, adversary_rank,
                   created_at, expires_at",
    )
    .bind(offer_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(Into::into))
}

/// Lists a learner's permanently unlocked cosmetic ids.
pub async fn list_cosmetic_unlocks(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT cosmetic_id FROM cyber_cosmetic_unlocks
         WHERE user_id = $1
         ORDER BY unlocked_at",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows)
}

/// Records a cosmetic unlock. Returns `false` when it was already owned, so a
/// duplicate purchase is idempotent.
pub async fn unlock_cosmetic(
    conn: &mut PgConnection,
    user_id: Uuid,
    cosmetic_id: &str,
) -> Result<bool, DbError> {
    let inserted = sqlx::query_scalar::<_, String>(
        "INSERT INTO cyber_cosmetic_unlocks (user_id, cosmetic_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, cosmetic_id) DO NOTHING
         RETURNING cosmetic_id",
    )
    .bind(user_id)
    .bind(cosmetic_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(inserted.is_some())
}

/// Sets (or clears) the equipped Tower theme.
pub async fn set_equipped_theme(
    conn: &mut PgConnection,
    user_id: Uuid,
    theme_id: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE cyber_defense_profiles
         SET equipped_theme = $2, updated_at = now()
         WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(theme_id)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// One balance-telemetry event to append.
#[derive(Debug, Clone)]
pub struct NewTelemetryEvent<'a> {
    /// Event name, for example `cyber_operation_started`.
    pub event_name: &'a str,
    /// Operation run id, when relevant.
    pub run_id: Option<Uuid>,
    /// Operation template id, when relevant.
    pub template_id: Option<&'a str>,
    /// Adversary id, when relevant.
    pub adversary_id: Option<&'a str>,
    /// Threat Level, when relevant.
    pub threat_level: Option<i32>,
    /// Hero id, when relevant.
    pub hero_id: Option<&'a str>,
    /// Defense id, when relevant.
    pub defense_id: Option<&'a str>,
    /// Wave index, when relevant.
    pub wave: Option<i32>,
    /// Result label, when relevant.
    pub result: Option<&'a str>,
    /// Stars, when relevant.
    pub stars: Option<i32>,
    /// Duration bucket label, when relevant.
    pub duration_bucket: Option<&'a str>,
}

/// Appends a batch of telemetry events for one learner.
pub async fn insert_telemetry_events(
    conn: &mut PgConnection,
    user_id: Uuid,
    events: &[NewTelemetryEvent<'_>],
) -> Result<(), DbError> {
    for event in events {
        sqlx::query(
            "INSERT INTO cyber_telemetry_events
                 (user_id, event_name, run_id, template_id, adversary_id, threat_level,
                  hero_id, defense_id, wave, result, stars, duration_bucket)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(user_id)
        .bind(event.event_name)
        .bind(event.run_id)
        .bind(event.template_id)
        .bind(event.adversary_id)
        .bind(event.threat_level)
        .bind(event.hero_id)
        .bind(event.defense_id)
        .bind(event.wave)
        .bind(event.result)
        .bind(event.stars)
        .bind(event.duration_bucket)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
