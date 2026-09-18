use std::sync::Arc;
use std::time::Instant;

use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db::PgPool;

/// Shared application state passed to handlers.
#[derive(Clone)]
pub struct AppState {
    /// Database connection pool.
    pub pool: PgPool,
    /// Immutable, validated content registry.
    pub content: Arc<ContentRegistry>,
    /// Process start time, used to report uptime.
    started_at: Instant,
    service_name: &'static str,
    version: &'static str,
}

impl AppState {
    /// Builds state for a running API process.
    pub fn new(pool: PgPool, content: Arc<ContentRegistry>) -> Self {
        Self {
            pool,
            content,
            started_at: Instant::now(),
            service_name: env!("CARGO_PKG_NAME"),
            version: env!("CARGO_PKG_VERSION"),
        }
    }

    /// Stable service name reported by operational endpoints.
    pub const fn service_name(&self) -> &'static str {
        self.service_name
    }

    /// Crate version reported by operational endpoints.
    pub const fn version(&self) -> &'static str {
        self.version
    }

    /// Seconds since the process started.
    pub fn uptime_seconds(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}
