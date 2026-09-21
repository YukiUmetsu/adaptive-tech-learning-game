use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};

use crate::auth::AuthenticatedUser;
use crate::dto::{StudySessionRequest, StudySessionResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Path parameters for a learning-track study session.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct StudySessionPath {
    /// Learning track identifier, for example `ai-python-fluency`.
    pub track_id: String,
}

/// Builds an optional adaptive study session for a learning track.
///
/// Session planning is optional and best-effort: the client falls back to a
/// standard non-adaptive session when this fails. The server selects all
/// practice questions. Requires an authenticated account.
#[utoipa::path(
    post,
    path = "/v1/tracks/{track_id}/session",
    tag = "recommendations",
    params(StudySessionPath),
    request_body = StudySessionRequest,
    responses(
        (status = 200, description = "Planned study session", body = StudySessionResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn create_study_session(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<StudySessionPath>, PathRejection>,
    body: Result<Json<StudySessionRequest>, JsonRejection>,
) -> Result<Json<StudySessionResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::study_session(&state, &user, &path.track_id, request).await?,
    ))
}
