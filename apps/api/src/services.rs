//! Application services for the Phase 1 learning API.
//!
//! Handlers stay thin; this module owns mission issuance, scoring, sync, and
//! completion. Scores are always recomputed from canonical content.

use std::collections::{HashMap, HashSet};

use adaptive_learn_content::{SubmittedAnswer, score};
use adaptive_learn_db as db;
use adaptive_learn_domain::{ConceptWeight, LearningEvent, MissionInstance, MissionStatus};
use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::dto::{
    AnswerPayload, AnswerRequest, CatalogResponse, CertificationDto, CertificationVersionDto,
    CompleteMissionResponse, DomainDto, FeedbackResponse, IssueMissionRequest, MissionResponse,
    QuestionView, SyncEventRequest, SyncEventResult, SyncRequest, SyncResponse, TaskDto,
};
use crate::error::ApiError;
use crate::state::AppState;

/// Missions expire after one hour. Long enough for a study session, short
/// enough that stale missions do not accumulate.
const MISSION_TTL_MINUTES: i64 = 60;

/// Response times are capped so background time cannot inflate study time.
const MAX_RESPONSE_MS: i32 = 30 * 60 * 1000;

/// Builds the certification catalog.
pub fn catalog(state: &AppState) -> CatalogResponse {
    let certifications = state
        .content
        .bundles()
        .iter()
        .map(|bundle| CertificationDto {
            id: bundle.certification.id.clone(),
            vendor: bundle.certification.vendor.clone(),
            name: bundle.certification.name.clone(),
            exam_code: bundle.certification.exam_code.clone(),
            official_source_url: bundle.certification.official_source_url.clone(),
            last_reviewed: bundle.certification.last_reviewed.clone(),
            versions: vec![CertificationVersionDto {
                id: bundle.version.id.clone(),
                exam_code: bundle.version.exam_code.clone(),
                effective_date: bundle.version.effective_date.clone(),
                content_version: bundle.version.content_version.clone(),
                domains: bundle
                    .version
                    .domains
                    .iter()
                    .map(|domain| DomainDto {
                        id: domain.id.clone(),
                        name: domain.name.clone(),
                        weight: domain.weight,
                        tasks: domain
                            .tasks
                            .iter()
                            .map(|task| TaskDto {
                                id: task.id.clone(),
                                name: task.name.clone(),
                                question_count: task.question_ids.len(),
                            })
                            .collect(),
                    })
                    .collect(),
            }],
        })
        .collect();

    CatalogResponse { certifications }
}

/// Issues a deterministic mission for a task.
pub async fn issue_mission(
    state: &AppState,
    request: IssueMissionRequest,
) -> Result<MissionResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(&request.certification_id)
        .ok_or(ApiError::NotFound)?;

    if bundle.version.id != request.certification_version {
        return Err(ApiError::BadRequest(
            "unknown certification version for this certification".to_owned(),
        ));
    }

    let (domain, task) = state
        .content
        .find_task(&request.certification_version, &request.task_id)
        .ok_or(ApiError::NotFound)?;

    let questions = state
        .content
        .questions_for_task(&request.certification_version, &request.task_id);
    if questions.is_empty() {
        return Err(ApiError::NotFound);
    }

    let now = Utc::now();
    let mission = MissionInstance {
        id: Uuid::new_v4(),
        device_id: request.device_id,
        certification_id: bundle.certification.id.clone(),
        certification_version: bundle.version.id.clone(),
        content_version: bundle.version.content_version.clone(),
        domain_id: domain.id.clone(),
        task_id: task.id.clone(),
        question_ids: questions
            .iter()
            .map(|question| question.id.clone())
            .collect(),
        status: MissionStatus::Issued,
        issued_at: now,
        expires_at: now + Duration::minutes(MISSION_TTL_MINUTES),
        completed_at: None,
    };

    let stored = db::missions::insert(&state.pool, &mission).await?;

    Ok(MissionResponse {
        id: stored.id,
        device_id: stored.device_id,
        certification_id: stored.certification_id,
        certification_version: stored.certification_version,
        content_version: stored.content_version,
        domain_id: stored.domain_id,
        task_id: stored.task_id,
        issued_at: stored.issued_at,
        expires_at: stored.expires_at,
        questions: questions
            .iter()
            .map(|question| question_view(question))
            .collect(),
    })
}

