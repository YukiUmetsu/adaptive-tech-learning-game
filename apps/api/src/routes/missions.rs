use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::auth::OptionalUser;
use crate::dto::{
    AnswerRequest, CompleteMissionRequest, CompleteMissionResponse, FeedbackResponse,
    IssueMissionRequest, MissionResponse,
};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::{json_body, uuid_path};
use crate::services;
use crate::state::AppState;

/// Issues a mission for a quiz mode.
///
/// Authenticated callers get a user-owned mission. Anonymous callers may issue
/// public demo task-practice missions only.
#[utoipa::path(
    post,
    path = "/v1/missions/issue",
    tag = "missions",
    request_body = IssueMissionRequest,
    responses(
        (status = 200, description = "Issued mission", body = MissionResponse),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown certification or task", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn issue_mission(
    State(state): State<AppState>,
    user: OptionalUser,
    body: Result<Json<IssueMissionRequest>, JsonRejection>,
) -> Result<Json<MissionResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::issue_mission(&state, user.0.as_ref(), request).await?,
    ))
}

/// Scores one attempt and returns immediate feedback.
#[utoipa::path(
    post,
    path = "/v1/missions/{mission_id}/answers",
    tag = "missions",
    params(("mission_id" = uuid::Uuid, Path, description = "Mission identifier")),
    request_body = AnswerRequest,
    responses(
        (status = 200, description = "Scored attempt", body = FeedbackResponse),
        (status = 400, description = "Invalid answer", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account", body = ErrorResponse),
        (status = 404, description = "Unknown mission", body = ErrorResponse),
        (status = 409, description = "Mission completed or content version mismatch", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn answer_mission(
    State(state): State<AppState>,
    user: OptionalUser,
    mission_id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<AnswerRequest>, JsonRejection>,
) -> Result<Json<FeedbackResponse>, ApiError> {
    let mission_id = uuid_path(mission_id)?;
    let request = json_body(body)?;
    Ok(Json(
        services::score_attempt(&state, user.0.as_ref(), mission_id, request).await?,
    ))
}

/// Marks a mission completed for its owner.
#[utoipa::path(
    post,
    path = "/v1/missions/{mission_id}/complete",
    tag = "missions",
    params(("mission_id" = uuid::Uuid, Path, description = "Mission identifier")),
    request_body = CompleteMissionRequest,
    responses(
        (status = 200, description = "Mission completed", body = CompleteMissionResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account", body = ErrorResponse),
        (status = 404, description = "Unknown mission", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn complete_mission(
    State(state): State<AppState>,
    user: OptionalUser,
    mission_id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<CompleteMissionRequest>, JsonRejection>,
) -> Result<Json<CompleteMissionResponse>, ApiError> {
    let mission_id = uuid_path(mission_id)?;
    let request: CompleteMissionRequest = body
        .map(|Json(value)| value)
        .unwrap_or(CompleteMissionRequest { device_id: None });
    Ok(Json(
        services::complete_mission(&state, user.0.as_ref(), mission_id, request.device_id).await?,
    ))
}
