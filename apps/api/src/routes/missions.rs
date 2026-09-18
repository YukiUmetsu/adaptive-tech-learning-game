use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::dto::{
    AnswerRequest, CompleteMissionRequest, CompleteMissionResponse, FeedbackResponse,
    IssueMissionRequest, MissionResponse,
};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::{json_body, uuid_path};
use crate::services;
use crate::state::AppState;

/// Issues a deterministic mission for a task.
#[utoipa::path(
    post,
    path = "/v1/missions/issue",
    tag = "missions",
    request_body = IssueMissionRequest,
    responses(
        (status = 200, description = "Issued mission", body = MissionResponse),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 404, description = "Unknown certification or task", body = ErrorResponse)
    )
)]
pub async fn issue_mission(
    State(state): State<AppState>,
    body: Result<Json<IssueMissionRequest>, JsonRejection>,
) -> Result<Json<MissionResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(services::issue_mission(&state, request).await?))
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
        (status = 403, description = "Mission belongs to another device", body = ErrorResponse),
        (status = 404, description = "Unknown mission", body = ErrorResponse),
        (status = 409, description = "Mission completed or content version mismatch", body = ErrorResponse)
    )
)]
pub async fn answer_mission(
    State(state): State<AppState>,
    mission_id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<AnswerRequest>, JsonRejection>,
) -> Result<Json<FeedbackResponse>, ApiError> {
    let mission_id = uuid_path(mission_id)?;
    let request = json_body(body)?;
    Ok(Json(
        services::score_attempt(&state, mission_id, request).await?,
    ))
}

/// Marks a mission completed.
#[utoipa::path(
    post,
    path = "/v1/missions/{mission_id}/complete",
    tag = "missions",
    params(("mission_id" = uuid::Uuid, Path, description = "Mission identifier")),
    request_body = CompleteMissionRequest,
    responses(
        (status = 200, description = "Mission completed", body = CompleteMissionResponse),
        (status = 403, description = "Mission belongs to another device", body = ErrorResponse),
        (status = 404, description = "Unknown mission", body = ErrorResponse)
    )
)]
pub async fn complete_mission(
    State(state): State<AppState>,
    mission_id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<CompleteMissionRequest>, JsonRejection>,
) -> Result<Json<CompleteMissionResponse>, ApiError> {
    let mission_id = uuid_path(mission_id)?;
    let request = json_body(body)?;
    Ok(Json(
        services::complete_mission(&state, mission_id, request.device_id).await?,
    ))
}
