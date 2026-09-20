use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, Query, State};

use crate::auth::AuthenticatedUser;
use crate::dto::RecommendationResponse;
use crate::error::{ApiError, ErrorResponse};
use crate::services;
use crate::state::AppState;

/// Path parameters for a learning-track recommendation.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct RecommendationPath {
    /// Learning track identifier, for example `ai-python-fluency`.
    pub track_id: String,
}

/// Optional client discovery progress for a recommendation.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RecommendationQuery {
    /// Comma-separated knowledge-node ids the learner has already explored.
    ///
    /// Discovery progress lives on the client, so it is optional. When omitted
    /// the planner falls back to accepted quiz evidence.
    #[serde(default)]
    pub explored_node_ids: Option<String>,
}

/// Returns a best-effort next-action recommendation for a learning track.
///
/// This is an optional, explainable layer over the derived concept state. It
/// never gates the dashboard, knowledge maps, or quizzes, and it never creates
/// learning evidence. Requires an authenticated account.
#[utoipa::path(
    get,
    path = "/v1/tracks/{track_id}/recommendation",
    tag = "recommendations",
    params(RecommendationPath, RecommendationQuery),
    responses(
        (status = 200, description = "Next-action recommendation", body = RecommendationResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 404, description = "Unknown learning track", body = ErrorResponse)
    ),
    security(("bearerAuth" = []))
)]
pub async fn get_recommendation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    path: Result<Path<RecommendationPath>, PathRejection>,
    Query(query): Query<RecommendationQuery>,
) -> Result<Json<RecommendationResponse>, ApiError> {
    let Path(path) = path.map_err(|rejection| {
        ApiError::BadRequest(format!("invalid path parameter: {rejection}"))
    })?;
    let explored = parse_explored_node_ids(query.explored_node_ids.as_deref());

    Ok(Json(
        services::recommendation(&state, &user, &path.track_id, &explored).await?,
    ))
}

/// Splits a comma-separated discovery list, ignoring blanks.
fn parse_explored_node_ids(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .collect()
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explored_node_ids_are_split_and_trimmed() {
        assert_eq!(
            parse_explored_node_ids(Some(" n1 , n2 ,, n3 ")),
            vec!["n1".to_owned(), "n2".to_owned(), "n3".to_owned()]
        );
        assert!(parse_explored_node_ids(None).is_empty());
        assert!(parse_explored_node_ids(Some("  ")).is_empty());
    }
}
