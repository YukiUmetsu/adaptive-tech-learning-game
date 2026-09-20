//! Application services for the Phase 1 learning API.
//!
//! Handlers stay thin; this module owns mission issuance, scoring, sync, and
//! completion. Scores are always recomputed from canonical content.
//!
//! Ownership is user-based: services receive the authenticated identity and
//! check `mission.user_id`, never the client-supplied `device_id`. A device may
//! still be recorded as context.

use std::collections::{HashMap, HashSet};

use adaptive_learn_content::{Question, SubmittedAnswer, score};
use adaptive_learn_db as db;
use adaptive_learn_domain::{
    ConceptWeight, LearningEvent, MissionInstance, MissionStatus, QuizMode, reward_bits,
};
use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::dto::{
    AnswerPayload, AnswerRequest, CatalogResponse, CertificationDto, CertificationVersionDto,
    CompleteMissionResponse, ConceptDto, DomainDto, FeedbackResponse, IssueMissionRequest,
    LearningDomainResponse, MissionResponse, QuestionView, RecommendationResponse,
    SyncEventRequest, SyncEventResult, SyncRequest, SyncResponse, TaskDto, WalletResponse,
};
use crate::error::ApiError;
use crate::planner::{
    self, ConceptStateView, PlannerDomain, PlannerInput, PlannerNode, PlannerQuestion,
};
use crate::selection::{self, Candidate, ConceptEvidence, HistoryEntry};
use crate::state::AppState;

/// Response times are capped so background time cannot inflate study time.
const MAX_RESPONSE_MS: i32 = 30 * 60 * 1000;

/// How many recent accepted events inform adaptive selection.
const HISTORY_LIMIT: i64 = 500;

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
                        learning_available: state
                            .content
                            .learning_available(&bundle.certification.id, &domain.id),
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
                concepts: bundle
                    .concepts
                    .iter()
                    .map(|concept| ConceptDto {
                        id: concept.id.clone(),
                        name: concept.name.clone(),
                    })
                    .collect(),
            }],
        })
        .collect();

    CatalogResponse { certifications }
}

/// Returns learner-facing learning content for one certification domain.
///
/// Learning is a discovery layer, so this never includes quiz canonical answers
/// and never touches scoring or mission state.
pub fn learning_domain(
    state: &AppState,
    certification_id: &str,
    domain_id: &str,
) -> Result<LearningDomainResponse, ApiError> {
    let domain = state
        .content
        .learning_domain_for_certification(certification_id, domain_id)
        .ok_or(ApiError::NotFound)?;

    Ok(LearningDomainResponse {
        schema_version: domain.schema_version.clone(),
        content_version: domain.content_version.clone(),
        certification_id: domain.certification_id.clone(),
        certification_version: domain.certification_version.clone(),
        exam_guide_revision: domain.exam_guide_revision.clone(),
        domain: domain.domain.clone(),
        learning_design: domain.learning_design.clone(),
        source_refs: domain.source_refs.clone(),
        modules: domain.modules.clone(),
    })
}

