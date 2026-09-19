use axum::Json;
use axum::extract::State;

use crate::auth::AuthenticatedUser;
use crate::dto::WalletResponse;
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Returns the authenticated user's settled Bits balance.
///
/// The wallet is identified by the verified token, never by a query parameter,
/// so a caller can only read their own balance.
#[utoipa::path(
    get,
    path = "/v1/wallet",
    tag = "wallet",
    responses(
        (status = 200, description = "Settled Bits balance", body = WalletResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_wallet(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<WalletResponse>, ApiError> {
    Ok(Json(services::wallet(&state, &user).await?))
}
