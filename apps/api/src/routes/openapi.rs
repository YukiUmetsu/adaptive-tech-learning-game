use axum::Json;

/// Serves the generated OpenAPI document.
///
/// The document is the source of truth for the TypeScript client. Regenerate it
/// with `cargo run -p adaptive-learn-api --bin export-openapi` or the web
/// `pnpm generate:api` script.
#[utoipa::path(
    get,
    path = "/openapi.json",
    tag = "system",
    responses((status = 200, description = "OpenAPI 3 document"))
)]
pub async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(crate::openapi::openapi())
}
