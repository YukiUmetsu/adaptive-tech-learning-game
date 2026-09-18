//! PostgreSQL persistence for the adaptive learning game.
//!
//! The layer deliberately stays close to SQL: explicit queries, explicit types,
//! and migrations that can be replayed. Phase 0 covers only the foundational
//! `users` and `sync_batches` tables.

pub mod error;
pub mod sync_batches;
pub mod users;

use std::time::Duration;

pub use error::DbError;
pub use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Embedded, forward-only migration set with reversible `.up.sql`/`.down.sql`
/// pairs. Run with `sqlx migrate run --source crates/db/migrations`.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Opens a small connection pool.
///
/// Pools are intentionally small because the API scales horizontally and the
/// database connection budget is a shared, limited resource.
pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool, DbError> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .test_before_acquire(true)
        .connect(database_url)
        .await?;

    Ok(pool)
}

/// Verifies that the pool can serve a trivial query.
pub async fn health_check(pool: &PgPool) -> Result<(), DbError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await?;
    Ok(())
}
