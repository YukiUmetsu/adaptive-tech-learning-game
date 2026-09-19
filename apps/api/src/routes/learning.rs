use axum::Json;
use axum::extract::{Path, State};

use crate::auth::AuthenticatedUser;
use crate::dto::LearningDomainResponse;
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Path parameters for a domain's learning content.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct LearningDomainPath {
    /// Certification identifier, for example `aws-soa-c03`.
    pub certification_id: String,
    /// Domain identifier, for example `domain-1`.
    pub domain_id: String,
}

/// Returns the pre-quiz learning content for a certification domain.
///
/// This is the Knowledge Map curriculum: modules, knowledge nodes, and
/// progressive reveals. It is a discovery mechanic, not a scored assessment, so
/// it is deliberately separate from mission issuance and scoring. Learning
/// content requires an authenticated account.
#[utoipa::path(
    get,
    path = "/v1/certifications/{certification_id}/domains/{domain_id}/learning",
    tag = "learning",
    params(LearningDomainPath),
    responses(
        (status = 200, description = "Domain learning content", body = LearningDomainResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "No learning content for this domain")
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_learning_domain(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    path: Result<Path<LearningDomainPath>, axum::extract::rejection::PathRejection>,
) -> Result<Json<LearningDomainResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;

    Ok(Json(services::learning_domain(
        &state,
        &path.certification_id,
        &path.domain_id,
    )?))
}
