use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};

use crate::auth::AuthenticatedUser;
use crate::dto::{FamilyInsightsResponse, TrackMapResponse, TrackProgressResponse};
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

/// Optional query for the family-insights endpoint.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FamilyInsightsQuery {
    /// Completed mission whose families should scope the response.
    ///
    /// When present, only families the finished mission involved are returned.
    /// Omit it for the track-wide pattern browser.
    #[serde(default)]
    pub mission_id: Option<uuid::Uuid>,
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

/// Returns learner-family structure insights for a track.
///
/// One aggregate request covers every family the learner has already
/// encountered, so the Track Hub never fetches per-family or per-example state.
/// An optional `mission_id` scopes the response to a completed mission's
/// families so a completion summary shows only structures the finished work
/// involved. It is post-exposure teaching content only: it never returns a
/// family the learner has not seen, never returns families for an in-progress
/// mission, and never carries a canonical answer. A track with no authored
/// family guides returns an empty list, so old tracks are unaffected.
#[utoipa::path(
    get,
    path = "/v1/tracks/{track_id}/family-insights",
    tag = "learning",
    params(TrackPath, FamilyInsightsQuery),
    responses(
        (status = 200, description = "Learner-family structure insights", body = FamilyInsightsResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account or track", body = ErrorResponse),
        (status = 404, description = "Unknown learning track or mission", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_track_family_insights(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<TrackPath>, PathRejection>,
    query: Result<Query<FamilyInsightsQuery>, QueryRejection>,
) -> Result<Json<FamilyInsightsResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let Query(query) = query.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid query parameter: {rejection}"))
    })?;
    Ok(Json(
        services::family_insights(&state, &user, &path.track_id, query.mission_id).await?,
    ))
}
