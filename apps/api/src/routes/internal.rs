use axum::Json;
use axum::extract::{Query, State};

use crate::auth::AuthenticatedUser;
use crate::dto::ModelEvaluationResponse;
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Optional filters for the internal evaluation summary.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ModelEvaluationQuery {
    /// Model version to evaluate. Defaults to the current model.
    #[serde(default)]
    pub model_version: Option<String>,
    /// Number of calibration buckets (1-20). Defaults to 5.
    #[serde(default)]
    pub bucket_count: Option<usize>,
}

/// Internal calibration summary for a model version.
///
/// Analytics only: returns aggregate metrics, never per-user data. Requires an
/// authenticated account and is not part of the learner-facing surface.
#[utoipa::path(
    get,
    path = "/internal/model-evaluation",
    tag = "internal",
    params(ModelEvaluationQuery),
    responses(
        (status = 200, description = "Evaluation summary", body = ModelEvaluationResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_model_evaluation(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Query(query): Query<ModelEvaluationQuery>,
) -> Result<Json<ModelEvaluationResponse>, ApiError> {
    let model_version = query
        .model_version
        .unwrap_or_else(|| adaptive_learn_domain::MODEL_VERSION.to_owned());
    let bucket_count = query.bucket_count.unwrap_or(5).clamp(1, 20);

    Ok(Json(
        services::model_evaluation(&state, &model_version, bucket_count).await?,
    ))
}