/// Scores one attempt without persisting an event.
///
/// Persistence happens through `sync`, which keeps offline replay idempotent.
pub async fn score_attempt(
    state: &AppState,
    mission_id: Uuid,
    request: AnswerRequest,
) -> Result<FeedbackResponse, ApiError> {
    let mission = load_mission(state, mission_id).await?;
    if mission.status == MissionStatus::Completed {
        return Err(ApiError::Conflict(
            "mission is already completed".to_owned(),
        ));
    }
    let question = resolve_question(
        state,
        &mission,
        &request.device_id,
        &request.question_id,
        &request.content_version,
    )?;
    validate_attempt_metadata(request.attempt_number, request.hint_count)?;
    let submitted = to_submitted(request.answer)?;
    let scored =
        score(question, &submitted).map_err(|error| ApiError::BadRequest(error.to_string()))?;

    Ok(FeedbackResponse {
        event_id: request.event_id,
        question_id: request.question_id,
        correct: scored.correct,
        score: scored.score,
        error_codes: scored.error_codes,
        explanation: question.explanation.clone(),
        canonical_answer: scored.canonical,
        concepts: concept_weights(question),
    })
}

/// Reconciles a batch of attempts, re-scoring each against canonical content.
///
/// Missions are loaded once per batch. Each event is validated independently so
/// one bad event does not discard the rest of an offline queue.
pub async fn sync(state: &AppState, request: SyncRequest) -> Result<SyncResponse, ApiError> {
    let mut results = Vec::with_capacity(request.events.len());

    // Load each distinct mission once instead of per event (avoids N+1 reads).
    let mission_ids: HashSet<Uuid> = request
        .events
        .iter()
        .map(|event| event.mission_instance_id)
        .collect();
    let mut missions: HashMap<Uuid, MissionInstance> = HashMap::new();
    for mission_id in mission_ids {
        match load_mission(state, mission_id).await {
            Ok(mission) => {
                missions.insert(mission_id, mission);
            }
            Err(ApiError::NotFound) => {}
            Err(error) => return Err(error),
        }
    }

    for event in request.events {
        let event_id = event.event_id;
        let mission_id = event.mission_instance_id;

        let Some(mission) = missions.get(&mission_id).cloned() else {
            results.push(reject(event_id, "not_found"));
            continue;
        };

        match apply_event(state, &request.device_id, &mission, event).await {
            Ok(()) => results.push(SyncEventResult {
                event_id,
                accepted: true,
                error_code: None,
            }),
            Err(SyncRejection::Fatal(error)) => return Err(ApiError::Internal(error)),
            Err(SyncRejection::Rejected(code)) => results.push(reject(event_id, code)),
        }
    }

    Ok(SyncResponse { results })
}

fn reject(event_id: Uuid, code: impl Into<String>) -> SyncEventResult {
    SyncEventResult {
        event_id,
        accepted: false,
        error_code: Some(code.into()),
    }
}

/// Why a single synced event was not accepted.
enum SyncRejection {
    /// The event is invalid; other events in the batch may still succeed.
    Rejected(String),
    /// An infrastructure failure that aborts the whole batch.
    Fatal(anyhow::Error),
}

/// Marks a mission completed for its owning device.
pub async fn complete_mission(
    state: &AppState,
    mission_id: Uuid,
    device_id: Uuid,
) -> Result<CompleteMissionResponse, ApiError> {
    let updated = db::missions::mark_completed(&state.pool, mission_id, device_id).await?;
    let mission = match updated {
        Some(mission) => mission,
        None => {
            return match db::missions::find_by_id(&state.pool, mission_id).await? {
                Some(_) => Err(ApiError::Forbidden),
                None => Err(ApiError::NotFound),
            };
        }
    };

    Ok(CompleteMissionResponse {
        id: mission.id,
        status: mission.status,
        completed_at: mission.completed_at,
    })
}

async fn apply_event(
    state: &AppState,
    device_id: &Uuid,
    mission: &MissionInstance,
    event: SyncEventRequest,
) -> Result<(), SyncRejection> {
    if &mission.device_id != device_id {
        return Err(SyncRejection::Rejected("forbidden".to_owned()));
    }
    if !mission
        .question_ids
        .iter()
        .any(|id| id == &event.question_id)
    {
        return Err(SyncRejection::Rejected("bad_request".to_owned()));
    }
    if mission.content_version != event.content_version {
        return Err(SyncRejection::Rejected("conflict".to_owned()));
    }

    let question = state
        .content
        .question(&mission.certification_version, &event.question_id)
        .ok_or_else(|| {
            SyncRejection::Fatal(anyhow::anyhow!(
                "mission {} references unknown question {}",
                mission.id,
                event.question_id
            ))
        })?;
    if question.content_version != mission.content_version {
        return Err(SyncRejection::Rejected("conflict".to_owned()));
    }

    let submitted = to_submitted(event.answer)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;
    let scored = score(question, &submitted)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;

    // The database assigns the next attempt number inside a locked transaction.
    // Hints are not implemented in Phase 1, so the server records zero rather
    // than trusting a client count.
    let learning_event = LearningEvent {
        event_id: event.event_id,
        device_id: mission.device_id,
        mission_instance_id: mission.id,
        certification_id: mission.certification_id.clone(),
        certification_version: mission.certification_version.clone(),
        domain_id: mission.domain_id.clone(),
        task_id: mission.task_id.clone(),
        question_id: event.question_id,
        content_version: mission.content_version.clone(),
        concepts: concept_weights(question),
        assessment_mode: question.assessment_mode,
        interaction_type: question.interaction_type,
        score: scored.score,
        attempt_number: 1,
        hint_count: 0,
        response_ms: event.response_ms.clamp(0, MAX_RESPONSE_MS),
        structured_error_codes: scored.error_codes,
        occurred_at: event.occurred_at,
    };

    db::learning_events::insert_with_next_attempt(&state.pool, &learning_event)
        .await
        .map_err(|error| SyncRejection::Fatal(error.into()))?;
    Ok(())
}

