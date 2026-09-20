use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};

use crate::auth::AuthenticatedUser;
use crate::dto::DiscoveryResponse;
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Path parameters for a track's persisted discovery progress.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct TrackDiscoveryPath {
    /// Learning track identifier, for example `aws-soa-c03`.
    pub track_id: String,
}

/// Returns a learner's persisted Knowledge Map discovery progress for a track.
///
/// This is an enhancement, not a prerequisite: the Knowledge Map renders from
/// local progress immediately and merges this response asynchronously. It is raw
/// monotonic discovery data and never scored knowledge evidence.
#[utoipa::path(
    get,
    path = "/v1/tracks/{track_id}/discovery",
    tag = "learning",
    params(TrackDiscoveryPath),
    responses(
        (status = 200, description = "Persisted discovery progress", body = DiscoveryResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_track_discovery(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<TrackDiscoveryPath>, PathRejection>,
) -> Result<Json<DiscoveryResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;

    Ok(Json(
        services::track_discovery(&state, &user, &path.track_id).await?,
    ))
}
