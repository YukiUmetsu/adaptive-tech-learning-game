use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::dto::{
    CyberCampaignCompleteRequest, CyberCampaignCompleteResponse, CyberDefenseProfileResponse,
    CyberDefenseUpgradeRequest, CyberDefenseUpgradeResponse, CyberHeroProgressDto,
    CyberHeroTalentRequest, CyberOperationCompleteRequest, CyberOperationCompleteResponse,
    CyberOperationLoadoutRequest, CyberOperationRunDto, CyberOperationStartRequest,
    CyberTowerUpgradePurchaseRequest, CyberTowerUpgradePurchaseResponse,
};
use crate::dto::{CyberLegacyImportRequest, CyberLegacyImportResponse};
use crate::dto::{CyberTelemetryRequest, CyberTelemetryResponse};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::{json_body, uuid_path};
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

/// Returns the authenticated player's complete Cyber Defense profile.
///
/// One server-authoritative snapshot: career, Bits, Tower, heroes, adversaries,
/// story, and campaign results. The first request creates a default profile.
#[utoipa::path(
    get,
    path = "/v1/cyber-defense/profile",
    tag = "cyber-defense",
    responses(
        (status = 200, description = "Complete Cyber Defense profile", body = CyberDefenseProfileResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_profile(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<CyberDefenseProfileResponse>, ApiError> {
    Ok(Json(services::cyber_defense_profile(&state, &user).await?))
}

/// Settles the result of one Stage 1 campaign mission.
///
/// The client sends only raw result evidence and an idempotency `result_id`; the
/// server derives completion, first-clear status, and every reward value.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/campaign/{mission_id}/complete",
    tag = "cyber-defense",
    params(("mission_id" = String, Path, description = "Campaign mission identifier")),
    request_body = CyberCampaignCompleteRequest,
    responses(
        (status = 200, description = "Mission result settled", body = CyberCampaignCompleteResponse),
        (status = 400, description = "Unknown mission or invalid result", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn complete_campaign(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(mission_id): Path<String>,
    body: Result<Json<CyberCampaignCompleteRequest>, JsonRejection>,
) -> Result<Json<CyberCampaignCompleteResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_campaign_complete(&state, &user, &mission_id, request).await?,
    ))
}

/// Purchases the next level of one Tower/HQ room with Bits.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/tower/upgrades/{upgrade_id}",
    tag = "cyber-defense",
    params(("upgrade_id" = String, Path, description = "Tower room upgrade identifier")),
    request_body = CyberTowerUpgradePurchaseRequest,
    responses(
        (status = 200, description = "Room upgraded", body = CyberTowerUpgradePurchaseResponse),
        (status = 400, description = "Unknown room or malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 409, description = "Insufficient Bits, max level, prerequisite not met, or reused key", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn purchase_tower_upgrade(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(upgrade_id): Path<String>,
    body: Result<Json<CyberTowerUpgradePurchaseRequest>, JsonRejection>,
) -> Result<Json<CyberTowerUpgradePurchaseResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_tower_purchase(&state, &user, &upgrade_id, request).await?,
    ))
}

/// Replaces a hero's selected talents (free respec in Stage 2).
#[utoipa::path(
    put,
    path = "/v1/cyber-defense/heroes/{hero_id}/talents",
    tag = "cyber-defense",
    params(("hero_id" = String, Path, description = "Hero identifier")),
    request_body = CyberHeroTalentRequest,
    responses(
        (status = 200, description = "Talents updated", body = CyberHeroProgressDto),
        (status = 400, description = "Unknown hero or illegal talent", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 409, description = "Milestone not yet unlocked", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn set_hero_talents(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(hero_id): Path<String>,
    body: Result<Json<CyberHeroTalentRequest>, JsonRejection>,
) -> Result<Json<CyberHeroProgressDto>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_set_hero_talents(&state, &user, &hero_id, request).await?,
    ))
}

/// Starts one repeatable Operation.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/operations",
    tag = "cyber-defense",
    request_body = CyberOperationStartRequest,
    responses(
        (status = 200, description = "Operation started", body = CyberOperationRunDto),
        (status = 400, description = "Locked Threat Level, unknown hero, or unknown template", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 409, description = "An active Operation already exists", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn start_operation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: Result<Json<CyberOperationStartRequest>, JsonRejection>,
) -> Result<Json<CyberOperationRunDto>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_start_operation(&state, &user, request).await?,
    ))
}

