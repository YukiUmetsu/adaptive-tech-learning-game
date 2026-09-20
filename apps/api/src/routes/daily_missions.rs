use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::dto::{
    DailyItemCompleteRequest, DailyItemCompleteResponse, DailyMissionRequest, DailyMissionResponse,
    MissionResponse,
};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Path parameters for today's Daily Mission.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DailyMissionTrackPath {
    /// Learning track identifier, for example `ai-python-fluency`.
    pub track_id: String,
}

/// Path parameters for one Daily Mission item.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DailyItemPath {
    /// Daily Mission identifier.
    pub mission_id: Uuid,
    /// Zero-based item position.
    pub position: i32,
}

/// Returns today's immutable Daily Mission, generating it once if needed.
///
/// The plan never changes after creation, and generation is optional: if
/// adaptive planning fails, a standard non-adaptive plan is persisted instead.
#[utoipa::path(
    post,
    path = "/v1/tracks/{track_id}/daily-mission",
    tag = "daily-missions",
    params(DailyMissionTrackPath),
    request_body = DailyMissionRequest,
    responses(
        (status = 200, description = "Today's Daily Mission", body = DailyMissionResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_today_daily_mission(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<DailyMissionTrackPath>, PathRejection>,
    body: Result<Json<DailyMissionRequest>, JsonRejection>,
) -> Result<Json<DailyMissionResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::daily_mission(&state, &user, &path.track_id, request).await?,
    ))
}

/// Starts the mission for one Daily Mission practice item.
#[utoipa::path(
    post,
    path = "/v1/daily-missions/{mission_id}/items/{position}/start",
    tag = "daily-missions",
    params(DailyItemPath),
    responses(
        (status = 200, description = "Started mission", body = MissionResponse),
        (status = 400, description = "Item is completed on the knowledge map", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account", body = ErrorResponse),
        (status = 404, description = "Unknown mission or item", body = ErrorResponse),
        (status = 409, description = "Item or mission already complete", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn start_daily_item(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<DailyItemPath>, PathRejection>,
) -> Result<Json<MissionResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;

    Ok(Json(
        services::start_daily_item(&state, &user, path.mission_id, path.position).await?,
    ))
}

/// Completes a learning-node Daily Mission item from discovery progress.
#[utoipa::path(
    post,
    path = "/v1/daily-missions/{mission_id}/items/{position}/complete",
    tag = "daily-missions",
    params(DailyItemPath),
    request_body = DailyItemCompleteRequest,
    responses(
        (status = 200, description = "Item completion result", body = DailyItemCompleteResponse),
        (status = 400, description = "Item completes through a mission", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account", body = ErrorResponse),
        (status = 404, description = "Unknown mission or item", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn complete_daily_item(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<DailyItemPath>, PathRejection>,
    body: Result<Json<DailyItemCompleteRequest>, JsonRejection>,
) -> Result<Json<DailyItemCompleteResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::complete_daily_item(&state, &user, path.mission_id, path.position, request)
            .await?,
    ))
}