/// Builds a best-effort next-action recommendation for a learning track.
///
/// The planner is pure and track-agnostic; this function only assembles its
/// input from content, derived concept state, and accepted history. Auxiliary
/// logging is best-effort and never fails the recommendation or learning flow.
pub async fn recommendation(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    explored_node_ids: &[String],
) -> Result<RecommendationResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();

    let states = db::concept_state::list_for_user(&state.pool, user.id, &track_version).await?;
    let history =
        db::learning_events::recent_for_user(&state.pool, user.id, track_id, HISTORY_LIMIT).await?;

    let domains: Vec<PlannerDomain> = bundle
        .version
        .domains
        .iter()
        .map(|domain| PlannerDomain {
            id: domain.id.clone(),
            name: domain.name.clone(),
            weight: domain.weight,
        })
        .collect();

    let nodes = planner_nodes(state, &track_version);
    let questions: Vec<PlannerQuestion> = state
        .content
        .questions_for_version(&track_version)
        .into_iter()
        .map(|question| PlannerQuestion {
            id: question.id.clone(),
            domain_id: question.domain_id.clone(),
            assessment_mode: question.assessment_mode,
            difficulty_prior: question.difficulty_prior,
            concepts: concept_weights(question),
        })
        .collect();

    let input = PlannerInput {
        track_id: track_id.to_owned(),
        track_version: track_version.clone(),
        now: Utc::now(),
        states: states
            .into_iter()
            .map(|state| ConceptStateView {
                concept_id: state.concept_id,
                assessment_mode: state.assessment_mode,
                estimate: state.estimate,
                evidence_mass: state.evidence_mass,
                exposure_count: state.exposure_count,
                last_practiced_at: state.last_practiced_at,
            })
            .collect(),
        domains,
        nodes,
        questions,
        explored_node_ids: explored_node_ids.iter().cloned().collect(),
        recent_question_ids: history.into_iter().map(|entry| entry.question_id).collect(),
    };

    let recommendation = planner::recommend(&input);

    if let Some(choice) = &recommendation {
        let entry = db::recommendations::RecommendationLogEntry {
            user_id: user.id,
            track_id: &choice.track_id,
            track_version: &track_version,
            action: choice.action.as_str(),
            reason: choice.reason.as_str(),
            domain_id: Some(choice.domain_id.as_str()),
            node_id: choice.node_id.as_deref(),
            question_id: choice.question_id.as_deref(),
            concept_ids: &choice.concept_ids,
        };
        log_recommendation(&state.pool, &entry).await;
    }

    Ok(RecommendationResponse { recommendation })
}

/// Logs a recommendation without ever letting a persistence problem escape.
///
/// Recommendation history is auxiliary data: a missing table, an unreachable
/// database, or a constraint failure must not fail the request or the learning
/// flow.
async fn log_recommendation(
    pool: &db::PgPool,
    entry: &db::recommendations::RecommendationLogEntry<'_>,
) {
    if let Err(error) = db::recommendations::log(pool, entry).await {
        tracing::debug!(error = %error, "could not log recommendation");
    }
}

/// Flattens the track's knowledge-map nodes for the planner.
fn planner_nodes(state: &AppState, track_version: &str) -> Vec<PlannerNode> {
    let mut nodes = Vec::new();
    for domain in state
        .content
        .learning_domains()
        .iter()
        .filter(|domain| domain.certification_version == track_version)
    {
        for module in &domain.modules {
            for node in &module.nodes {
                nodes.push(PlannerNode {
                    id: node.id.clone(),
                    domain_id: domain.domain.id.clone(),
                    module_id: module.id.clone(),
                    title: node.title.clone(),
                    module_prerequisite_ids: module.prerequisite_module_ids.clone(),
                    prerequisite_node_ids: node.prerequisite_node_ids.clone(),
                    concept_ids: node.concept_ids.clone(),
                });
            }
        }
    }
    nodes
}

/// Whether a certification is the public demo bundle, which may be issued
/// without an account.
///
/// Demo missions carry no account and therefore never settle Bits. They are the
/// only anonymous missions the API creates.
pub fn is_demo_certification(certification_id: &str) -> bool {
    certification_id.ends_with("-demo")
}

