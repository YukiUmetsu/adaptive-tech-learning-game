pub mod certifications;
pub mod health;
pub mod learning;
pub mod me;
pub mod missions;
pub mod openapi;
pub mod recommendations;
pub mod sync;
pub mod wallet;

use axum::Json;
use axum::extract::Path;
use axum::extract::rejection::{JsonRejection, PathRejection};
use uuid::Uuid;

use crate::error::ApiError;

/// Converts a JSON extractor rejection into a structured API error.
pub(crate) fn json_body<T>(result: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    result
        .map(|Json(value)| value)
        .map_err(|rejection| ApiError::BadRequest(format!("malformed request body: {rejection}")))
}

/// Converts a path extractor rejection into a structured API error.
pub(crate) fn uuid_path(result: Result<Path<Uuid>, PathRejection>) -> Result<Uuid, ApiError> {
    result
        .map(|Path(value)| value)
        .map_err(|rejection| ApiError::BadRequest(format!("invalid path parameter: {rejection}")))
}
