use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use utoipa::ToSchema;

/// Errors that can be returned to an HTTP client.
///
/// Internal errors keep their cause in logs but expose only a generic message
/// to callers, so database and provider details never leak over the wire.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// The requested resource does not exist.
    #[error("resource not found")]
    NotFound,
    /// The request was malformed or failed validation.
    #[error("{0}")]
    BadRequest(String),
    /// Authentication is required and was missing or invalid.
    #[error("authentication required")]
    Unauthorized,
    /// The caller is authenticated but not permitted.
    #[error("not permitted")]
    Forbidden,
    /// The wallet cannot cover the requested spend.
    #[error("insufficient Bits")]
    InsufficientBits,
    /// The request conflicts with current state.
    #[error("{0}")]
    Conflict(String),
    /// The mission references content that no longer exists because the
    /// certification content changed after the mission was issued.
    ///
    /// A distinct code lets the client drop the stale mission and start a new
    /// one instead of retrying an answer that can never be accepted.
    #[error("study mission is based on content that has changed")]
    MissionStale,
    /// A dependency is temporarily unavailable.
    #[error("service temporarily unavailable")]
    Unavailable,
    /// An unexpected server-side failure.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    /// HTTP status code for this error.
    pub const fn status(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::InsufficientBits => StatusCode::CONFLICT,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::MissionStale => StatusCode::CONFLICT,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// Stable, machine-readable error code.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::BadRequest(_) => "bad_request",
            Self::Unauthorized => "unauthorized",
            Self::Forbidden => "forbidden",
            Self::InsufficientBits => "insufficient_bits",
            Self::Conflict(_) => "conflict",
            Self::MissionStale => "mission_content_stale",
            Self::Unavailable => "unavailable",
            Self::Internal(_) => "internal_error",
        }
    }

    fn public_message(&self) -> &str {
        match self {
            Self::Internal(_) => "internal server error",
            Self::MissionStale => {
                "this study mission was created from an older content version; start a new mission"
            }
            other => match other {
                Self::BadRequest(message) | Self::Conflict(message) => message,
                _ => other.code(),
            },
        }
    }
}

impl From<adaptive_learn_db::DbError> for ApiError {
    fn from(error: adaptive_learn_db::DbError) -> Self {
        Self::Internal(error.into())
    }
}

/// Envelope returned for every API error.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    /// Error payload.
    pub error: ErrorBody,
}

/// Structured error details.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// Stable error code.
    pub code: String,
    /// Safe, human-readable message.
    pub message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code().to_owned();
        let message = self.public_message().to_owned();

        if let Self::Internal(error) = &self {
            tracing::error!(error = %error, "request failed");
        }

        let body = ErrorResponse {
            error: ErrorBody { code, message },
        };

        (status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    async fn body_json(error: ApiError) -> (StatusCode, serde_json::Value) {
        let response = error.into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("read body");
        let json = serde_json::from_slice(&bytes).expect("valid json");
        (status, json)
    }

    #[tokio::test]
    async fn not_found_maps_to_404() {
        let (status, body) = body_json(ApiError::NotFound).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"]["code"], "not_found");
    }

    #[tokio::test]
    async fn bad_request_preserves_safe_message() {
        let (status, body) = body_json(ApiError::BadRequest(
            "event_count must not be negative".to_owned(),
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["message"], "event_count must not be negative");
    }

    #[tokio::test]
    async fn internal_error_does_not_leak_cause() {
        let cause = anyhow::anyhow!("connection string postgres://user:secret@host/db refused");
        let (status, body) = body_json(ApiError::Internal(cause)).await;

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"]["code"], "internal_error");
        assert_eq!(body["error"]["message"], "internal server error");
        assert!(!body.to_string().contains("secret"));
    }

    #[tokio::test]
    async fn mission_stale_maps_to_a_recoverable_conflict() {
        let (status, body) = body_json(ApiError::MissionStale).await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"]["code"], "mission_content_stale");
        assert!(
            body["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains("start a new mission")),
            "{body}"
        );
    }
}
