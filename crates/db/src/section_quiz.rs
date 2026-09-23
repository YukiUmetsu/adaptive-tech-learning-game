//! One-time Bits settlement for completed learning-section quizzes.
//!
//! A section quiz is a single-question mission that concludes a learning
//! module. Its completion bonus is settled at most once per learner and section
//! (certification version + domain + module), so retaking the quiz cannot award
//! the bonus twice. The reward row id is reused as the wallet ledger event id,
//! which makes settlement idempotent by primary key.

use sqlx::PgConnection;
use uuid::Uuid;

use crate::{DbError, wallets};

/// Inputs for one section-quiz completion settlement.
pub struct SectionQuizSettlement<'a> {
    /// Authenticated learner who owns the wallet.
    pub user_id: Uuid,
    /// Certification identifier the section belongs to.
    pub track_id: &'a str,
    /// Certification version identifier the section belongs to.
    pub track_version: &'a str,
    /// Exam domain identifier of the section.
    pub domain_id: &'a str,
    /// Learning module (section) identifier.
    pub module_id: &'a str,
    /// Mission whose completion earned the bonus.
    pub mission_instance_id: Uuid,
    /// Bonus amount in Bits. Zero or negative awards are ignored.
    pub amount: i64,
}

/// Settles the section-quiz completion bonus on an open transaction.
///
/// Returns `true` when a new reward row and wallet credit were written. A
/// duplicate (user, section) scope leaves the balance untouched and returns
/// `false`, so a retried mission completion is safe.
pub async fn settle_bonus(
    conn: &mut PgConnection,
    settlement: SectionQuizSettlement<'_>,
) -> Result<bool, DbError> {
    if settlement.amount <= 0 {
        return Ok(false);
    }

    let reward_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO section_quiz_rewards
            (user_id, track_id, track_version, domain_id, module_id,
             mission_instance_id, reward_bits)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, track_version, domain_id, module_id) DO NOTHING
         RETURNING id",
    )
    .bind(settlement.user_id)
    .bind(settlement.track_id)
    .bind(settlement.track_version)
    .bind(settlement.domain_id)
    .bind(settlement.module_id)
    .bind(settlement.mission_instance_id)
    .bind(settlement.amount)
    .fetch_optional(&mut *conn)
    .await?;

    let Some(reward_id) = reward_id else {
        return Ok(false);
    };

    let ledger = wallets::BitTransaction {
        user_id: settlement.user_id,
        device_id: None,
        // The reward row id makes the wallet credit idempotent by event id.
        event_id: reward_id,
        mission_instance_id: settlement.mission_instance_id,
        question_id: "section_quiz".to_owned(),
        amount: settlement.amount,
        reason: "section_quiz_complete".to_owned(),
    };
    wallets::settle(conn, &ledger).await?;

    Ok(true)
}
