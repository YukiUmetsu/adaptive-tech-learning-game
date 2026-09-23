use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::auth::{AuthenticatedUser, OptionalUser};
use crate::dto::{
    AnswerRequest, CompleteMissionRequest, CompleteMissionResponse, FeedbackResponse,
    IssueMissionRequest, MissionResponse, MissionReviewResponse,
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
        (status = 409, description = "Mission completed, content version mismatch, or stale mission content (`mission_content_stale`)", body = ErrorResponse)
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

/// Returns a read-only review of a completed mission.
///
/// Canonical answers are included only after completion, so in-progress work
/// never leaks answers. Review never creates evidence or changes scores.
#[utoipa::path(
    get,
    path = "/v1/missions/{mission_id}/review",
    tag = "missions",
    params(("mission_id" = uuid::Uuid, Path, description = "Mission identifier")),
    responses(
        (status = 200, description = "Mission review", body = MissionReviewResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Mission belongs to another account", body = ErrorResponse),
        (status = 404, description = "Unknown mission", body = ErrorResponse),
        (status = 409, description = "Mission is not complete yet", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn review_mission(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    mission_id: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<MissionReviewResponse>, ApiError> {
    let mission_id = uuid_path(mission_id)?;
    Ok(Json(
        services::mission_review(&state, &user, mission_id).await?,
    ))
}
