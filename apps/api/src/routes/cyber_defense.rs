use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::auth::AuthenticatedUser;
use crate::dto::{CyberDefenseUpgradeRequest, CyberDefenseUpgradeResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Debits Bits for one Cyber Defense control upgrade.
///
/// The wallet is taken from the verified token, so an anonymous caller is
/// rejected: spending is an account-scoped, server-authoritative action. The
/// client sends the action's primitives and an idempotency `event_id`; the
/// server derives the cost and settles the debit exactly once.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/upgrades",
    tag = "cyber-defense",
    request_body = CyberDefenseUpgradeRequest,
    responses(
        (status = 200, description = "Bits debited; settled balance returned", body = CyberDefenseUpgradeResponse),
        (status = 400, description = "Malformed request or invalid upgrade", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 409, description = "Insufficient Bits, an out-of-sequence upgrade level, or a reused idempotency key", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn spend_upgrade(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: Result<Json<CyberDefenseUpgradeRequest>, JsonRejection>,
) -> Result<Json<CyberDefenseUpgradeResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_upgrade(&state, &user, request).await?,
    ))
}
