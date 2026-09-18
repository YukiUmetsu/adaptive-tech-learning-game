//! OpenAPI document generation.
//!
//! Rust response types are the source of truth for the HTTP contract. The web
//! client is generated from this document, so the two never drift by hand.

use utoipa::OpenApi;

use crate::error::{ErrorBody, ErrorResponse};
use crate::routes::health::{DatabaseStatus, HealthResponse, HealthStatus};

/// Declares the public API surface.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Adaptive Learning API",
        description = "Operational endpoints today; learning, sync, and economy endpoints in later phases."
    ),
    paths(crate::routes::health::health, crate::routes::openapi::openapi_json),
    components(schemas(
        HealthResponse,
        HealthStatus,
        DatabaseStatus,
        ErrorResponse,
        ErrorBody
    )),
    tags((name = "system", description = "Operational endpoints"))
)]
pub struct ApiDoc;

/// Returns the OpenAPI document with the crate version applied at runtime.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let mut document = ApiDoc::openapi();
    document.info.version = env!("CARGO_PKG_VERSION").to_owned();
    document
}
