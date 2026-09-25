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

/// A Bits debit for a priced action, such as a Cyber Defense upgrade.
#[derive(Debug, Clone, PartialEq)]
pub struct BitSpend {
    /// Authenticated user who owns the wallet.
    pub user_id: Uuid,
    /// Device context that produced the spend, when known.
    pub device_id: Option<Uuid>,
    /// Idempotency key. A retry with the same id never debits twice.
    pub event_id: Uuid,
    /// The run/session the spend belongs to, for audit. Stored as the ledger's
    /// mission reference.
    pub run_id: Uuid,
    /// Priced item, for example a defense id.
    pub item_id: String,
    /// Positive amount of Bits to debit.
    pub amount: i64,
    /// Short machine-readable reason, for example `cyber_defense_upgrade`.
    pub reason: String,
}

/// Outcome of attempting a [`BitSpend`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpendOutcome {
    /// A new debit was written; the wallet holds the post-debit balance.
    Settled {
        /// Balance after the debit.
        balance: i64,
    },
    /// This `event_id` was already settled by an identical debit. The balance is
    /// unchanged.
    AlreadySettled,
    /// This `event_id` already belongs to a different ledger row (another user,
    /// item, run, amount, or a reward). The request is rejected so a key cannot
    /// be replayed to skip a debit.
    KeyReused,
    /// The wallet could not cover the debit. Nothing was written.
    InsufficientFunds,
}

/// Debits Bits from a wallet, atomically and idempotently.
///
/// The ledger row and the balance guard are written in one transaction, so a
/// debit and its record can never diverge. `event_id` is unique, so a retried
/// spend returns [`SpendOutcome::AlreadySettled`] without debiting again, while
/// reusing the key for a different operation returns [`SpendOutcome::KeyReused`].
///
/// The caller owns the transaction: when the result is
/// [`SpendOutcome::InsufficientFunds`] it must roll back, which discards the
/// provisional ledger row inserted here.
pub async fn spend(
    conn: &mut sqlx::PgConnection,
    spend: &BitSpend,
) -> Result<SpendOutcome, DbError> {
    debug_assert!(spend.amount > 0, "spend amount must be positive");
    if spend.amount <= 0 {
        return Ok(SpendOutcome::InsufficientFunds);
    }

    // Ensure the wallet exists so the guarded update below has a row to match.
    sqlx::query(
        "INSERT INTO user_wallets (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(spend.user_id)
    .execute(&mut *conn)
    .await?;

    // Claim the idempotency key first. A duplicate leaves the wallet untouched.
    let claimed = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO bit_transactions
            (user_id, device_id, event_id, mission_instance_id, question_id, amount, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id",
    )
    .bind(spend.user_id)
    .bind(spend.device_id)
    .bind(spend.event_id)
    .bind(spend.run_id)
    .bind(&spend.item_id)
    .bind(-spend.amount)
    .bind(&spend.reason)
    .fetch_optional(&mut *conn)
    .await?;

    if claimed.is_none() {
        // The key already exists. Only an identical retry of this same debit is
        // idempotent; any other reuse — another item, run, amount, user, or a
        // reward row — is rejected, so a key can never be replayed to skip a
        // debit or to collide with an unrelated ledger entry.
        let existing = sqlx::query_as::<_, (Option<Uuid>, i64, Uuid, String)>(
            "SELECT user_id, amount::bigint, mission_instance_id, question_id
             FROM bit_transactions
             WHERE event_id = $1",
        )
        .bind(spend.event_id)
        .fetch_optional(&mut *conn)
        .await?;

        let is_retry = matches!(
            existing,
            Some((user_id, amount, mission_instance_id, question_id))
                if user_id == Some(spend.user_id)
                    && amount == -spend.amount
                    && mission_instance_id == spend.run_id
                    && question_id == spend.item_id
        );

        return Ok(if is_retry {
            SpendOutcome::AlreadySettled
        } else {
            SpendOutcome::KeyReused
        });
    }

    // Conditional debit: `WHERE bits_balance >= amount` makes concurrent spends
    // safe without an explicit row lock and prevents a negative balance even if
    // a check elsewhere is wrong.
    let balance = sqlx::query_scalar::<_, i64>(
        "UPDATE user_wallets
         SET bits_balance = bits_balance - $2, updated_at = now()
         WHERE user_id = $1 AND bits_balance >= $2
         RETURNING bits_balance",
    )
    .bind(spend.user_id)
    .bind(spend.amount)
    .fetch_optional(&mut *conn)
    .await?;

    match balance {
        Some(balance) => Ok(SpendOutcome::Settled { balance }),
        // The ledger claim is provisional; the caller rolls the transaction
        // back so an unaffordable spend leaves no trace.
        None => Ok(SpendOutcome::InsufficientFunds),
    }
}

/// Ensures the user's wallet exists and locks its row for the transaction.
///
/// Serializing spends for one wallet keeps a value derived from the settled
/// ledger — such as a Cyber Defense control level — consistent when two
/// upgrades for the same control arrive at once.
pub async fn lock_wallet(conn: &mut sqlx::PgConnection, user_id: Uuid) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO user_wallets (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(user_id)
    .execute(&mut *conn)
    .await?;

    sqlx::query("SELECT 1 FROM user_wallets WHERE user_id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_optional(&mut *conn)
        .await?;

    Ok(())
}

/// Counts settled debits for one priced item in one run.
///
/// `exclude_event_id` skips the caller's own idempotency key, so retrying a
/// spend does not shift a level derived from the count. The caller should hold
/// the wallet lock from [`lock_wallet`] so the count is stable.
pub async fn count_upgrades(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    run_id: Uuid,
    item_id: &str,
    exclude_event_id: Uuid,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM bit_transactions
         WHERE user_id = $1
           AND mission_instance_id = $2
           AND question_id = $3
           AND amount < 0
           AND event_id <> $4",
    )
    .bind(user_id)
    .bind(run_id)
    .bind(item_id)
    .bind(exclude_event_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count)
}
