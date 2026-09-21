use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::dto::{
    PracticeTestListResponse, PracticeTestResponse, PracticeTestResultResponse,
    PracticeTestSubmissionRequest,
};
use crate::error::{ApiError, ErrorResponse};
use crate::routes::json_body;
use crate::services;
use crate::state::AppState;

/// Lists the practice tests (exam simulations) for a certification.
#[utoipa::path(
    get,
    path = "/v1/certifications/{certification_id}/practice-tests",
    tag = "practice-tests",
    params(("certification_id" = String, Path, description = "Certification identifier")),
    responses(
        (status = 200, description = "Available practice tests", body = PracticeTestListResponse)
    )
)]
pub async fn list_practice_tests(
    State(state): State<AppState>,
    Path(certification_id): Path<String>,
) -> Json<PracticeTestListResponse> {
    Json(services::list_practice_tests(&state, &certification_id))
}

/// Returns learner-safe practice-test content, before submission.
///
/// Canonical answers, per-choice feedback, and scored flags are never included.
#[utoipa::path(
    get,
    path = "/v1/certifications/{certification_id}/practice-tests/{practice_test_id}",
    tag = "practice-tests",
    params(
        ("certification_id" = String, Path, description = "Certification identifier"),
        ("practice_test_id" = String, Path, description = "Practice-test identifier")
    ),
    responses(
        (status = 200, description = "Learner-safe practice test", body = PracticeTestResponse),
        (status = 404, description = "Unknown practice test", body = ErrorResponse)
    )
)]
pub async fn get_practice_test(
    State(state): State<AppState>,
    Path((certification_id, practice_test_id)): Path<(String, String)>,
) -> Result<Json<PracticeTestResponse>, ApiError> {
    Ok(Json(services::get_practice_test(
        &state,
        &certification_id,
        &practice_test_id,
    )?))
}

/// Scores and reviews a complete practice-test attempt.
///
/// The whole attempt is submitted at once; the response reveals canonical
/// answers, explanations, and per-choice feedback. The raw practice score is
/// not an AWS scaled score.
#[utoipa::path(
    post,
    path = "/v1/certifications/{certification_id}/practice-tests/{practice_test_id}/submit",
    tag = "practice-tests",
    params(
        ("certification_id" = String, Path, description = "Certification identifier"),
        ("practice_test_id" = String, Path, description = "Practice-test identifier")
    ),
    request_body = PracticeTestSubmissionRequest,
    responses(
        (status = 200, description = "Scored practice test", body = PracticeTestResultResponse),
        (status = 400, description = "Invalid submission", body = ErrorResponse),
        (status = 404, description = "Unknown practice test", body = ErrorResponse)
    )
)]
pub async fn submit_practice_test(
    State(state): State<AppState>,
    Path((certification_id, practice_test_id)): Path<(String, String)>,
    body: Result<Json<PracticeTestSubmissionRequest>, JsonRejection>,
) -> Result<Json<PracticeTestResultResponse>, ApiError> {
    let request = json_body(body)?;
    Ok(Json(services::submit_practice_test(
        &state,
        &certification_id,
        &practice_test_id,
        request,
    )?))
}