/// Issues a mission for a quiz mode, selecting questions server-side.
///
/// Authenticated callers get a user-owned mission. Anonymous callers may issue
/// demo task-practice missions only; those carry no owner and award no Bits.
pub async fn issue_mission(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    request: IssueMissionRequest,
) -> Result<MissionResponse, ApiError> {
    let owner = user.map(|user| user.id);

    if owner.is_none() {
        if !is_demo_certification(&request.certification_id) {
            return Err(ApiError::Unauthorized);
        }
        if request.mode != QuizMode::TaskPractice {
            return Err(ApiError::Unauthorized);
        }
    }

    let bundle = state
        .content
        .bundle_for_certification(&request.certification_id)
        .ok_or(ApiError::NotFound)?;

    if bundle.version.id != request.certification_version {
        return Err(ApiError::BadRequest(
            "unknown certification version for this certification".to_owned(),
        ));
    }

    // `device_id` is required to address an anonymous demo mission; for an
    // authenticated mission it is context and may be absent.
    if owner.is_none() && request.device_id.is_none() {
        return Err(ApiError::BadRequest(
            "demo missions require device_id".to_owned(),
        ));
    }
    let device_id = request.device_id.unwrap_or_else(Uuid::new_v4);

    let now = Utc::now();
    let (domain_id, task_id, question_ids) =
        build_question_set(state, &request, owner, now).await?;
    if question_ids.is_empty() {
        return Err(ApiError::NotFound);
    }

    let mission = MissionInstance {
        id: Uuid::new_v4(),
        user_id: owner,
        device_id,
        certification_id: bundle.certification.id.clone(),
        certification_version: bundle.version.id.clone(),
        content_version: bundle.version.content_version.clone(),
        mode: request.mode,
        domain_id,
        task_id,
        question_ids,
        status: MissionStatus::Issued,
        issued_at: now,
        expires_at: now + Duration::minutes(request.mode.ttl_minutes()),
        completed_at: None,
    };

    let stored = db::missions::insert(&state.pool, &mission).await?;

    if let (Some(user), Some(device)) = (user, request.device_id) {
        if let Err(error) = db::devices::upsert(&state.pool, device, user.id).await {
            tracing::debug!(error = %error, "could not associate device with user");
        }
    }

    let questions: Vec<QuestionView> = stored
        .question_ids
        .iter()
        .filter_map(|id| {
            state
                .content
                .question(&stored.certification_version, id)
                .map(question_view)
        })
        .collect();

    Ok(MissionResponse {
        id: stored.id,
        device_id: stored.device_id,
        certification_id: stored.certification_id,
        certification_version: stored.certification_version,
        content_version: stored.content_version,
        mode: stored.mode,
        domain_id: stored.domain_id,
        task_id: stored.task_id,
        issued_at: stored.issued_at,
        expires_at: stored.expires_at,
        questions,
    })
}

/// Builds `(domain_id, task_id, question_ids)` for a mode.
async fn build_question_set(
    state: &AppState,
    request: &IssueMissionRequest,
    owner: Option<Uuid>,
    now: chrono::DateTime<Utc>,
) -> Result<(Option<String>, Option<String>, Vec<String>), ApiError> {
    let version = &request.certification_version;

    match request.mode {
        QuizMode::TaskPractice => {
            let task_id = request
                .task_id
                .as_deref()
                .ok_or_else(|| ApiError::BadRequest("task_practice requires task_id".to_owned()))?;
            let (_, task) = state
                .content
                .find_task(version, task_id)
                .ok_or(ApiError::NotFound)?;
            let questions = state.content.questions_for_task(version, task_id);
            if questions.is_empty() {
                return Err(ApiError::NotFound);
            }
            let domain_id = questions.first().map(|question| question.domain_id.clone());
            Ok((
                domain_id,
                Some(task.id.clone()),
                questions
                    .iter()
                    .map(|question| question.id.clone())
                    .collect(),
            ))
        }
        QuizMode::DomainQuiz => {
            let domain_id = request
                .domain_id
                .clone()
                .ok_or_else(|| ApiError::BadRequest("domain_quiz requires domain_id".to_owned()))?;
            if state
                .content
                .questions_for_domain(version, &domain_id)
                .is_empty()
            {
                return Err(ApiError::NotFound);
            }
            let ids = select_ids(state, request, owner, Some(&domain_id), now).await?;
            Ok((Some(domain_id), None, ids))
        }
        QuizMode::QuickAdaptive | QuizMode::FullPractice => {
            let ids = select_ids(state, request, owner, None, now).await?;
            Ok((None, None, ids))
        }
    }
}