async fn load_mission(state: &AppState, mission_id: Uuid) -> Result<MissionInstance, ApiError> {
    db::missions::find_by_id(&state.pool, mission_id)
        .await?
        .ok_or(ApiError::NotFound)
}

fn resolve_question<'a>(
    state: &'a AppState,
    mission: &MissionInstance,
    device_id: &Uuid,
    question_id: &str,
    content_version: &str,
) -> Result<&'a adaptive_learn_content::Question, ApiError> {
    if &mission.device_id != device_id {
        return Err(ApiError::Forbidden);
    }
    if !mission.question_ids.iter().any(|id| id == question_id) {
        return Err(ApiError::BadRequest(
            "question is not part of this mission".to_owned(),
        ));
    }
    if mission.content_version != content_version {
        return Err(ApiError::Conflict("content version mismatch".to_owned()));
    }

    let question = state
        .content
        .question(&mission.certification_version, question_id)
        .ok_or_else(|| {
            ApiError::Internal(anyhow::anyhow!(
                "mission {} references unknown question {}",
                mission.id,
                question_id
            ))
        })?;

    if question.content_version != mission.content_version {
        return Err(ApiError::Conflict("content version mismatch".to_owned()));
    }

    Ok(question)
}

fn validate_attempt_metadata(attempt_number: i32, hint_count: i32) -> Result<(), ApiError> {
    if !(1..=50).contains(&attempt_number) {
        return Err(ApiError::BadRequest(
            "attempt_number must be between 1 and 50".to_owned(),
        ));
    }
    if !(0..=20).contains(&hint_count) {
        return Err(ApiError::BadRequest(
            "hint_count must be between 0 and 20".to_owned(),
        ));
    }
    Ok(())
}

fn to_submitted(payload: AnswerPayload) -> Result<SubmittedAnswer, ApiError> {
    match (payload.placements, payload.ordered_ids, payload.edges) {
        (Some(placements), None, None) => Ok(SubmittedAnswer::Classification(placements)),
        (None, Some(ordered_ids), None) => Ok(SubmittedAnswer::Ordering(ordered_ids)),
        (None, None, Some(edges)) => {
            let mut pairs = Vec::with_capacity(edges.len());
            for edge in edges {
                if edge.len() != 2 {
                    return Err(ApiError::BadRequest(
                        "each edge must have exactly two endpoints".to_owned(),
                    ));
                }
                pairs.push((edge[0].clone(), edge[1].clone()));
            }
            Ok(SubmittedAnswer::NodeConnection(pairs))
        }
        _ => Err(ApiError::BadRequest(
            "answer must contain exactly one of placements, ordered_ids, or edges".to_owned(),
        )),
    }
}

fn concept_weights(question: &adaptive_learn_content::Question) -> Vec<ConceptWeight> {
    question
        .concepts
        .iter()
        .map(|concept| ConceptWeight {
            concept_id: concept.concept_id.clone(),
            weight: concept.weight,
        })
        .collect()
}

fn question_view(question: &adaptive_learn_content::Question) -> QuestionView {
    QuestionView {
        id: question.id.clone(),
        prompt: question.prompt.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: concept_weights(question),
        hints: question.hints.clone(),
        interaction: question.interaction.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn answer_payload_must_have_exactly_one_shape() {
        let empty = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
        });
        assert!(empty.is_err());

        let two_shapes = to_submitted(AnswerPayload {
            placements: Some(BTreeMap::new()),
            ordered_ids: Some(vec!["a".to_owned()]),
            edges: None,
        });
        assert!(two_shapes.is_err());
    }

    #[test]
    fn edges_must_have_two_endpoints() {
        let bad = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: Some(vec![vec!["only-one".to_owned()]]),
        });
        assert!(bad.is_err());

        let good = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: Some(vec![vec!["a".to_owned(), "b".to_owned()]]),
        });
        assert_eq!(
            good.expect("valid edge"),
            SubmittedAnswer::NodeConnection(vec![("a".to_owned(), "b".to_owned())])
        );
    }

    #[test]
    fn attempt_metadata_is_bounded() {
        assert!(validate_attempt_metadata(1, 0).is_ok());
        assert!(validate_attempt_metadata(0, 0).is_err());
        assert!(validate_attempt_metadata(1, -1).is_err());
    }
}
