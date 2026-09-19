use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::dto::MeResponse;
use crate::error::ErrorResponse;

/// Returns safe application account data for the authenticated learner.
///
/// Used to confirm server-side auth and to power the account UI. It never
/// returns tokens, secrets, or provider internals.
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
pub async fn get_me(user: AuthenticatedUser) -> Json<MeResponse> {
    Json(MeResponse {
        id: user.id,
        email: user.email,
        authenticated: true,
    })
}