/// Runs the selection service for a certification-wide or domain mode.
async fn select_ids(
    state: &AppState,
    request: &IssueMissionRequest,
    owner: Option<Uuid>,
    domain_id: Option<&str>,
    now: chrono::DateTime<Utc>,
) -> Result<Vec<String>, ApiError> {
    // Adaptive modes are only issued to an authenticated account.
    let user_id = owner.ok_or(ApiError::Unauthorized)?;

    let version = &request.certification_version;
    let questions = match domain_id {
        Some(domain) => state.content.questions_for_domain(version, domain),
        None => state.content.questions_for_version(version),
    };
    if questions.is_empty() {
        return Err(ApiError::NotFound);
    }

    let candidates: Vec<Candidate> = questions.iter().map(|q| candidate_from(q)).collect();
    let domains: Vec<(String, f64)> = state
        .content
        .bundle_for_version(version)
        .map(|bundle| {
            bundle
                .version
                .domains
                .iter()
                .map(|domain| (domain.id.clone(), domain.weight))
                .collect()
        })
        .unwrap_or_default();

    // History is combined across every device the learner has signed in on.
    let history: Vec<HistoryEntry> = db::learning_events::recent_for_user(
        &state.pool,
        user_id,
        &request.certification_id,
        HISTORY_LIMIT,
    )
    .await?
    .into_iter()
    .map(|entry| HistoryEntry {
        question_id: entry.question_id,
        score: entry.score,
        assessment_mode: entry.assessment_mode,
        occurred_at: entry.occurred_at,
        concepts: entry.concepts,
    })
    .collect();

    // Derived concept state is the primary adaptation signal. It is absent for
    // a cold-start learner; selection falls back to accepted history instead.
    let states: Vec<ConceptEvidence> =
        db::concept_state::list_for_user(&state.pool, user_id, version)
            .await?
            .into_iter()
            .map(|state| ConceptEvidence {
                concept_id: state.concept_id,
                assessment_mode: state.assessment_mode,
                estimate: state.estimate,
                evidence_mass: state.evidence_mass,
                last_practiced_at: state.last_practiced_at,
            })
            .collect();

    Ok(selection::select(
        &candidates,
        &domains,
        &history,
        &states,
        request.mode,
        domain_id,
        now,
    ))
}

fn candidate_from(question: &Question) -> Candidate {
    Candidate {
        id: question.id.clone(),
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: concept_weights(question),
    }
}

/// Scores one attempt without persisting an event.
///
/// Persistence happens through `sync`, which keeps offline replay idempotent.
pub async fn score_attempt(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
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
        user,
        request.device_id,
        &request.question_id,
        &request.content_version,
    )?;
    validate_attempt_metadata(request.attempt_number, request.hint_count)?;
    let submitted = to_submitted(request.answer)?;
    let scored =
        score(question, &submitted).map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let bits_preview = reward_bits(
        request.attempt_number,
        scored.score,
        question.difficulty_prior,
    );

    Ok(FeedbackResponse {
        event_id: request.event_id,
        question_id: request.question_id,
        correct: scored.correct,
        score: scored.score,
        error_codes: scored.error_codes,
        bits_preview,
        explanation: question.explanation.clone(),
        canonical_answer: scored.canonical,
        concepts: concept_weights(question),
    })
}

/// Reconciles a batch of attempts, re-scoring each against canonical content.
///
/// Missions are loaded once per batch. Each event is validated independently so
/// one bad event does not discard the rest of an offline queue.
pub async fn sync(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    request: SyncRequest,
) -> Result<SyncResponse, ApiError> {
    let mut results = Vec::with_capacity(request.events.len());
    let device_id = request.device_id;

    if let (Some(user), Some(device)) = (user, device_id) {
        if let Err(error) = db::devices::upsert(&state.pool, device, user.id).await {
            tracing::debug!(error = %error, "could not associate device with user");
        }
    }

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

        match apply_event(state, user, device_id, &mission, event).await {
            Ok(bits_settled) => results.push(SyncEventResult {
                event_id,
                accepted: true,
                error_code: None,
                bits_settled,
            }),
            Err(SyncRejection::Fatal(error)) => return Err(ApiError::Internal(error)),
            Err(SyncRejection::Rejected(code)) => results.push(reject(event_id, code)),
        }
    }

    let bits_balance = match user {
        Some(user) => db::wallets::balance(&state.pool, user.id).await?,
        None => 0,
    };
    Ok(SyncResponse {
        results,
        bits_balance,
    })
}

fn reject(event_id: Uuid, code: impl Into<String>) -> SyncEventResult {
    SyncEventResult {
        event_id,
        accepted: false,
        error_code: Some(code.into()),
        bits_settled: 0,
    }
}

