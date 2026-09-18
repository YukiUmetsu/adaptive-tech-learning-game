use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::dto::{SyncRequest, SyncResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Reconciles a batch of attempts, re-scoring each against canonical content.
#[utoipa::path(
    post,
    path = "/v1/sync",
    tag = "sync",
    request_body = SyncRequest,
    responses(
        (status = 200, description = "Per-event sync results", body = SyncResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse)
    )
)]
pub async fn sync(
    State(state): State<AppState>,
    body: Result<Json<SyncRequest>, JsonRejection>,
) -> Result<Json<SyncResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(services::sync(&state, request).await?))
}
