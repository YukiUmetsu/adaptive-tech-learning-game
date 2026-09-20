use axum::Json;
use axum::extract::State;

use crate::auth::AuthenticatedUser;
use crate::dto::MeResponse;
use crate::error::ErrorResponse;
use crate::services;
use crate::state::AppState;

/// Returns safe application account data for the authenticated learner.
///
/// Used to confirm server-side auth and to power the account UI. It never
/// returns tokens, secrets, or provider internals. The account-wide study streak
/// is bundled here so the Track Hub needs no separate streak request; a streak
/// query failure returns a neutral streak and never fails authentication.
#[utoipa::path(
    get,
    path = "/v1/me",
    tag = "account",
    responses(
        (status = 200, description = "Authenticated account", body = MeResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_me(State(state): State<AppState>, user: AuthenticatedUser) -> Json<MeResponse> {
    let streak = services::streak(&state, &user).await;
    Json(MeResponse {
        id: user.id,
        email: user.email,
        authenticated: true,
        streak,
    })
}