/// Returns the authenticated user's settled Bits balance.
pub async fn wallet(
    state: &AppState,
    user: &AuthenticatedUser,
) -> Result<WalletResponse, ApiError> {
    let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
    Ok(WalletResponse {
        user_id: user.id,
        bits_balance,
    })
}

/// Why a single synced event was not accepted.
enum SyncRejection {
    /// The event is invalid; other events in the batch may still succeed.
    Rejected(String),
    /// An infrastructure failure that aborts the whole batch.
    Fatal(anyhow::Error),
}

/// Marks a mission completed for its owner.
pub async fn complete_mission(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    mission_id: Uuid,
    device_id: Option<Uuid>,
) -> Result<CompleteMissionResponse, ApiError> {
    let mission = load_mission(state, mission_id).await?;
    ensure_access(&mission, user, device_id)?;

    let updated = match mission.user_id {
        Some(owner) => db::missions::mark_completed(&state.pool, mission_id, owner).await?,
        None => {
            db::missions::mark_completed_anonymous_device(
                &state.pool,
                mission_id,
                mission.device_id,
            )
            .await?
        }
    };

    let mission = updated.ok_or(ApiError::NotFound)?;
    Ok(CompleteMissionResponse {
        id: mission.id,
        status: mission.status,
        completed_at: mission.completed_at,
    })
}

/// Authorizes access to a mission.
///
/// Owned missions require the matching authenticated user. Anonymous demo
/// missions are addressable by the device that issued them and carry no
/// economic authority.
fn ensure_access(
    mission: &MissionInstance,
    user: Option<&AuthenticatedUser>,
    device_id: Option<Uuid>,
) -> Result<(), ApiError> {
    match mission.user_id {
        Some(owner) => match user {
            Some(user) if user.id == owner => Ok(()),
            Some(_) => Err(ApiError::Forbidden),
            None => Err(ApiError::Unauthorized),
        },
        None => {
            if !is_demo_certification(&mission.certification_id) {
                // Legacy anonymous non-demo missions are not addressable.
                return Err(ApiError::NotFound);
            }
            if device_id == Some(mission.device_id) {
                Ok(())
            } else {
                Err(ApiError::Forbidden)
            }
        }
    }
}

