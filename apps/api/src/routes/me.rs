use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::auth::AuthenticatedUser;
use crate::dto::{MeResponse, UpdateSettingsRequest, UserSettingsDto};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Returns safe application account data for the authenticated learner.
///
/// Used to confirm server-side auth and to power the account UI. It never
/// returns tokens, secrets, or provider internals. The account-wide study streak
/// and study settings are bundled here so the Track Hub needs no extra request;
/// a query failure returns neutral values and never fails authentication.
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
    let settings = services::user_settings(&state, &user).await;
    Json(MeResponse {
        id: user.id,
        email: user.email,
        authenticated: true,
        streak,
        settings,
    })
}

/// Updates learner study settings.
///
/// Settings are preferences only: they never affect scoring, evidence, concept
/// state, or rewards.
#[utoipa::path(
    put,
    path = "/v1/me/settings",
    tag = "account",
    request_body = UpdateSettingsRequest,
    responses(
        (status = 200, description = "Updated settings", body = UserSettingsDto),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn update_settings(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: Result<Json<UpdateSettingsRequest>, JsonRejection>,
) -> Result<Json<UserSettingsDto>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::update_settings(&state, &user, request).await?,
    ))
}
