use axum::Json;
use axum::extract::State;

use crate::dto::CatalogResponse;
use crate::services;
use crate::state::AppState;

/// Lists certifications, versions, domains, and authored tasks.
#[utoipa::path(
    get,
    path = "/v1/certifications",
    tag = "catalog",
    responses((status = 200, description = "Certification catalog", body = CatalogResponse))
)]
pub async fn list_certifications(State(state): State<AppState>) -> Json<CatalogResponse> {
    Json(services::catalog(&state))
}
