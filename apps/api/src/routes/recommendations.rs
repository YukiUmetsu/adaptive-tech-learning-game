use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::dto::{
    RecommendationEventRequest, RecommendationEventResponse, RecommendationRequest,
    RecommendationResponse,
};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Path parameters for a learning-track recommendation.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct RecommendationPath {
    /// Learning track identifier, for example `ai-python-fluency`.
    pub track_id: String,
}

/// Path parameters for a recommendation lifecycle event.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct RecommendationEventPath {
    /// Learning track identifier.
    pub track_id: String,
    /// Recommendation the event refers to.
    pub recommendation_id: Uuid,
}

/// Returns a best-effort next-action recommendation for a learning track.
///
/// This is an optional, explainable layer over the derived concept state. It
/// never gates the dashboard, knowledge maps, or quizzes, and it never creates
/// learning evidence. Requires an authenticated account.
#[utoipa::path(
    post,
    path = "/v1/tracks/{track_id}/recommendation",
    tag = "recommendations",
    params(RecommendationPath),
    request_body = RecommendationRequest,
    responses(
        (status = 200, description = "Next-action recommendation", body = RecommendationResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn create_recommendation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<RecommendationPath>, PathRejection>,
    body: Result<Json<RecommendationRequest>, JsonRejection>,
) -> Result<Json<RecommendationResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::recommendation(&state, &user, &path.track_id, &request.discovery).await?,
    ))
}

/// Records one recommendation lifecycle event.
///
/// Telemetry is auxiliary: the request succeeds even when the write fails, so it
/// can never block the learner.
#[utoipa::path(
    post,
    path = "/v1/tracks/{track_id}/recommendations/{recommendation_id}/events",
    tag = "recommendations",
    params(RecommendationEventPath),
    request_body = RecommendationEventRequest,
    responses(
        (status = 200, description = "Event disposition", body = RecommendationEventResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn record_recommendation_event(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<RecommendationEventPath>, PathRejection>,
    body: Result<Json<RecommendationEventRequest>, JsonRejection>,
) -> Result<Json<RecommendationEventResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::record_recommendation_event(
            &state,
            &user,
            &path.track_id,
            path.recommendation_id,
            request,
        )
        .await,
    ))
}
