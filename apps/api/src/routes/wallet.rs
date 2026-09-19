use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;

use crate::dto::WalletResponse;
use crate::error::ApiError;
use crate::services;
use crate::state::AppState;

/// Query for a device's wallet.
#[derive(Debug, Deserialize, IntoParams)]
pub struct WalletQuery {
    /// Client device identifier.
    pub device_id: Uuid,
}

/// Returns a device's settled Bits balance.
#[utoipa::path(
    get,
    path = "/v1/wallet",
    tag = "wallet",
    params(WalletQuery),
    responses((status = 200, description = "Settled Bits balance", body = WalletResponse))
)]
pub async fn get_wallet(
    State(state): State<AppState>,
    Query(query): Query<WalletQuery>,
) -> Result<Json<WalletResponse>, ApiError> {
    Ok(Json(services::wallet(&state, query.device_id).await?))
}
