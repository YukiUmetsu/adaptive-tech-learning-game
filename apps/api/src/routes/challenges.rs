use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::{JsonRejection, PathRejection};

use crate::auth::AuthenticatedUser;
use crate::dto::{ChallengeStartRequest, MissionResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Path parameters for starting an authored challenge.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct ChallengeStartPath {
    /// Learning track identifier, for example `ai-python-fluency`.
    pub track_id: String,
    /// Authored challenge identifier, unique within the track.
    pub challenge_id: String,
}

/// Starts an authored multi-stage challenge as one mission.
///
/// The server resolves the authored definition, enforces authored
/// prerequisites, freezes the referenced content, and composes the ordered
/// mission itself. The client never supplies question ids. Requires an
/// authenticated account.
#[utoipa::path(
    post,
    path = "/v1/tracks/{track_id}/challenges/{challenge_id}/start",
    tag = "challenges",
    params(ChallengeStartPath),
    request_body = ChallengeStartRequest,
    responses(
        (status = 200, description = "Issued challenge mission", body = MissionResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown track or challenge", body = ErrorResponse),
        (status = 409, description = "Challenge prerequisites are not met", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn start_challenge(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<ChallengeStartPath>, PathRejection>,
    body: Result<Json<ChallengeStartRequest>, JsonRejection>,
) -> Result<Json<MissionResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let request = json_body(body)?;

    Ok(Json(
        services::start_challenge(&state, &user, &path.track_id, &path.challenge_id, request)
            .await?,
    ))
}