async fn apply_event(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    device_id: Option<Uuid>,
    mission: &MissionInstance,
    event: SyncEventRequest,
) -> Result<i64, SyncRejection> {
    let owned_by_user = match mission.user_id {
        Some(owner) => match user {
            Some(user) if user.id == owner => true,
            _ => return Err(SyncRejection::Rejected("forbidden".to_owned())),
        },
        None => {
            if !is_demo_certification(&mission.certification_id) {
                return Err(SyncRejection::Rejected("not_found".to_owned()));
            }
            if device_id != Some(mission.device_id) {
                return Err(SyncRejection::Rejected("forbidden".to_owned()));
            }
            false
        }
    };

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
    if !(0..=20).contains(&event.hint_count) {
        return Err(SyncRejection::Rejected("bad_request".to_owned()));
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

    let submitted = to_submitted(event.answer)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;
    let scored = score(question, &submitted)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;

    // Domain and task come from the actual question, not the mission: mixed
    // missions have no single task, and analytics must stay per-question.
    // `difficulty_prior` is copied from canonical server content, never from the
    // client, and the attempt number is derived by the database below.
    let learning_event = LearningEvent {
        event_id: event.event_id,
        user_id: mission.user_id,
        device_id: device_id.unwrap_or(mission.device_id),
        mission_instance_id: mission.id,
        certification_id: mission.certification_id.clone(),
        certification_version: mission.certification_version.clone(),
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
        question_id: event.question_id,
        content_version: question.content_version.clone(),
        difficulty_prior: question.difficulty_prior,
        concepts: concept_weights(question),
        assessment_mode: question.assessment_mode,
        interaction_type: question.interaction_type,
        score: scored.score,
        attempt_number: 1,
        hint_count: event.hint_count,
        response_ms: event.response_ms.clamp(0, MAX_RESPONSE_MS),
        structured_error_codes: scored.error_codes,
        occurred_at: event.occurred_at,
    };

    // The database assigns the next attempt number, settles Bits, and advances
    // derived concept state in one idempotent transaction.
    let attempt = db::learning_events::accept_answer(&state.pool, &learning_event)
        .await
        .map_err(|error| SyncRejection::Fatal(error.into()))?;

    Ok(match attempt {
        Some(attempt_number) if owned_by_user => {
            reward_bits(attempt_number, scored.score, question.difficulty_prior)
        }
        _ => 0,
    })
}

async fn load_mission(state: &AppState, mission_id: Uuid) -> Result<MissionInstance, ApiError> {
    db::missions::find_by_id(&state.pool, mission_id)
        .await?
        .ok_or(ApiError::NotFound)
}

fn resolve_question<'a>(
    state: &'a AppState,
    mission: &MissionInstance,
    user: Option<&AuthenticatedUser>,
    device_id: Option<Uuid>,
    question_id: &str,
    content_version: &str,
) -> Result<&'a adaptive_learn_content::Question, ApiError> {
    ensure_access(mission, user, device_id)?;
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
    let AnswerPayload {
        placements,
        ordered_ids,
        edges,
        reconstruction,
        evidence_ids,
        faulty_ids,
        slot_values,
        choice_path,
        assignments,
        positions,
        token_values,
        typed_answers,
    } = payload;

    let shapes = usize::from(placements.is_some())
        + usize::from(ordered_ids.is_some())
        + usize::from(edges.is_some())
        + usize::from(reconstruction.is_some())
        + usize::from(evidence_ids.is_some())
        + usize::from(faulty_ids.is_some())
        + usize::from(slot_values.is_some())
        + usize::from(choice_path.is_some())
        + usize::from(assignments.is_some())
        + usize::from(positions.is_some())
        + usize::from(token_values.is_some())
        + usize::from(typed_answers.is_some());

    if shapes != 1 {
        return Err(ApiError::BadRequest(
            "answer must contain exactly one answer shape".to_owned(),
        ));
    }

    if let Some(placements) = placements {
        return Ok(SubmittedAnswer::Classification(placements));
    }
    if let Some(ordered_ids) = ordered_ids {
        return Ok(SubmittedAnswer::Ordering(ordered_ids));
    }
    if let Some(edges) = edges {
        return Ok(SubmittedAnswer::NodeConnection(parse_edges(edges)?));
    }
    if let Some(reconstruction) = reconstruction {
        return Ok(SubmittedAnswer::Reconstruction {
            placements: reconstruction.placements,
            edges: parse_edges(reconstruction.edges)?,
        });
    }
    if let Some(evidence_ids) = evidence_ids {
        return Ok(SubmittedAnswer::EvidenceSelection(evidence_ids));
    }
    if let Some(faulty_ids) = faulty_ids {
        return Ok(SubmittedAnswer::SpotTheFault(faulty_ids));
    }
    if let Some(slot_values) = slot_values {
        return Ok(SubmittedAnswer::FillSlots(slot_values));
    }
    if let Some(choice_path) = choice_path {
        return Ok(SubmittedAnswer::Branching(choice_path));
    }
    if let Some(assignments) = assignments {
        return Ok(SubmittedAnswer::ConfigurationBuilder(assignments));
    }
    if let Some(positions) = positions {
        return Ok(SubmittedAnswer::TwoDimensionalPlacement(positions));
    }
    if let Some(token_values) = token_values {
        return Ok(SubmittedAnswer::CommandAssembly(token_values));
    }
    if let Some(typed_answers) = typed_answers {
        return Ok(SubmittedAnswer::TypedFillBlank(typed_answers));
    }

    Err(ApiError::BadRequest(
        "answer must contain exactly one answer shape".to_owned(),
    ))
}

