//! Server-authoritative Bits wallet and settlement.
//!
//! Wallets are owned by the authenticated user, so the same balance is visible
//! from every device a learner signs in on. Settlement is idempotent by
//! `event_id`: retrying a sync can never award the same event twice.

use sqlx::PgPool;
use uuid::Uuid;

use crate::DbError;

/// A settled Bits award for one accepted learning event.
#[derive(Debug, Clone, PartialEq)]
pub struct BitTransaction {
    /// Authenticated user who owns the wallet.
    pub user_id: Uuid,
    /// Device context that produced the event, when known.
    pub device_id: Option<Uuid>,
    /// Learning event that earned the Bits. Unique per award.
    pub event_id: Uuid,
    /// Mission the event belongs to.
    pub mission_instance_id: Uuid,
    /// Question that earned the Bits.
    pub question_id: String,
    /// Award amount. Zero or negative awards are ignored.
    pub amount: i64,
    /// Short machine-readable reason, for example `first_attempt`.
    pub reason: String,
}

/// Settles an award on an existing transaction.
///
/// Returns `true` when a new transaction row was written. A duplicate
/// `event_id` leaves the balance untouched and returns `false`.
pub async fn settle(
    conn: &mut sqlx::PgConnection,
    transaction: &BitTransaction,
) -> Result<bool, DbError> {
    if transaction.amount <= 0 {
        return Ok(false);
    }

    // Ensure the wallet exists before the balance update below.
    sqlx::query(
        "INSERT INTO user_wallets (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(transaction.user_id)
    .execute(&mut *conn)
    .await?;

    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO bit_transactions
            (user_id, device_id, event_id, mission_instance_id, question_id, amount, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id",
    )
    .bind(transaction.user_id)
    .bind(transaction.device_id)
    .bind(transaction.event_id)
    .bind(transaction.mission_instance_id)
    .bind(&transaction.question_id)
    .bind(transaction.amount)
    .bind(&transaction.reason)
    .fetch_optional(&mut *conn)
    .await?;

    if inserted.is_none() {
        return Ok(false);
    }

    sqlx::query(
        "UPDATE user_wallets
         SET bits_balance = bits_balance + $2, updated_at = now()
         WHERE user_id = $1",
    )
    .bind(transaction.user_id)
    .bind(transaction.amount)
    .execute(&mut *conn)
    .await?;

    Ok(true)
}

/// Returns a learner's settled Bits balance, or `0` when no wallet exists.
pub async fn balance(pool: &PgPool, user_id: Uuid) -> Result<i64, DbError> {
    let balance =
        sqlx::query_scalar::<_, i64>("SELECT bits_balance FROM user_wallets WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    Ok(balance.unwrap_or(0))
}
