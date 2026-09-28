use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

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
    /// The learner already has an active repeatable Operation.
    #[error("an active operation already exists")]
    ActiveOperationExists(Uuid),
    /// Repeatable Operations are locked until the Chapter 1 campaign is cleared.
    #[error("complete Chapter 1 before starting Operations")]
    CyberOperationsLocked,
    /// The requested story-gated Operation is not unlocked yet.
    #[error("this Operation is not unlocked yet")]
    CyberOperationLocked,
    /// The Operation's configuration is frozen because the battle has started.
    #[error("this Operation is already deployed")]
    CyberOperationAlreadyDeployed,
    /// The Operation is still configurable and has never been deployed, so it
    /// has no battle to settle.
    #[error("this Operation has not been deployed")]
    CyberOperationNotDeployed,
    /// The campaign mission's prerequisite has not been completed.
    #[error("complete the previous campaign mission first")]
    CyberCampaignMissionLocked,
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
            Self::ActiveOperationExists(_) => StatusCode::CONFLICT,
            Self::CyberOperationsLocked => StatusCode::FORBIDDEN,
            Self::CyberOperationLocked => StatusCode::FORBIDDEN,
            Self::CyberOperationAlreadyDeployed => StatusCode::CONFLICT,
            Self::CyberOperationNotDeployed => StatusCode::CONFLICT,
            Self::CyberCampaignMissionLocked => StatusCode::FORBIDDEN,
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
            Self::ActiveOperationExists(_) => "active_operation_exists",
            Self::CyberOperationsLocked => "cyber_operations_locked",
            Self::CyberOperationLocked => "cyber_operation_locked",
            Self::CyberOperationAlreadyDeployed => "cyber_operation_already_deployed",
            Self::CyberOperationNotDeployed => "cyber_operation_not_deployed",
            Self::CyberCampaignMissionLocked => "cyber_campaign_mission_locked",
            Self::MissionStale => "mission_content_stale",
            Self::Unavailable => "unavailable",
            Self::Internal(_) => "internal_error",
        }
    }

    fn public_message(&self) -> &str {
        match self {
            Self::Internal(_) => "internal server error",
            Self::CyberOperationsLocked => "Complete Chapter 1 before starting Operations.",
            Self::CyberOperationLocked => "This Operation is not unlocked yet.",
            Self::CyberOperationAlreadyDeployed => {
                "This Operation is already deployed; its loadout is locked."
            }
            Self::CyberOperationNotDeployed => "Deploy this Operation before it can be settled.",
            Self::CyberCampaignMissionLocked => "Complete the previous campaign mission first.",
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
    /// Active Operation run id, when the error is `active_operation_exists`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_run_id: Option<Uuid>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code().to_owned();
        let message = self.public_message().to_owned();
        let active_run_id = match &self {
            Self::ActiveOperationExists(run_id) => Some(*run_id),
            _ => None,
        };

        if let Self::Internal(error) = &self {
            tracing::error!(error = %error, "request failed");
        }

        let body = ErrorResponse {
            error: ErrorBody {
                code,
                message,
                active_run_id,
            },
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

    #[tokio::test]
    async fn locked_operations_map_to_a_forbidden_code() {
        let (status, body) = body_json(ApiError::CyberOperationsLocked).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["error"]["code"], "cyber_operations_locked");
        assert!(
            body["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains("Chapter 1")),
            "{body}"
        );
    }
}