fn parse_edges(edges: Vec<Vec<String>>) -> Result<Vec<(String, String)>, ApiError> {
    let mut pairs = Vec::with_capacity(edges.len());
    for edge in edges {
        if edge.len() != 2 {
            return Err(ApiError::BadRequest(
                "each edge must have exactly two endpoints".to_owned(),
            ));
        }
        pairs.push((edge[0].clone(), edge[1].clone()));
    }
    Ok(pairs)
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
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
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

    #[tokio::test]
    async fn recommendation_logging_failure_is_swallowed() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let concept_ids = vec!["c1".to_owned()];
        let entry = db::recommendations::RecommendationLogEntry {
            user_id: Uuid::new_v4(),
            track_id: "track",
            track_version: "track-v1",
            action: "learn_node",
            reason: "cold_start",
            domain_id: Some("d1"),
            node_id: Some("n1"),
            question_id: None,
            concept_ids: &concept_ids,
        };

        // The database is unreachable, but auxiliary logging must never panic or
        // propagate a failure into the recommendation request.
        log_recommendation(&pool, &entry).await;
    }

    #[test]
    fn answer_payload_must_have_exactly_one_shape() {
        let empty = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        });
        assert!(empty.is_err());

        let two_shapes = to_submitted(AnswerPayload {
            placements: Some(BTreeMap::new()),
            ordered_ids: Some(vec!["a".to_owned()]),
            edges: None,
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        });
        assert!(two_shapes.is_err());
    }

    #[test]
    fn edges_must_have_two_endpoints() {
        let bad = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: Some(vec![vec!["only-one".to_owned()]]),
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        });
        assert!(bad.is_err());

        let good = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: Some(vec![vec!["a".to_owned(), "b".to_owned()]]),
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        });
        assert_eq!(
            good.expect("valid edge"),
            SubmittedAnswer::NodeConnection(vec![("a".to_owned(), "b".to_owned())])
        );
    }

    #[test]
    fn reconstruction_answer_maps_to_submitted() {
        let submitted = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: Some(crate::dto::ReconstructionAnswerPayload {
                placements: std::collections::BTreeMap::from([
                    ("slot_1".to_owned(), "a".to_owned()),
                    ("slot_2".to_owned(), "b".to_owned()),
                ]),
                edges: vec![vec!["a".to_owned(), "b".to_owned()]],
            }),
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        })
        .expect("valid reconstruction");

        assert_eq!(
            submitted,
            SubmittedAnswer::Reconstruction {
                placements: std::collections::BTreeMap::from([
                    ("slot_1".to_owned(), "a".to_owned()),
                    ("slot_2".to_owned(), "b".to_owned()),
                ]),
                edges: vec![("a".to_owned(), "b".to_owned())],
            }
        );
    }

    #[test]
    fn selection_and_slot_answers_map_to_submitted() {
        let evidence = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: None,
            evidence_ids: Some(vec!["cloudtrail".to_owned()]),
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        })
        .expect("valid evidence");
        assert_eq!(
            evidence,
            SubmittedAnswer::EvidenceSelection(vec!["cloudtrail".to_owned()])
        );

        let faults = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: Some(vec!["route".to_owned()]),
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        })
        .expect("valid fault selection");
        assert_eq!(
            faults,
            SubmittedAnswer::SpotTheFault(vec!["route".to_owned()])
        );

        let mut values = BTreeMap::new();
        values.insert("destination".to_owned(), "nat".to_owned());
        let slots = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: Some(values.clone()),
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: None,
        })
        .expect("valid slots");
        assert_eq!(slots, SubmittedAnswer::FillSlots(values));

        let typed = to_submitted(AnswerPayload {
            placements: None,
            ordered_ids: None,
            edges: None,
            reconstruction: None,
            evidence_ids: None,
            faulty_ids: None,
            slot_values: None,
            choice_path: None,
            assignments: None,
            positions: None,
            token_values: None,
            typed_answers: Some(std::collections::BTreeMap::from([(
                "policy_result".to_owned(),
                "Deny".to_owned(),
            )])),
        })
        .expect("valid typed answers");
        assert_eq!(
            typed,
            SubmittedAnswer::TypedFillBlank(std::collections::BTreeMap::from([(
                "policy_result".to_owned(),
                "Deny".to_owned(),
            )]))
        );
    }

    #[test]
    fn attempt_metadata_is_bounded() {
        assert!(validate_attempt_metadata(1, 0).is_ok());
        assert!(validate_attempt_metadata(0, 0).is_err());
        assert!(validate_attempt_metadata(1, -1).is_err());
    }
}
