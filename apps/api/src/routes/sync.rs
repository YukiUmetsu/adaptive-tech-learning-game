use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::auth::OptionalUser;
use crate::dto::{SyncRequest, SyncResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Reconciles a batch of attempts, re-scoring each against canonical content.
///
/// The authenticated user is inferred from the bearer token; ownership of every
/// referenced mission is checked server-side. Anonymous demo events are
/// accepted for demo missions but never settle Bits.
#[utoipa::path(
    post,
    path = "/v1/sync",
    tag = "sync",
    request_body = SyncRequest,
    responses(
        (status = 200, description = "Per-event sync results", body = SyncResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn sync(
    State(state): State<AppState>,
    user: OptionalUser,
    body: Result<Json<SyncRequest>, JsonRejection>,
) -> Result<Json<SyncResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::sync(&state, user.0.as_ref(), request).await?,
    ))
}