/// Reads one owned Operation run, so a refresh restores the exact run.
#[utoipa::path(
    get,
    path = "/v1/cyber-defense/operations/{run_id}",
    tag = "cyber-defense",
    params(("run_id" = Uuid, Path, description = "Operation run identifier")),
    responses(
        (status = 200, description = "Operation run", body = CyberOperationRunDto),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Run not found or not owned", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_operation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    run_id: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<CyberOperationRunDto>, ApiError> {
    let run_id = uuid_path(run_id)?;
    Ok(Json(
        services::cyber_defense_get_operation(&state, &user, run_id).await?,
    ))
}

/// Applies Engineering Lab defense substitutions to an active Operation.
#[utoipa::path(
    put,
    path = "/v1/cyber-defense/operations/{run_id}/loadout",
    tag = "cyber-defense",
    params(("run_id" = Uuid, Path, description = "Operation run identifier")),
    request_body = CyberOperationLoadoutRequest,
    responses(
        (status = 200, description = "Loadout updated", body = CyberOperationRunDto),
        (status = 400, description = "No Engineering Lab allowance, unknown defense, or unsolvable loadout", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Run not found or not owned", body = ErrorResponse),
        (status = 409, description = "Run is not active", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn set_operation_loadout(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    run_id: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    body: Result<Json<CyberOperationLoadoutRequest>, JsonRejection>,
) -> Result<Json<CyberOperationRunDto>, ApiError> {
    let run_id = uuid_path(run_id)?;
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_set_operation_loadout(&state, &user, run_id, request).await?,
    ))
}

/// Abandons an active Operation run. Grants no reward.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/operations/{run_id}/abandon",
    tag = "cyber-defense",
    params(("run_id" = Uuid, Path, description = "Operation run identifier")),
    responses(
        (status = 200, description = "Operation abandoned", body = CyberOperationRunDto),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Run not found or not owned", body = ErrorResponse),
        (status = 409, description = "Run is not active", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn abandon_operation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    run_id: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<CyberOperationRunDto>, ApiError> {
    let run_id = uuid_path(run_id)?;
    Ok(Json(
        services::cyber_defense_abandon_operation(&state, &user, run_id).await?,
    ))
}

/// Settles one Operation run's result and rewards exactly once.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/operations/{run_id}/complete",
    tag = "cyber-defense",
    params(("run_id" = Uuid, Path, description = "Operation run identifier")),
    request_body = CyberOperationCompleteRequest,
    responses(
        (status = 200, description = "Operation settled", body = CyberOperationCompleteResponse),
        (status = 400, description = "Malformed result", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Run not found or not owned", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn complete_operation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    run_id: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    body: Result<Json<CyberOperationCompleteRequest>, JsonRejection>,
) -> Result<Json<CyberOperationCompleteResponse>, ApiError> {
    let run_id = uuid_path(run_id)?;
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_complete_operation(&state, &user, run_id, request).await?,
    ))
}

/// Imports legacy Stage 1 local progress once.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/legacy-progress",
    tag = "cyber-defense",
    request_body = CyberLegacyImportRequest,
    responses(
        (status = 200, description = "Legacy progress imported (or already imported)", body = CyberLegacyImportResponse),
        (status = 400, description = "Malformed request", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn import_legacy_progress(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: Result<Json<CyberLegacyImportRequest>, JsonRejection>,
) -> Result<Json<CyberLegacyImportResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_import_legacy(&state, &user, request).await?,
    ))
}

/// Appends a batch of balance-telemetry events.
#[utoipa::path(
    post,
    path = "/v1/cyber-defense/telemetry",
    tag = "cyber-defense",
    request_body = CyberTelemetryRequest,
    responses(
        (status = 200, description = "Telemetry accepted", body = CyberTelemetryResponse),
        (status = 400, description = "Unknown event or invalid batch", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn submit_telemetry(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: Result<Json<CyberTelemetryRequest>, JsonRejection>,
) -> Result<Json<CyberTelemetryResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(
        services::cyber_defense_telemetry(&state, &user, request).await?,
    ))
}
