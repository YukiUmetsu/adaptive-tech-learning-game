use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};

use crate::auth::AuthenticatedUser;
use crate::dto::{TrackMapResponse, TrackProgressResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Path parameters for a learning-track aggregate view.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct TrackPath {
    /// Learning track identifier, for example `aws-soa-c03`.
    pub track_id: String,
}

/// Returns every learning domain for a track in one response.
///
/// The Track Hub renders one track-wide Knowledge Map, so this avoids a request
/// per domain. It is authored content only: no scored answers, no learner state.
#[utoipa::path(
    get,
    path = "/v1/tracks/{track_id}/map",
    tag = "learning",
    params(TrackPath),
    responses(
        (status = 200, description = "Track knowledge map content", body = TrackMapResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_track_map(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    path: Result<Path<TrackPath>, PathRejection>,
) -> Result<Json<TrackMapResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    Ok(Json(services::track_map(&state, &path.track_id)?))
}

/// Returns the aggregate Knowledge Signal for a track.
///
/// One request covers every domain and node. Coarse semantic states only: no raw
/// model probabilities, percentages, or pass estimates. This is an enhancement:
/// if it fails, the client renders the normal Knowledge Map from discovery
/// progress and omits the adaptive decoration.
#[utoipa::path(
    get,
    path = "/v1/tracks/{track_id}/progress",
    tag = "learning",
    params(TrackPath),
    responses(
        (status = 200, description = "Track knowledge signal", body = TrackProgressResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_track_progress(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<TrackPath>, PathRejection>,
) -> Result<Json<TrackProgressResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    Ok(Json(
        services::track_progress(&state, &user, &path.track_id).await?,
    ))
}
