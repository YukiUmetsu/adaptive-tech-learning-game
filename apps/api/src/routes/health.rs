use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;
use adaptive_learn_db as db;

/// Overall service health.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    /// All dependencies are reachable.
    Ok,
    /// The process is serving but a dependency is degraded.
    Degraded,
}

/// Database reachability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseStatus {
    /// The pool answered a trivial query.
    Ok,
    /// The pool could not serve a query.
    Unavailable,
}

/// Safe operational health payload. Never includes connection strings, hosts,
/// versions of dependencies, or other internals.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HealthResponse {
    /// Aggregate status.
    pub status: HealthStatus,
    /// Service name.
    pub service: String,
    /// Service version.
    pub version: String,
    /// Database status.
    pub database: DatabaseStatus,
    /// Seconds since process start.
    pub uptime_seconds: u64,
    /// Server time in UTC.
    pub timestamp: DateTime<Utc>,
}

/// Liveness and dependency check.
///
/// Returns `200` when the database is reachable and `503` when it is not, so a
/// load balancer can stop routing to an instance whose dependency is down.
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses(
        (status = 200, description = "Service and database are healthy", body = HealthResponse),
        (status = 503, description = "Service is running but the database is unavailable", body = HealthResponse)
    )
)]
pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let database = match db::health_check(&state.pool).await {
        Ok(()) => DatabaseStatus::Ok,
        Err(error) => {
            tracing::warn!(error = %error, "database health check failed");
            DatabaseStatus::Unavailable
        }
    };

    let (status, http_status) = match database {
        DatabaseStatus::Ok => (HealthStatus::Ok, StatusCode::OK),
        DatabaseStatus::Unavailable => (HealthStatus::Degraded, StatusCode::SERVICE_UNAVAILABLE),
    };

    let body = HealthResponse {
        status,
        service: state.service_name().to_owned(),
        version: state.version().to_owned(),
        database,
        uptime_seconds: state.uptime_seconds(),
        timestamp: Utc::now(),
    };

    (http_status, Json(body))
}
