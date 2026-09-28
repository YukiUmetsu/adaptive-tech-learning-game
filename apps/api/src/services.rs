//! Application services for the Phase 1 learning API.
//!
//! Handlers stay thin; this module owns mission issuance, scoring, sync, and
//! completion. Scores are always recomputed from canonical content.
//!
//! Ownership is user-based: services receive the authenticated identity and
//! check `mission.user_id`, never the client-supplied `device_id`. A device may
//! still be recorded as context.

use std::collections::{BTreeMap, HashMap, HashSet};

use adaptive_learn_content::{
    DomainDiscoveryInput, PracticeTest, PracticeTestItem, Question, SubmittedAnswer,
    derive_domain_discovery, merge_domain_discovery, score,
};
use adaptive_learn_db as db;
use adaptive_learn_domain::concept_state::SUCCESS_THRESHOLD;
use adaptive_learn_domain::{
    AdversaryUnlockInput, CAMPAIGN_ORDER, CONFRONTATION_TEMPLATE_ID, COSMETICS, ConceptWeight,
    DAILY_MISSION_BONUS_BITS, DEFAULT_HEALTH_RATIO_THRESHOLD, GeneratedOperation, LearningEvent,
    MAX_OPERATION_OFFERS, MODEL_VERSION, MissionInstance, MissionStatus,
    OPERATION_RATE_MAX_SETTLED, OPERATION_RATE_WINDOW_MINUTES, OperationGenerationInput,
    OperationHeroSnapshot, OperationOutcome, OperationProgressionSnapshot, OperationTowerSnapshot,
    PredictionSample, QuizMode, RecentOperationIdentity, SECTION_QUIZ_BONUS_BITS,
    StoryProgressInput, THREAT_LEVEL_MAX, THREAT_LEVEL_MIN, TOWER_UPGRADES,
    ThreatRecommendationInput, active_chapter, adversary_progress_award,
    adversary_rank_from_progress, available_adversaries, campaign_complete,
    campaign_mission_unlocked, career_level_from_xp, career_rank, confrontation_available,
    cosmetic, estimated_operation_minutes, evaluate, evaluate_story_nodes, fixed_mission_reward,
    generate_operation, hero_level_from_xp, is_campaign_mission, is_known_hero, is_legal_talent,
    operation_attack, operation_defense, operation_result_is_plausible, operation_reward,
    operation_template, predict_question, recommend_threat_level, retrievability, reward_bits,
    scale_xp, select_operation_offer_templates, select_operation_template, selectable_templates,
    summarize_streak, tower_level, tower_upgrade, tower_upgrade_cost,
    training_center_hero_xp_multiplier, unlocked_threat_level, validate_generated_operation,
    xp_for_career_level, xp_for_hero_level,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::dto::{
    AnswerPayload, AnswerRequest, AuxiliaryEventRequest, CalibrationBucketDto, CatalogResponse,
    CertificationDto, CertificationVersionDto, ChallengeStageKind, ChallengeStageView,
    ChallengeStartRequest, ChallengeSummaryDto, ChallengeView, CompleteMissionResponse, ConceptDto,
    CyberAdversaryProgressDto, CyberCampaignCompleteRequest, CyberCampaignCompleteResponse,
    CyberCampaignResultDto, CyberCareerDto, CyberCareerSummaryDto, CyberCosmeticDto,
    CyberCosmeticEquipRequest, CyberCosmeticPurchaseRequest, CyberCosmeticPurchaseResponse,
    CyberCosmeticsStateDto, CyberDefenseProfileResponse, CyberHeroProgressDto,
    CyberHeroTalentRequest, CyberLegacyImportRequest, CyberLegacyImportResponse,
    CyberOperationCompleteRequest, CyberOperationCompleteResponse, CyberOperationLoadoutRequest,
    CyberOperationOfferDto, CyberOperationOffersRequest, CyberOperationOffersResponse,
    CyberOperationResultDto, CyberOperationRunDto, CyberOperationStartRequest, CyberRewardDto,
    CyberStoryProgressDto, CyberTelemetryRequest, CyberTelemetryResponse, CyberTowerUpgradeDto,
    CyberTowerUpgradePurchaseRequest, CyberTowerUpgradePurchaseResponse, DailyItemCompleteRequest,
    DailyItemCompleteResponse, DailyMissionItemDto, DailyMissionItemKind, DailyMissionItemStatus,
    DailyMissionPlanType, DailyMissionRequest, DailyMissionResponse, DailyMissionStatus,
    DiscoveryResponse, DiscoveryState, DiscoveryUpdateRequest, DomainDto, DomainProgressDto,
    EvaluationSliceDto, FamilyConfusionDto, FamilyInsightDto, FamilyInsightsResponse,
    FeedbackResponse, IssueMissionRequest, LearningDomainResponse, MissionResponse,
    MissionReviewResponse, ModelEvaluationResponse, NodeProgressDto, PracticeTestDomainResult,
    PracticeTestItemResult, PracticeTestItemView, PracticeTestListResponse, PracticeTestResponse,
    PracticeTestResultResponse, PracticeTestSubmissionRequest, PracticeTestSummaryDto,
    QuestionErrorCode, QuestionView, RecommendationEventRequest, RecommendationEventResponse,
    RecommendationResponse, ReviewedAttempt, ReviewedQuestion, SeenExampleDto, StreakDto,
    StructureComparisonDto, StudyQuestionView, StudySessionRequest, StudySessionResponse,
    SyncEventRequest, SyncEventResult, SyncRequest, SyncResponse, SyncSectionResult, TaskDto,
    TrackMapResponse, TrackProgressResponse, UpdateSettingsRequest, UserSettingsDto,
    WalletResponse,
};
use crate::error::ApiError;
use crate::pedagogy::RecentPedagogy;
use crate::planner::{
    self, ConceptStateView, PlannerDomain, PlannerInput, PlannerNode, PlannerQuestion,
};
use crate::remediation;
use crate::selection::{self, Candidate, ConceptEvidence, HistoryEntry, HistoryErrorCode};
use crate::signals;
use crate::state::AppState;
use crate::structure;

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

    Ok(learning_domain_response(domain))
}

/// Maps authored learning content into its learner-facing transport shape.
fn learning_domain_response(
    domain: &adaptive_learn_content::LearningDomain,
) -> LearningDomainResponse {
    LearningDomainResponse {
        schema_version: domain.schema_version.clone(),
        content_version: domain.content_version.clone(),
        certification_id: domain.certification_id.clone(),
        certification_version: domain.certification_version.clone(),
        exam_guide_revision: domain.exam_guide_revision.clone(),
        domain: domain.domain.clone(),
        learning_design: domain.learning_design.clone(),
        source_refs: domain.source_refs.clone(),
        glossary: domain.glossary.clone(),
        modules: domain.modules.clone(),
    }
}

/// Returns every learning domain for one track in a single response.
///
/// The Track Hub renders one track-wide Knowledge Map, so this avoids a request
/// per domain. It is a read-only aggregate over authored content and carries no
/// scored answers or learner state.
pub fn track_map(state: &AppState, track_id: &str) -> Result<TrackMapResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();
    let domains = state
        .content
        .learning_domains()
        .iter()
        .filter(|domain| domain.certification_version == track_version)
        .map(learning_domain_response)
        .collect();
    let challenges = state
        .content
        .challenges_for_certification(track_id)
        .into_iter()
        .map(challenge_summary)
        .collect();

    Ok(TrackMapResponse {
        track_id: track_id.to_owned(),
        track_version,
        content_version: bundle.version.content_version.clone(),
        domains,
        challenges,
    })
}

/// Maps an authored challenge into its compact hub summary.
fn challenge_summary(
    challenge: &adaptive_learn_content::ChallengeDefinition,
) -> ChallengeSummaryDto {
    ChallengeSummaryDto {
        id: challenge.id.clone(),
        title: challenge.title.clone(),
        description: challenge.description.clone(),
        estimated_minutes: challenge.estimated_minutes(),
        stage_count: challenge.stages.len(),
        prerequisite_node_ids: challenge.prerequisite_node_ids.clone(),
    }
}

/// Returns learner-family insights for one track (Phase 5).
///
/// This is post-exposure teaching content derived on read from accepted history
/// plus canonical authored guides. It never writes evidence, changes concept
/// state, settles Bits, or exposes an answer key. A track with no authored
/// guides, or a learner with no relevant exposure, returns an empty list.
///
/// When `mission_id` is supplied, the response is scoped to the families of
/// that **completed, owned** mission, so a completion summary shows only
/// structures the finished work actually involved. An in-progress or foreign
/// mission yields an empty list rather than leaking mid-mission family metadata.
pub async fn family_insights(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    mission_id: Option<Uuid>,
) -> Result<FamilyInsightsResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();

    let guides: Vec<&adaptive_learn_content::FamilyGuide> = state
        .content
        .family_guides()
        .iter()
        .filter(|guide| {
            guide.certification_id == track_id && guide.certification_version == track_version
        })
        .collect();

    if guides.is_empty() {
        return Ok(FamilyInsightsResponse {
            track_id: track_id.to_owned(),
            track_version,
            has_guides: false,
            insights: Vec::new(),
        });
    }

    // Optional mission scope: only families represented by a completed, owned
    // mission are returned. Anything else is treated as an empty scope, never a
    // fallback to the whole track.
    let mission_families: Option<HashSet<String>> = match mission_id {
        None => None,
        Some(id) => {
            let mission = load_mission(state, id).await?;
            if mission.user_id != Some(user.id) || mission.certification_id != track_id {
                return Err(ApiError::Forbidden);
            }
            if mission.status != MissionStatus::Completed {
                return Ok(FamilyInsightsResponse {
                    track_id: track_id.to_owned(),
                    track_version,
                    has_guides: true,
                    insights: Vec::new(),
                });
            }
            Some(
                mission
                    .question_ids
                    .iter()
                    .filter_map(|question_id| state.content.question(&track_version, question_id))
                    .filter_map(|question| {
                        question
                            .pedagogy
                            .as_ref()
                            .and_then(|pedagogy| pedagogy.family_id.as_deref())
                    })
                    .map(str::trim)
                    .filter(|family_id| !family_id.is_empty())
                    .map(str::to_owned)
                    .collect(),
            )
        }
    };

    let rows = db::learning_events::distinct_seen_questions(&state.pool, user.id, track_id).await?;
    let seen = seen_records(state, &track_version, &rows, mission_families.as_ref());

    let insights = structure::build_family_insights(&guides, &seen)
        .into_iter()
        .map(family_insight_dto)
        .collect();

    Ok(FamilyInsightsResponse {
        track_id: track_id.to_owned(),
        track_version,
        has_guides: true,
        insights,
    })
}

/// Joins all-time seen question ids to authored pedagogy and learner-safe titles.
///
/// The learning event never stores pedagogy metadata; it is reconstructed from
/// canonical content here, so accepted events stay the single authoritative
/// history and no duplicate "family history" table is needed. A question that no
/// longer exists in the current content version is skipped safely, and when a
/// mission scope is supplied only its families are kept.
pub(crate) fn seen_records(
    state: &AppState,
    track_version: &str,
    rows: &[db::learning_events::SeenQuestion],
    mission_families: Option<&HashSet<String>>,
) -> Vec<structure::SeenRecord> {
    let mut seen = Vec::new();
    for row in rows {
        let Some(question) = state.content.question(track_version, &row.question_id) else {
            continue;
        };
        let Some(pedagogy) = &question.pedagogy else {
            continue;
        };
        let Some(family_id) = pedagogy
            .family_id
            .as_deref()
            .map(str::trim)
            .filter(|family_id| !family_id.is_empty())
        else {
            continue;
        };
        if mission_families.is_some_and(|allowed| !allowed.contains(family_id)) {
            continue;
        }
        seen.push(structure::SeenRecord {
            family_id: family_id.to_owned(),
            question_id: row.question_id.clone(),
            transfer_group_id: pedagogy.transfer_group_id.clone(),
            surface_context: pedagogy.surface_context.clone(),
            title: question.prompt.clone(),
            seen_at: row.last_occurred_at,
        });
    }
    seen
}

/// Maps the pure insight into its learner-facing transport shape.
fn family_insight_dto(insight: structure::FamilyInsight) -> FamilyInsightDto {
    FamilyInsightDto {
        family_id: insight.family_id,
        title: insight.title,
        summary: insight.summary,
        recognition_signals: insight.recognition_signals,
        core_rules: insight.core_rules,
        structural_steps: insight.structural_steps,
        example_contexts: insight.example_contexts,
        common_confusions: insight
            .common_confusions
            .into_iter()
            .map(|confusion| FamilyConfusionDto {
                other_family_id: confusion.other_family_id,
                other_family_title: confusion.other_family_title,
                distinction: confusion.distinction,
            })
            .collect(),
        source_refs: insight.source_refs,
        seen_context_count: insight.seen_context_count,
        seen_example_count: insight.seen_example_count,
        comparison: insight.comparison.map(|comparison| StructureComparisonDto {
            family_id: comparison.family_id,
            title: comparison.title,
            summary: comparison.summary,
            recognition_signals: comparison.recognition_signals,
            core_rules: comparison.core_rules,
            structural_steps: comparison.structural_steps,
            examples: comparison
                .examples
                .into_iter()
                .map(|example| SeenExampleDto {
                    title: example.title,
                    context_label: example.context_label,
                    seen_at: example.seen_at,
                })
                .collect(),
        }),
    }
}

/// Shared planner inputs assembled from content, learner state, and discovery.
struct PlannerContext {
    track_version: String,
    input: PlannerInput,
    history: Vec<HistoryEntry>,
}

/// Builds the shared planner input for a learning track.
async fn planner_context(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    discovery: &[DomainDiscoveryInput],
) -> Result<PlannerContext, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();

    let states = db::concept_state::list_for_user(&state.pool, user.id, &track_version).await?;
    let history = history_entries(
        state,
        &track_version,
        db::learning_events::recent_for_user(&state.pool, user.id, track_id, HISTORY_LIMIT).await?,
    );

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
            task_id: question.task_id.clone(),
            interaction_type: question.interaction_type,
            assessment_mode: question.assessment_mode,
            difficulty_prior: question.difficulty_prior,
            concepts: concept_weights(question),
            pedagogy: question.pedagogy.clone(),
        })
        .collect();

    let discovery_state = {
        let merged = merged_track_discovery(state, user.id, &track_version, discovery).await;
        derive_track_discovery(state, &track_version, &merged)
    };

    let recent_pedagogy = RecentPedagogy::build(&history);
    // Structured-error resolution is separate from ranking: resolve at most one
    // active remediation target from the same recent accepted history.
    let remediation = remediation::resolve_active_remediation(&history);
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
        explored_node_ids: discovery_state.explored_node_ids,
        unlocked_node_ids: discovery_state.unlocked_node_ids,
        completed_module_ids: discovery_state.completed_module_ids,
        recent_question_ids: history
            .iter()
            .map(|entry| entry.question_id.clone())
            .collect(),
        recent_pedagogy,
        remediation,
    };

    Ok(PlannerContext {
        track_version,
        input,
        history,
    })
}

/// Builds a best-effort next-action recommendation for a learning track.
///
/// The planner is pure and track-agnostic; this function only assembles its
/// input from content, derived concept state, accepted history, and optional
/// discovery progress. Discovery is derived with the same rules as the frontend
/// Knowledge Map so the planner never targets a map-locked node. Auxiliary
/// logging is best-effort and never fails the recommendation or learning flow.
pub async fn recommendation(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    discovery: &[DomainDiscoveryInput],
) -> Result<RecommendationResponse, ApiError> {
    let context = planner_context(state, user, track_id, discovery).await?;
    let recommendation = planner::recommend(&context.input);

    // Generate a stable id for lifecycle telemetry even if the best-effort
    // generation log write fails below.
    let recommendation_id = recommendation.as_ref().map(|_| Uuid::new_v4());

    if let (Some(choice), Some(id)) = (&recommendation, recommendation_id) {
        let entry = db::recommendations::RecommendationLogEntry {
            recommendation_id: id,
            user_id: user.id,
            track_id: &choice.track_id,
            track_version: &context.track_version,
            action: choice.action.as_str(),
            reason: choice.reason.as_str(),
            domain_id: Some(choice.domain_id.as_str()),
            node_id: choice.node_id.as_deref(),
            question_id: choice.question_id.as_deref(),
            concept_ids: &choice.concept_ids,
        };
        log_recommendation(&state.pool, &entry).await;
    }

    Ok(RecommendationResponse {
        recommendation_id,
        recommendation,
    })
}

/// Builds a deterministic study session for a learning track.
///
/// The planner reuses the next-action concept model. Session logging is
/// best-effort: a persistence failure never prevents the session from being
/// returned. A successful request is not proof the learner saw the session.
pub async fn study_session(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    request: StudySessionRequest,
) -> Result<StudySessionResponse, ApiError> {
    let context = planner_context(state, user, track_id, &request.discovery).await?;

    let available_minutes = normalize_available_minutes(request.available_minutes);
    let session = planner::session::plan_session(&planner::session::SessionPlannerInput {
        planner: context.input,
        available_minutes,
        preference: request.preference,
        history: context.history,
    });

    let Some(session) = session else {
        return Ok(StudySessionResponse {
            session_id: Uuid::new_v4(),
            track_id: track_id.to_owned(),
            estimated_minutes: 0,
            activities: Vec::new(),
        });
    };

    // The id is generated regardless of whether the auxiliary write lands.
    let session_id = Uuid::new_v4();
    log_study_session(
        &state.pool,
        &db::sessions::StudySessionLogEntry {
            session_id,
            user_id: user.id,
            track_id,
            track_version: &context.track_version,
            available_minutes,
            preference: request.preference.as_str(),
            estimated_minutes: session.estimated_minutes,
            activity_count: session.activities.len() as i32,
        },
    )
    .await;

    Ok(StudySessionResponse {
        session_id,
        track_id: session.track_id,
        estimated_minutes: session.estimated_minutes,
        activities: session.activities,
    })
}

/// Clamps a requested session length into a sane range.
fn normalize_available_minutes(requested: u32) -> u32 {
    if requested == 0 {
        20
    } else {
        requested.clamp(5, 180)
    }
}

/// Logs a study session without ever letting a persistence problem escape.
async fn log_study_session(pool: &db::PgPool, entry: &db::sessions::StudySessionLogEntry<'_>) {
    if let Err(error) = db::sessions::log(pool, entry).await {
        tracing::debug!(error = %error, "could not log study session");
    }
}

/// Maximum resolved samples loaded for one internal evaluation summary.
const EVALUATION_SAMPLE_LIMIT: i64 = 20_000;
/// Evidence mass below which a concept is too lightly practiced to review.
const DELAYED_DUE_EVIDENCE_MASS: f64 = 2.0;
/// Retrievability below which a practiced concept counts as due for review.
const DELAYED_DUE_RETRIEVABILITY: f64 = 0.5;
/// Questions in one delayed-retrieval activity.
const DELAYED_RETRIEVAL_MAX_QUESTIONS: usize = 3;
/// Minimum spacing before a concept can be revisited as delayed retrieval.
const DELAYED_MIN_SPACING_SECONDS: i64 = 12 * 60 * 60;

/// Resolves the local calendar day for a Daily Mission.
fn local_day(now: DateTime<Utc>, timezone: &str) -> NaiveDate {
    timezone
        .parse::<chrono_tz::Tz>()
        .map(|tz| now.with_timezone(&tz).date_naive())
        .unwrap_or_else(|_| now.date_naive())
}

/// Maps a quiz mode to the analytics practice source.
fn mission_practice_source(mode: QuizMode, has_recommendation: bool) -> &'static str {
    if has_recommendation {
        return "recommended_practice";
    }
    match mode {
        QuizMode::QuickAdaptive => "quick_quiz",
        QuizMode::DomainQuiz => "domain_quiz",
        QuizMode::FullPractice => "full_practice",
        QuizMode::TaskPractice => "task_practice",
        QuizMode::RecommendedPractice => "recommended_practice",
        QuizMode::SectionQuiz => "section_quiz",
        QuizMode::Challenge => "challenge",
    }
}

/// Captures pre-answer prediction snapshots for a just-issued mission.
///
/// Measurement only: it reads concept state that exists before any answer and
/// never touches the answer outcome. It is called after the mission is
/// persisted and any failure is logged and ignored.
async fn log_predictions_best_effort(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    mission: &MissionInstance,
    practice_source: &str,
    delayed_retrieval: bool,
) {
    let Some(user) = user else {
        return;
    };
    let now = Utc::now();
    let states = match db::concept_state::list_for_user(
        &state.pool,
        user.id,
        &mission.certification_version,
    )
    .await
    {
        Ok(states) => states,
        Err(error) => {
            tracing::debug!(error = %error, "could not load concept state for prediction");
            return;
        }
    };

    struct Pending {
        concepts: Vec<ConceptWeight>,
        concept_detail: serde_json::Value,
        predicted_score: f64,
        seconds_since_previous_practice: Option<i32>,
    }

    let mut questions = Vec::new();
    let mut pending = Vec::new();
    for question_id in &mission.question_ids {
        let Some(question) = state
            .content
            .question(&mission.certification_version, question_id)
        else {
            continue;
        };
        let concepts = concept_weights(question);
        let prediction = predict_question(&concepts, question.assessment_mode, &states, now);
        let detail = serde_json::to_value(&prediction.concepts)
            .unwrap_or_else(|_| serde_json::Value::Array(Vec::new()));
        questions.push(question);
        pending.push(Pending {
            concepts,
            concept_detail: detail,
            predicted_score: prediction.predicted_score,
            seconds_since_previous_practice: prediction
                .seconds_since_previous_practice
                .map(|seconds| seconds.clamp(0, i32::MAX as i64) as i32),
        });
    }

    let snapshots: Vec<db::predictions::NewPredictionSnapshot<'_>> = pending
        .iter()
        .zip(questions.iter())
        .map(
            |(pending, question)| db::predictions::NewPredictionSnapshot {
                user_id: user.id,
                mission_instance_id: mission.id,
                question_id: &question.id,
                track_id: &mission.certification_id,
                track_version: &mission.certification_version,
                content_version: &question.content_version,
                domain_id: &question.domain_id,
                assessment_mode: question.assessment_mode.as_str(),
                interaction_type: question.interaction_type.as_str(),
                difficulty_prior: question.difficulty_prior,
                concepts: &pending.concepts,
                concept_detail: pending.concept_detail.clone(),
                predicted_score: pending.predicted_score,
                model_version: MODEL_VERSION,
                practice_source,
                delayed_retrieval,
                seconds_since_previous_practice: pending.seconds_since_previous_practice,
            },
        )
        .collect();

    if snapshots.is_empty() {
        return;
    }
    if let Err(error) = db::predictions::insert_snapshots(&state.pool, &snapshots).await {
        tracing::debug!(error = %error, "could not persist prediction snapshots");
    }
}

/// Links an accepted event to its prediction, ignoring any failure.
async fn record_prediction_outcome_best_effort(
    state: &AppState,
    mission: &MissionInstance,
    question_id: &str,
    event_id: Uuid,
    attempt_number: i32,
    observed_score: f64,
    observed_at: DateTime<Utc>,
) {
    let entry = db::predictions::OutcomeEntry {
        mission_instance_id: mission.id,
        question_id: question_id.to_owned(),
        model_version: MODEL_VERSION.to_owned(),
        event_id,
        attempt_number,
        observed_score,
        observed_at,
    };
    if let Err(error) = db::predictions::record_outcome(&state.pool, &entry).await {
        tracing::debug!(error = %error, "could not record prediction outcome");
    }
}

/// Builds an internal calibration summary for one model version.
pub async fn model_evaluation(
    state: &AppState,
    model_version: &str,
    bucket_count: usize,
) -> Result<ModelEvaluationResponse, ApiError> {
    let samples =
        db::predictions::list_resolved(&state.pool, model_version, EVALUATION_SAMPLE_LIMIT).await?;

    let pairs: Vec<PredictionSample> = samples
        .iter()
        .map(|sample| PredictionSample::new(sample.predicted_score, sample.observed_score))
        .collect();
    let summary = evaluate(&pairs, bucket_count);

    let mut slices = Vec::new();
    push_slices(&mut slices, "practice_source", &samples, |sample| {
        sample.practice_source.clone()
    });
    push_slices(&mut slices, "assessment_mode", &samples, |sample| {
        sample.assessment_mode.clone()
    });
    push_slices(&mut slices, "track", &samples, |sample| {
        sample.track_id.clone()
    });
    push_slices(&mut slices, "domain", &samples, |sample| {
        format!("{}::{}", sample.track_id, sample.domain_id)
    });
    push_slices(&mut slices, "difficulty", &samples, |sample| {
        difficulty_band(sample.difficulty_prior)
    });
    push_slices(&mut slices, "spacing", &samples, |sample| {
        spacing_band(sample.seconds_since_previous_practice)
    });
    push_slices(&mut slices, "delayed_retrieval", &samples, |sample| {
        if sample.delayed_retrieval {
            "delayed".to_owned()
        } else {
            "immediate".to_owned()
        }
    });

    Ok(ModelEvaluationResponse {
        model_version: model_version.to_owned(),
        samples: summary.samples,
        brier_score: summary.brier_score,
        log_loss: summary.log_loss,
        mean_prediction: summary.mean_prediction,
        mean_observed: summary.mean_observed,
        calibration: summary
            .calibration
            .iter()
            .map(|bucket| CalibrationBucketDto {
                bucket: bucket.label(),
                count: bucket.count,
                mean_prediction: bucket.mean_prediction,
                mean_observed: bucket.mean_observed,
            })
            .collect(),
        slices,
    })
}

/// Groups samples by a key function and appends one slice per group.
fn push_slices(
    out: &mut Vec<EvaluationSliceDto>,
    dimension: &str,
    samples: &[db::predictions::ResolvedSample],
    key: impl Fn(&db::predictions::ResolvedSample) -> String,
) {
    let mut groups: std::collections::BTreeMap<String, Vec<PredictionSample>> =
        std::collections::BTreeMap::new();
    for sample in samples {
        groups
            .entry(key(sample))
            .or_default()
            .push(PredictionSample::new(
                sample.predicted_score,
                sample.observed_score,
            ));
    }
    for (key, group) in groups {
        let summary = evaluate(&group, 0);
        out.push(EvaluationSliceDto {
            dimension: dimension.to_owned(),
            key,
            samples: summary.samples,
            brier_score: summary.brier_score,
            log_loss: summary.log_loss,
            mean_prediction: summary.mean_prediction,
            mean_observed: summary.mean_observed,
        });
    }
}

/// Buckets a difficulty prior into equal 0.2 bands for slicing.
fn difficulty_band(difficulty: f64) -> String {
    let lower = (difficulty.clamp(0.0, 1.0) * 5.0).floor() / 5.0;
    let upper = (lower + 0.2).min(1.0);
    format!("{lower:.1}-{upper:.1}")
}

/// Buckets time since previous practice for slicing.
fn spacing_band(seconds: Option<i32>) -> String {
    const DAY: i64 = 24 * 60 * 60;
    match seconds.map(i64::from) {
        None => "unknown".to_owned(),
        Some(seconds) if seconds < DAY => "under_1d".to_owned(),
        Some(seconds) if seconds < 3 * DAY => "1_3d".to_owned(),
        Some(seconds) if seconds < 7 * DAY => "3_7d".to_owned(),
        Some(seconds) if seconds < 30 * DAY => "7_30d".to_owned(),
        Some(_) => "30d_plus".to_owned(),
    }
}

/// Builds a delayed-retrieval practice item when a practiced concept is due.
///
/// Simple deterministic spacing: a concept is due when it has enough evidence
/// and its `heuristic-v1` retrievability has decayed below the due threshold.
/// At most one item is added per mission, and never when the session is full.
fn delayed_retrieval_item(
    context: &PlannerContext,
    existing: &[PlannedDailyItem],
    now: DateTime<Utc>,
) -> Option<PlannedDailyItem> {
    let mut due: Vec<(&ConceptStateView, f64)> = context
        .input
        .states
        .iter()
        .filter(|state| state.evidence_mass >= DELAYED_DUE_EVIDENCE_MASS)
        .filter_map(|state| {
            let last = state.last_practiced_at?;
            let elapsed = (now - last).num_seconds();
            if elapsed < DELAYED_MIN_SPACING_SECONDS {
                return None;
            }
            let retrieval = retrievability(state.evidence_mass, state.last_practiced_at, now);
            (retrieval < DELAYED_DUE_RETRIEVABILITY).then_some((state, retrieval))
        })
        .collect();
    due.sort_by(|a, b| {
        a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.concept_id.cmp(&b.0.concept_id))
            .then_with(|| {
                a.0.assessment_mode
                    .as_str()
                    .cmp(b.0.assessment_mode.as_str())
            })
    });
    let (due_state, _) = due.first()?;

    let candidates: Vec<Candidate> = context
        .input
        .questions
        .iter()
        .filter(|question| question.assessment_mode == due_state.assessment_mode)
        .filter(|question| {
            question
                .concepts
                .iter()
                .any(|concept| concept.concept_id == due_state.concept_id)
        })
        .map(candidate_from_planner_question)
        .collect();
    if candidates.is_empty() {
        return None;
    }

    let used_ids: HashSet<String> = existing
        .iter()
        .flat_map(|item| practice_question_ids(&item.practice_context))
        .collect();
    let anchor = candidates.iter().find(|candidate| {
        !used_ids.contains(&candidate.id)
            && !context.input.recent_question_ids.contains(&candidate.id)
    })?;

    let question_ids = selection::recommended_practice(
        anchor,
        &candidates,
        &context.history,
        DELAYED_RETRIEVAL_MAX_QUESTIONS,
    );
    if question_ids.is_empty() {
        return None;
    }

    Some(PlannedDailyItem {
        position: existing.len() as i32,
        kind: "practice",
        domain_id: anchor.domain_id.clone(),
        node_id: None,
        title: "Delayed retrieval".to_owned(),
        estimated_minutes: (question_ids.len() as i32) * 2,
        practice_context: serde_json::json!({
            "question_ids": question_ids,
            "delayed_retrieval": true,
        }),
    })
}

/// Maps a planner question into a selection candidate.
fn candidate_from_planner_question(question: &PlannerQuestion) -> Candidate {
    Candidate {
        id: question.id.clone(),
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: question.concepts.clone(),
        pedagogy: question.pedagogy.clone(),
    }
}

/// Requested Daily Mission length in minutes.
const DAILY_MISSION_MINUTES: u32 = 20;
/// Maximum items in one Daily Mission.
const DAILY_MISSION_MAX_ITEMS: usize = 5;

/// One Daily Mission item before it is persisted.
struct PlannedDailyItem {
    position: i32,
    kind: &'static str,
    domain_id: String,
    node_id: Option<String>,
    title: String,
    estimated_minutes: i32,
    practice_context: serde_json::Value,
}

/// Generated Daily Mission items plus whether adaptive planning was used.
struct GeneratedDailyItems {
    adaptive: bool,
    items: Vec<PlannedDailyItem>,
}

/// Returns today's immutable Daily Mission, generating it once if needed.
///
/// The plan never changes after creation: completing items, state changes,
/// refreshes, and repeated requests all return the same stored snapshot. If
/// adaptive generation fails, a standard non-adaptive plan is persisted instead
/// and kept for the rest of the day.
///
/// The one exception is stale content: if a later content revision removes a
/// knowledge node or question a pending item still needs, the plan is rebuilt
/// from current content (see `refresh_unexecutable_daily_mission`).
pub async fn daily_mission(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    request: DailyMissionRequest,
) -> Result<DailyMissionResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();
    let now = Utc::now();

    // Capture the learner's IANA timezone once. Later timezone changes cannot
    // move the day boundary or produce additional reward-bearing missions.
    if let Some(requested) = sanitize_timezone(request.timezone.as_deref()) {
        if let Err(error) =
            db::users::set_timezone_if_absent(&state.pool, user.id, &requested).await
        {
            tracing::debug!(error = %error, "could not persist learner timezone");
        }
    }
    let stored_timezone = match db::users::timezone(&state.pool, user.id).await {
        Ok(timezone) => timezone,
        Err(error) => {
            tracing::debug!(error = %error, "could not read learner timezone");
            None
        }
    };
    let effective_timezone = stored_timezone
        .clone()
        .or_else(|| sanitize_timezone(request.timezone.as_deref()))
        .unwrap_or_else(|| "UTC".to_owned());
    let day_key = local_day(now, &effective_timezone);

    if let Some(existing) =
        db::daily_missions::find_for_day(&state.pool, user.id, track_id, day_key).await?
    {
        let current = refresh_unexecutable_daily_mission(
            state,
            user,
            track_id,
            &track_version,
            existing,
            &request.discovery,
        )
        .await?;
        settle_completed_reward(state, &current).await;
        return Ok(daily_response(&bundle.version.domains, &current));
    }

    // Abuse guard: a new mission may only be created for a strictly later day
    // than the most recent one. A timezone shift that yields an earlier or equal
    // local day returns the existing mission instead.
    if let Some(latest) =
        db::daily_missions::find_latest_for_user_track(&state.pool, user.id, track_id).await?
    {
        if day_key <= latest.day_key {
            let current = refresh_unexecutable_daily_mission(
                state,
                user,
                track_id,
                &track_version,
                latest,
                &request.discovery,
            )
            .await?;
            settle_completed_reward(state, &current).await;
            return Ok(daily_response(&bundle.version.domains, &current));
        }
    }

    let generated =
        generate_daily_items(state, user, track_id, &track_version, &request.discovery).await;
    let plan_type = if generated.adaptive {
        DailyMissionPlanType::Adaptive
    } else {
        DailyMissionPlanType::Standard
    };
    let items: Vec<db::daily_missions::NewDailyMissionItem<'_>> = generated
        .items
        .iter()
        .map(|item| db::daily_missions::NewDailyMissionItem {
            position: item.position,
            kind: item.kind,
            domain_id: &item.domain_id,
            node_id: item.node_id.as_deref(),
            title: &item.title,
            estimated_minutes: item.estimated_minutes,
            practice_context: item.practice_context.clone(),
        })
        .collect();

    let new_mission = db::daily_missions::NewDailyMission {
        user_id: user.id,
        track_id,
        track_version: &track_version,
        day_key,
        timezone: Some(effective_timezone.as_str()),
        plan_type: plan_type.as_str(),
        reward_bits: DAILY_MISSION_BONUS_BITS as i32,
    };
    let stored = db::daily_missions::create(&state.pool, &new_mission, &items).await?;
    settle_completed_reward(state, &stored).await;
    let current = db::daily_missions::find_by_id(&state.pool, stored.id)
        .await?
        .unwrap_or(stored);
    Ok(daily_response(&bundle.version.domains, &current))
}

/// Whether every pending item of a stored Daily Mission can still be executed
/// against the current authored content.
///
/// A certification revision can remove a knowledge node or a question that a
/// stored plan references, so an item can no longer be completed. Completed
/// items are ignored: their work is already recorded against the concept state.
fn daily_plan_is_executable(
    state: &AppState,
    mission: &db::daily_missions::StoredDailyMission,
) -> bool {
    mission
        .items
        .iter()
        .filter(|item| item.status != "completed")
        .all(|item| match item.kind.as_str() {
            "learn_node" | "review_node" => item.node_id.as_deref().is_some_and(|node_id| {
                state
                    .content
                    .learning_domain(&mission.track_version, &item.domain_id)
                    .and_then(|domain| domain.node(node_id))
                    .is_some()
            }),
            "practice" => {
                let ids = practice_question_ids(&item.practice_context);
                !ids.is_empty()
                    && ids
                        .iter()
                        .all(|id| state.content.question(&mission.track_version, id).is_some())
            }
            "domain_practice" => !state
                .content
                .questions_for_domain(&mission.track_version, &item.domain_id)
                .is_empty(),
            _ => false,
        })
}

/// Rebuilds a stored Daily Mission when the authored content changed under it,
/// so a plan can never strand the learner with an item that cannot be executed.
///
/// The plan is immutable except for this recovery: only a mission that still
/// has a pending item the current content cannot execute is rebuilt, and only
/// before its completion reward has settled. The mission id and day are
/// preserved so a later completion reward stays idempotent. Recorded learning
/// evidence is untouched; only checklist progress resets, because it no longer
/// maps onto the new content.
async fn refresh_unexecutable_daily_mission(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    track_version: &str,
    mission: db::daily_missions::StoredDailyMission,
    discovery: &[DomainDiscoveryInput],
) -> Result<db::daily_missions::StoredDailyMission, ApiError> {
    if mission.is_completed()
        || mission.reward_settled_at.is_some()
        || daily_plan_is_executable(state, &mission)
    {
        return Ok(mission);
    }

    let generated = generate_daily_items(state, user, track_id, track_version, discovery).await;
    if generated.items.is_empty() {
        tracing::warn!(
            mission = %mission.id,
            "daily mission content changed, but no replacement plan could be generated"
        );
        return Ok(mission);
    }

    tracing::warn!(
        mission = %mission.id,
        "rebuilding a daily mission whose content changed"
    );
    let items: Vec<db::daily_missions::NewDailyMissionItem<'_>> = generated
        .items
        .iter()
        .map(|item| db::daily_missions::NewDailyMissionItem {
            position: item.position,
            kind: item.kind,
            domain_id: &item.domain_id,
            node_id: item.node_id.as_deref(),
            title: &item.title,
            estimated_minutes: item.estimated_minutes,
            practice_context: item.practice_context.clone(),
        })
        .collect();
    let plan_type = if generated.adaptive {
        DailyMissionPlanType::Adaptive
    } else {
        DailyMissionPlanType::Standard
    };

    match db::daily_missions::replace_items(&state.pool, mission.id, plan_type.as_str(), &items)
        .await?
    {
        Some(updated) => Ok(updated),
        None => Ok(mission),
    }
}

/// Generates items adaptively, falling back to authored track content.
async fn generate_daily_items(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    track_version: &str,
    discovery: &[DomainDiscoveryInput],
) -> GeneratedDailyItems {
    match planner_context(state, user, track_id, discovery).await {
        Ok(context) => {
            if let Some(session) =
                planner::session::plan_session(&planner::session::SessionPlannerInput {
                    planner: context.input.clone(),
                    available_minutes: DAILY_MISSION_MINUTES,
                    preference: planner::session::SessionPreference::Balanced,
                    history: context.history.clone(),
                })
            {
                let mut items: Vec<PlannedDailyItem> = session
                    .activities
                    .into_iter()
                    .take(DAILY_MISSION_MAX_ITEMS)
                    .enumerate()
                    .map(|(index, activity)| {
                        let practice =
                            activity.kind == planner::session::SessionActivityKind::Practice;
                        let question_ids = activity.question_ids.clone();
                        let title = daily_activity_title(
                            activity.kind,
                            activity.node_title.as_deref(),
                            &activity.domain_name,
                        );
                        PlannedDailyItem {
                            position: index as i32,
                            kind: daily_activity_kind(activity.kind),
                            domain_id: activity.domain_id,
                            node_id: activity.node_id,
                            title,
                            estimated_minutes: activity.estimated_minutes as i32,
                            practice_context: if practice {
                                serde_json::json!({ "question_ids": question_ids })
                            } else {
                                serde_json::json!({})
                            },
                        }
                    })
                    .collect();

                // At most one spaced delayed-retrieval item, and only when the
                // session has room. This keeps new-learning balance.
                if items.len() < DAILY_MISSION_MAX_ITEMS {
                    if let Some(delayed) = delayed_retrieval_item(&context, &items, Utc::now()) {
                        items.push(delayed);
                    }
                }

                if !items.is_empty() {
                    return GeneratedDailyItems {
                        adaptive: true,
                        items,
                    };
                }
            }
        }
        Err(error) => {
            tracing::debug!(error = %error, "adaptive daily mission generation failed");
        }
    }

    GeneratedDailyItems {
        adaptive: false,
        items: standard_daily_items(state, track_version),
    }
}

fn daily_activity_kind(kind: planner::session::SessionActivityKind) -> &'static str {
    use planner::session::SessionActivityKind;
    match kind {
        SessionActivityKind::LearnNode => "learn_node",
        SessionActivityKind::ReviewNode => "review_node",
        SessionActivityKind::Practice => "practice",
        SessionActivityKind::PracticeDomain => "domain_practice",
    }
}

fn daily_activity_title(
    kind: planner::session::SessionActivityKind,
    node_title: Option<&str>,
    domain_name: &str,
) -> String {
    use planner::session::SessionActivityKind;
    match kind {
        SessionActivityKind::LearnNode | SessionActivityKind::ReviewNode => {
            node_title.unwrap_or(domain_name).to_owned()
        }
        SessionActivityKind::Practice => "Retrieval practice".to_owned(),
        SessionActivityKind::PracticeDomain => "Domain review".to_owned(),
    }
}

/// Builds a deterministic, non-adaptive plan from authored track content only.
///
/// This never reads concept state, recommendation data, or any adaptive API, so
/// it works even when the learner has no state or adaptive planning is down.
fn standard_daily_items(state: &AppState, track_version: &str) -> Vec<PlannedDailyItem> {
    let Some(bundle) = state.content.bundle_for_version(track_version) else {
        return Vec::new();
    };
    let mut items: Vec<PlannedDailyItem> = Vec::new();
    let mut minutes = 0u32;

    for domain in &bundle.version.domains {
        if items.len() >= DAILY_MISSION_MAX_ITEMS || minutes >= DAILY_MISSION_MINUTES {
            break;
        }
        if let Some(learning) = state
            .content
            .learning_domain_for_certification(&bundle.certification.id, &domain.id)
        {
            if let Some(node) = learning
                .modules
                .first()
                .and_then(|module| module.nodes.first())
            {
                items.push(PlannedDailyItem {
                    position: items.len() as i32,
                    kind: "learn_node",
                    domain_id: domain.id.clone(),
                    node_id: Some(node.id.clone()),
                    title: node.title.clone(),
                    estimated_minutes: 4,
                    practice_context: serde_json::json!({}),
                });
                minutes += 4;
            }
        }
        if items.len() >= DAILY_MISSION_MAX_ITEMS || minutes >= DAILY_MISSION_MINUTES {
            break;
        }
        if !state
            .content
            .questions_for_domain(track_version, &domain.id)
            .is_empty()
        {
            items.push(PlannedDailyItem {
                position: items.len() as i32,
                kind: "domain_practice",
                domain_id: domain.id.clone(),
                node_id: None,
                title: "Domain review".to_owned(),
                estimated_minutes: 6,
                practice_context: serde_json::json!({}),
            });
            minutes += 6;
        }
    }

    items
}

/// Starts the practice mission for one Daily Mission item.
///
/// The server owns the question set: practice items use the persisted
/// server-selected ids, and domain items reuse the normal adaptive domain
/// selector. The client never supplies question ids.
pub async fn start_daily_item(
    state: &AppState,
    user: &AuthenticatedUser,
    mission_id: Uuid,
    position: i32,
) -> Result<MissionResponse, ApiError> {
    let daily = db::daily_missions::find_by_id(&state.pool, mission_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if daily.user_id != user.id {
        return Err(ApiError::Forbidden);
    }
    if daily.is_completed() {
        return Err(ApiError::Conflict(
            "daily mission is already complete".to_owned(),
        ));
    }
    let item = daily
        .items
        .iter()
        .find(|item| item.position == position)
        .cloned()
        .ok_or(ApiError::NotFound)?;
    if item.status == "completed" {
        return Err(ApiError::Conflict("item is already complete".to_owned()));
    }

    // Resume an already-issued mission for this item instead of duplicating it.
    // A mission issued from content that has since changed can reference
    // questions that no longer exist; closing it here makes the code below issue
    // a fresh mission from current content instead of resuming an unscoreable one.
    if let Some(existing) =
        db::missions::find_active_for_daily_item(&state.pool, user.id, mission_id, position).await?
    {
        if mission_questions_resolve(state, &existing) {
            return Ok(mission_response(state, existing));
        }
        tracing::warn!(
            mission = %existing.id,
            "replacing a daily-item mission whose content has changed"
        );
        db::missions::mark_completed(&state.pool, existing.id, user.id).await?;
    }

    let bundle = state
        .content
        .bundle_for_version(&daily.track_version)
        .ok_or(ApiError::NotFound)?;
    let now = Utc::now();

    let (mode, domain_id, question_ids) = match item.kind.as_str() {
        "practice" => {
            let ids = practice_question_ids(&item.practice_context);
            if ids.is_empty() {
                return Err(ApiError::Conflict(
                    "practice content is unavailable".to_owned(),
                ));
            }
            for id in &ids {
                if state.content.question(&daily.track_version, id).is_none() {
                    return Err(ApiError::Conflict(
                        "practice content changed since the plan was created".to_owned(),
                    ));
                }
            }
            (QuizMode::RecommendedPractice, item.domain_id.clone(), ids)
        }
        "domain_practice" => {
            let request = IssueMissionRequest {
                device_id: None,
                certification_id: daily.track_id.clone(),
                certification_version: daily.track_version.clone(),
                mode: QuizMode::DomainQuiz,
                domain_id: Some(item.domain_id.clone()),
                task_id: None,
                module_id: None,
                question_id: None,
                recommendation_id: None,
            };
            let ids =
                select_ids(state, &request, Some(user.id), Some(&item.domain_id), now).await?;
            (QuizMode::DomainQuiz, item.domain_id.clone(), ids)
        }
        _ => {
            return Err(ApiError::BadRequest(
                "this item is completed on the knowledge map".to_owned(),
            ));
        }
    };

    if question_ids.is_empty() {
        return Err(ApiError::NotFound);
    }

    let mission = MissionInstance {
        id: Uuid::new_v4(),
        user_id: Some(user.id),
        device_id: Uuid::new_v4(),
        certification_id: bundle.certification.id.clone(),
        certification_version: bundle.version.id.clone(),
        content_version: bundle.version.content_version.clone(),
        mode,
        recommendation_id: None,
        daily_mission_id: Some(mission_id),
        daily_item_position: Some(position),
        domain_id: Some(domain_id),
        task_id: None,
        module_id: None,
        question_ids,
        status: MissionStatus::Issued,
        issued_at: now,
        expires_at: now + Duration::minutes(mode.ttl_minutes()),
        completed_at: None,
    };
    let stored = db::missions::insert(&state.pool, &mission).await?;

    let delayed = item
        .practice_context
        .get("delayed_retrieval")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    log_predictions_best_effort(state, Some(user), &stored, "daily_mission", delayed).await;

    Ok(mission_response(state, stored))
}

/// Completes a learning-node Daily Mission item from authoritative discovery.
///
/// The node is only considered complete when its required prompts are complete,
/// derived with the same rules as the Knowledge Map. Opening the node alone does
/// not complete it.
pub async fn complete_daily_item(
    state: &AppState,
    user: &AuthenticatedUser,
    mission_id: Uuid,
    position: i32,
    request: DailyItemCompleteRequest,
) -> Result<DailyItemCompleteResponse, ApiError> {
    let daily = db::daily_missions::find_by_id(&state.pool, mission_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if daily.user_id != user.id {
        return Err(ApiError::Forbidden);
    }
    let item = daily
        .items
        .iter()
        .find(|item| item.position == position)
        .cloned()
        .ok_or(ApiError::NotFound)?;
    if matches!(item.kind.as_str(), "practice" | "domain_practice") {
        return Err(ApiError::BadRequest(
            "practice items complete through their mission".to_owned(),
        ));
    }
    let node_id = item
        .node_id
        .clone()
        .ok_or_else(|| ApiError::BadRequest("item has no learning node".to_owned()))?;

    let merged =
        merged_track_discovery(state, user.id, &daily.track_version, &request.discovery).await;
    let derived = state
        .content
        .learning_domain(&daily.track_version, &item.domain_id)
        .and_then(|domain| {
            merged
                .iter()
                .find(|input| input.domain_id == item.domain_id)
                .map(|input| derive_domain_discovery(domain, input))
        })
        .unwrap_or_default();
    let unlocked = derived.unlocked_node_ids.contains(&node_id);

    let current = if unlocked {
        db::daily_missions::mark_item_complete(&state.pool, mission_id, position)
            .await?
            .unwrap_or(daily)
    } else {
        daily
    };
    settle_completed_reward(state, &current).await;
    let current = db::daily_missions::find_by_id(&state.pool, mission_id)
        .await?
        .unwrap_or(current);
    let bundle = state
        .content
        .bundle_for_version(&current.track_version)
        .ok_or(ApiError::NotFound)?;
    let item_completed = current
        .items
        .iter()
        .any(|item| item.position == position && item.status == "completed");

    Ok(DailyItemCompleteResponse {
        item_completed,
        mission: daily_response(&bundle.version.domains, &current),
    })
}

/// Settles the Daily Mission completion bonus exactly once, best-effort.
///
/// Mission completion is preserved even if settlement fails; the deterministic
/// ledger event id makes a later retry idempotent.
async fn settle_completed_reward(
    state: &AppState,
    mission: &db::daily_missions::StoredDailyMission,
) {
    if !mission.is_completed() || mission.reward_settled_at.is_some() || mission.reward_bits <= 0 {
        return;
    }

    let settle = async {
        let mut tx = state.pool.begin().await?;
        let transaction = db::wallets::BitTransaction {
            user_id: mission.user_id,
            device_id: None,
            event_id: mission.id,
            mission_instance_id: mission.id,
            question_id: "daily_mission".to_owned(),
            amount: mission.reward_bits as i64,
            reason: "daily_mission_complete".to_owned(),
        };
        // Idempotent by event_id; safe to retry.
        db::wallets::settle(&mut tx, &transaction).await?;
        db::daily_missions::mark_reward_settled(&mut tx, mission.id).await?;
        tx.commit().await?;
        Ok::<_, db::DbError>(())
    }
    .await;

    if let Err(error) = settle {
        tracing::debug!(error = %error, "could not settle daily mission reward");
    }
}

/// Maps a stored Daily Mission into its learner-facing response.
fn daily_response(
    domains: &[adaptive_learn_content::Domain],
    stored: &db::daily_missions::StoredDailyMission,
) -> DailyMissionResponse {
    let names: HashMap<&str, &str> = domains
        .iter()
        .map(|domain| (domain.id.as_str(), domain.name.as_str()))
        .collect();

    let items = stored
        .items
        .iter()
        .map(|item| DailyMissionItemDto {
            position: item.position,
            kind: DailyMissionItemKind::parse(&item.kind)
                .unwrap_or(DailyMissionItemKind::DomainPractice),
            domain_id: item.domain_id.clone(),
            domain_name: names
                .get(item.domain_id.as_str())
                .map(|name| (*name).to_owned())
                .unwrap_or_else(|| item.domain_id.clone()),
            node_id: item.node_id.clone(),
            title: item.title.clone(),
            estimated_minutes: item.estimated_minutes.max(0) as u32,
            status: if item.status == "completed" {
                DailyMissionItemStatus::Completed
            } else {
                DailyMissionItemStatus::Pending
            },
            question_count: practice_question_ids(&item.practice_context).len(),
            completed_at: item.completed_at,
        })
        .collect();

    DailyMissionResponse {
        id: stored.id,
        track_id: stored.track_id.clone(),
        track_version: stored.track_version.clone(),
        day_key: stored.day_key.format("%Y-%m-%d").to_string(),
        plan_type: if stored.plan_type == "adaptive" {
            DailyMissionPlanType::Adaptive
        } else {
            DailyMissionPlanType::Standard
        },
        status: if stored.is_completed() {
            DailyMissionStatus::Completed
        } else {
            DailyMissionStatus::Active
        },
        reward_bits: stored.reward_bits as i64,
        reward_granted: stored.reward_settled_at.is_some(),
        completed_items: stored.completed_items(),
        total_items: stored.items.len(),
        created_at: stored.created_at,
        completed_at: stored.completed_at,
        items,
    }
}

fn practice_question_ids(context: &serde_json::Value) -> Vec<String> {
    context
        .get("question_ids")
        .and_then(|value| value.as_array())
        .map(|ids| {
            ids.iter()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Keeps only safe, bounded timezone metadata.
fn sanitize_timezone(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.len() > 64 {
        return None;
    }
    Some(value.to_owned())
}

/// Records one recommendation lifecycle event, best-effort.
///
/// The response reports whether the auxiliary write landed, but the request
/// always succeeds so telemetry can never block learning.
pub async fn record_recommendation_event(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    recommendation_id: Uuid,
    request: RecommendationEventRequest,
) -> RecommendationEventResponse {
    record_event_best_effort(
        &state.pool,
        &db::recommendations::RecommendationEventEntry {
            event_id: request.event_id.unwrap_or_else(Uuid::new_v4),
            recommendation_id,
            user_id: user.id,
            track_id,
            event: request.event.as_str(),
            action: request.action.map(|action| action.as_str()),
            domain_id: request.domain_id.as_deref(),
            node_id: request.node_id.as_deref(),
            question_id: request.question_id.as_deref(),
        },
    )
    .await
}

/// Records a lifecycle event and reports whether it landed.
async fn record_event_best_effort(
    pool: &db::PgPool,
    entry: &db::recommendations::RecommendationEventEntry<'_>,
) -> RecommendationEventResponse {
    match db::recommendations::record_event(pool, entry).await {
        Ok(()) => RecommendationEventResponse { recorded: true },
        Err(error) => {
            tracing::debug!(error = %error, "could not record recommendation event");
            RecommendationEventResponse { recorded: false }
        }
    }
}

/// Derived discovery state for a whole track, aggregated across domains.
#[derive(Debug, Default)]
struct TrackDiscovery {
    explored_node_ids: HashSet<String>,
    unlocked_node_ids: HashSet<String>,
    completed_module_ids: HashSet<String>,
}

/// Mirrors the Knowledge Map's derivation for every domain of a track.
///
/// Domains without client progress contribute nothing, which matches a fresh
/// learner: no completed modules and only root-module nodes available.
fn derive_track_discovery(
    state: &AppState,
    track_version: &str,
    inputs: &[DomainDiscoveryInput],
) -> TrackDiscovery {
    let mut aggregate = TrackDiscovery::default();
    for domain in state
        .content
        .learning_domains()
        .iter()
        .filter(|domain| domain.certification_version == track_version)
    {
        let Some(input) = inputs
            .iter()
            .find(|input| input.domain_id == domain.domain.id)
        else {
            continue;
        };
        let derived = derive_domain_discovery(domain, input);
        aggregate
            .explored_node_ids
            .extend(derived.explored_node_ids);
        aggregate
            .unlocked_node_ids
            .extend(derived.unlocked_node_ids);
        aggregate
            .completed_module_ids
            .extend(derived.completed_module_ids);
    }
    aggregate
}

/// Loads persisted discovery and unions it with the current request's progress.
///
/// Persisted progress is an enhancement, never a prerequisite: a read failure is
/// logged and ignored, and planning continues from whatever the request
/// supplied. Because the result is a set-union, a newly revealed node is visible
/// to the next explicit planning request even before the discovery batch has
/// been persisted.
async fn merged_track_discovery(
    state: &AppState,
    user_id: Uuid,
    track_version: &str,
    request_discovery: &[DomainDiscoveryInput],
) -> Vec<DomainDiscoveryInput> {
    let persisted =
        match db::discovery::list_for_user_track(&state.pool, user_id, track_version).await {
            Ok(rows) => rows
                .into_iter()
                .map(|row| row.to_input())
                .collect::<Vec<_>>(),
            Err(error) => {
                tracing::debug!(
                    error = %error,
                    "could not load persisted discovery; using request progress only"
                );
                Vec::new()
            }
        };

    merge_discovery_sets(persisted, request_discovery)
}

/// Unions persisted and incoming discovery by domain, deterministically ordered.
fn merge_discovery_sets(
    persisted: impl IntoIterator<Item = DomainDiscoveryInput>,
    incoming: &[DomainDiscoveryInput],
) -> Vec<DomainDiscoveryInput> {
    let mut merged: BTreeMap<String, DomainDiscoveryInput> = BTreeMap::new();
    for input in persisted {
        merged.insert(input.domain_id.clone(), input);
    }
    for input in incoming {
        let union = match merged.get(&input.domain_id) {
            Some(existing) => merge_domain_discovery(existing, input),
            None => input.clone(),
        };
        merged.insert(input.domain_id.clone(), union);
    }
    merged.into_values().collect()
}

/// Returns a learner's persisted discovery for one track version.
pub async fn track_discovery(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
) -> Result<DiscoveryResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();

    let domains = db::discovery::list_for_user_track(&state.pool, user.id, &track_version)
        .await?
        .into_iter()
        .map(|row| row.to_input())
        .collect();

    Ok(DiscoveryResponse {
        track_version,
        domains,
    })
}

/// Maximum active days loaded when deriving the streak.
const STREAK_DAY_LIMIT: i64 = 4000;

/// Builds the aggregate Knowledge Signal for one track.
///
/// One request returns every domain and node so the Track Hub never fetches
/// per-node state. Coarse semantic states only: no raw probabilities,
/// percentages, or pass estimates. Evidence/freshness come from the derived
/// concept state; discovery comes from persisted discovery progress.
pub async fn track_progress(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
) -> Result<TrackProgressResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let track_version = bundle.version.id.clone();
    let now = Utc::now();

    let states: Vec<ConceptStateView> =
        db::concept_state::list_for_user(&state.pool, user.id, &track_version)
            .await?
            .into_iter()
            .map(|state| ConceptStateView {
                concept_id: state.concept_id,
                assessment_mode: state.assessment_mode,
                estimate: state.estimate,
                evidence_mass: state.evidence_mass,
                exposure_count: state.exposure_count,
                last_practiced_at: state.last_practiced_at,
            })
            .collect();

    // Persisted discovery is an enhancement; a read failure degrades to
    // "unexplored" rather than failing the whole signal.
    let stored_discovery =
        match db::discovery::list_for_user_track(&state.pool, user.id, &track_version).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::debug!(error = %error, "could not load discovery for track progress");
                Vec::new()
            }
        };

    let domains = state
        .content
        .learning_domains()
        .iter()
        .filter(|domain| domain.certification_version == track_version)
        .map(|domain| {
            let input = stored_discovery
                .iter()
                .find(|row| row.domain_id == domain.domain.id)
                .map(|row| row.to_input())
                .unwrap_or_default();
            let derived = derive_domain_discovery(domain, &input);

            let nodes = domain
                .modules
                .iter()
                .flat_map(|module| module.nodes.iter())
                .map(|node| {
                    let discovery_state = if derived.unlocked_node_ids.contains(&node.id) {
                        DiscoveryState::Completed
                    } else if derived.explored_node_ids.contains(&node.id) {
                        DiscoveryState::Explored
                    } else {
                        DiscoveryState::Unexplored
                    };
                    let signal = signals::derive_node_signal(&node.concept_ids, &states, now);
                    NodeProgressDto {
                        node_id: node.id.clone(),
                        discovery_state,
                        evidence_level: signal.evidence_level,
                        freshness_state: signal.freshness_state,
                        mode_signals: signal.mode_signals,
                    }
                })
                .collect();

            DomainProgressDto {
                domain_id: domain.domain.id.clone(),
                nodes,
            }
        })
        .collect();

    Ok(TrackProgressResponse {
        track_id: track_id.to_owned(),
        track_version,
        content_version: bundle.version.content_version.clone(),
        domains,
    })
}

/// Returns the account-wide daily study streak, best-effort.
///
/// A query failure returns a neutral streak; the streak never fails account
/// loading or learning.
pub async fn streak(state: &AppState, user: &AuthenticatedUser) -> StreakDto {
    let timezone = match db::users::timezone(&state.pool, user.id).await {
        Ok(timezone) => timezone,
        Err(error) => {
            tracing::debug!(error = %error, "could not read timezone for streak");
            None
        }
    };
    let days = match db::study_days::list_days(&state.pool, user.id, STREAK_DAY_LIMIT).await {
        Ok(days) => days,
        Err(error) => {
            tracing::debug!(error = %error, "could not load study days for streak");
            Vec::new()
        }
    };
    let today = local_day(Utc::now(), timezone.as_deref().unwrap_or("UTC"));
    StreakDto::from(summarize_streak(days, today))
}

/// Returns the learner's study settings, best-effort.
pub async fn user_settings(state: &AppState, user: &AuthenticatedUser) -> UserSettingsDto {
    let unlock_all_materials = match db::users::unlock_all_materials(&state.pool, user.id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::debug!(error = %error, "could not read study settings");
            false
        }
    };
    UserSettingsDto {
        unlock_all_materials,
    }
}

/// Updates the learner's study settings.
///
/// Settings are preferences only and never affect scoring, evidence, or rewards.
pub async fn update_settings(
    state: &AppState,
    user: &AuthenticatedUser,
    request: UpdateSettingsRequest,
) -> Result<UserSettingsDto, ApiError> {
    let stored =
        db::users::set_unlock_all_materials(&state.pool, user.id, request.unlock_all_materials)
            .await?;
    Ok(UserSettingsDto {
        unlock_all_materials: stored,
    })
}

/// Captures the request timezone when absent and returns the effective one.
///
/// The timezone is captured once (matching Daily Mission behavior), so a later
/// change cannot move the study-day boundary or farm streak days.
async fn effective_timezone(
    state: &AppState,
    user_id: Uuid,
    requested: Option<&str>,
) -> Option<String> {
    let requested = sanitize_timezone(requested);
    if let Some(timezone) = requested.as_deref() {
        if let Err(error) = db::users::set_timezone_if_absent(&state.pool, user_id, timezone).await
        {
            tracing::debug!(error = %error, "could not persist learner timezone");
        }
    }
    match db::users::timezone(&state.pool, user_id).await {
        Ok(stored) => stored.or(requested),
        Err(error) => {
            tracing::debug!(error = %error, "could not read learner timezone");
            requested
        }
    }
}

/// Records today as a qualified study day, swallowing every failure.
///
/// The streak is motivational only: it never shares a transaction with learning
/// events, concept state, or rewards, and a failure is logged and ignored.
async fn record_study_day_best_effort(state: &AppState, user_id: Uuid, timezone: Option<&str>) {
    let day = local_day(Utc::now(), timezone.unwrap_or("UTC"));
    if let Err(error) = db::study_days::record(&state.pool, user_id, day).await {
        tracing::debug!(error = %error, "could not record study day");
    }
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
    let (domain_id, task_id, module_id, question_ids) =
        build_question_set(state, &request, owner, now).await?;
    if question_ids.is_empty() {
        return Err(ApiError::NotFound);
    }

    let recommendation_id = request.recommendation_id;
    let mission = MissionInstance {
        id: Uuid::new_v4(),
        user_id: owner,
        device_id,
        certification_id: bundle.certification.id.clone(),
        certification_version: bundle.version.id.clone(),
        content_version: bundle.version.content_version.clone(),
        mode: request.mode,
        recommendation_id,
        daily_mission_id: None,
        daily_item_position: None,
        domain_id,
        task_id,
        module_id,
        question_ids,
        status: MissionStatus::Issued,
        issued_at: now,
        expires_at: now + Duration::minutes(request.mode.ttl_minutes()),
        completed_at: None,
    };

    let stored = db::missions::insert(&state.pool, &mission).await?;

    // Best-effort lifecycle telemetry: a mission was started from a
    // recommendation. This is auxiliary and never affects the mission.
    if let (Some(id), Some(user)) = (recommendation_id, user) {
        let action = match stored.mode {
            QuizMode::RecommendedPractice => "practice_question",
            _ => "practice_domain",
        };
        let _ = record_event_best_effort(
            &state.pool,
            &db::recommendations::RecommendationEventEntry {
                event_id: Uuid::new_v4(),
                recommendation_id: id,
                user_id: user.id,
                track_id: &stored.certification_id,
                event: "started",
                action: Some(action),
                domain_id: stored.domain_id.as_deref(),
                node_id: None,
                question_id: None,
            },
        )
        .await;
    }

    log_predictions_best_effort(
        state,
        user,
        &stored,
        mission_practice_source(stored.mode, recommendation_id.is_some()),
        false,
    )
    .await;

    if let (Some(user), Some(device)) = (user, request.device_id) {
        if let Err(error) = db::devices::upsert(&state.pool, device, user.id).await {
            tracing::debug!(error = %error, "could not associate device with user");
        }
    }

    Ok(mission_response(state, stored))
}

/// Maps a stored mission into its learner-facing response.
fn mission_response(state: &AppState, stored: MissionInstance) -> MissionResponse {
    let questions: Vec<StudyQuestionView> = stored
        .question_ids
        .iter()
        .filter_map(|id| {
            state
                .content
                .question(&stored.certification_version, id)
                .map(study_question_view)
        })
        .collect();

    MissionResponse {
        id: stored.id,
        device_id: stored.device_id,
        certification_id: stored.certification_id,
        certification_version: stored.certification_version,
        content_version: stored.content_version,
        mode: stored.mode,
        domain_id: stored.domain_id,
        task_id: stored.task_id,
        module_id: stored.module_id,
        issued_at: stored.issued_at,
        expires_at: stored.expires_at,
        questions,
        // Ordinary missions carry no challenge orchestration. Challenge
        // missions attach it at issuance in `start_challenge`.
        challenge: None,
    }
}

/// Builds a read-only review of a completed mission.
///
/// Review is only available after completion, so canonical answers cannot leak
/// for in-progress work. It never creates evidence or changes scores.
pub async fn mission_review(
    state: &AppState,
    user: &AuthenticatedUser,
    mission_id: Uuid,
) -> Result<MissionReviewResponse, ApiError> {
    let mission = load_mission(state, mission_id).await?;
    if mission.user_id != Some(user.id) {
        return Err(ApiError::Forbidden);
    }
    if mission.status != MissionStatus::Completed {
        return Err(ApiError::Conflict("mission is not complete yet".to_owned()));
    }

    let questions = mission
        .question_ids
        .iter()
        .filter_map(|id| state.content.question(&mission.certification_version, id))
        .map(|question| ReviewedQuestion {
            id: question.id.clone(),
            domain_id: question.domain_id.clone(),
            task_id: question.task_id.clone(),
            prompt: question.prompt.clone(),
            assessment_mode: question.assessment_mode,
            interaction: question.interaction.clone(),
            concepts: concept_weights(question),
            canonical_answer: question.canonical_answer.clone(),
            explanation: question.explanation.clone(),
            hints: question.hints.clone(),
        })
        .collect();

    let attempts = db::learning_events::list_for_mission(&state.pool, mission.id)
        .await?
        .into_iter()
        .map(|event| ReviewedAttempt {
            question_id: event.question_id,
            attempt_number: event.attempt_number,
            score: event.score,
            correct: event.score >= SUCCESS_THRESHOLD,
            hint_count: event.hint_count,
            occurred_at: event.occurred_at,
        })
        .collect();

    Ok(MissionReviewResponse {
        mission_id: mission.id,
        mode: mission.mode,
        completed_at: mission.completed_at,
        questions,
        attempts,
    })
}

/// Reviews the mission that executed a Daily Mission item.
pub async fn daily_item_review(
    state: &AppState,
    user: &AuthenticatedUser,
    daily_mission_id: Uuid,
    position: i32,
) -> Result<MissionReviewResponse, ApiError> {
    let daily = db::daily_missions::find_by_id(&state.pool, daily_mission_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if daily.user_id != user.id {
        return Err(ApiError::Forbidden);
    }

    let mission =
        db::missions::find_for_daily_item(&state.pool, user.id, daily_mission_id, position)
            .await?
            .ok_or(ApiError::NotFound)?;

    mission_review(state, user, mission.id).await
}

/// Builds `(domain_id, task_id, module_id, question_ids)` for a mode.
async fn build_question_set(
    state: &AppState,
    request: &IssueMissionRequest,
    owner: Option<Uuid>,
    now: chrono::DateTime<Utc>,
) -> Result<(Option<String>, Option<String>, Option<String>, Vec<String>), ApiError> {
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
                None,
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
            Ok((Some(domain_id), None, None, ids))
        }
        QuizMode::QuickAdaptive | QuizMode::FullPractice => {
            let ids = select_ids(state, request, owner, None, now).await?;
            Ok((None, None, None, ids))
        }
        QuizMode::RecommendedPractice => {
            let owner = owner.ok_or(ApiError::Unauthorized)?;
            let anchor_id = request.question_id.as_deref().ok_or_else(|| {
                ApiError::BadRequest("recommended_practice requires question_id".to_owned())
            })?;
            // The anchor is validated against canonical content; the rest of the
            // set is chosen server-side below.
            let anchor = state
                .content
                .question(version, anchor_id)
                .ok_or(ApiError::NotFound)?;
            let ids = select_recommended_practice(state, version, anchor, owner).await?;
            Ok((
                Some(anchor.domain_id.clone()),
                Some(anchor.task_id.clone()),
                None,
                ids,
            ))
        }
        QuizMode::SectionQuiz => {
            let owner = owner.ok_or(ApiError::Unauthorized)?;
            let domain_id = request.domain_id.clone().ok_or_else(|| {
                ApiError::BadRequest("section_quiz requires domain_id".to_owned())
            })?;
            let module_id = request.module_id.clone().ok_or_else(|| {
                ApiError::BadRequest("section_quiz requires module_id".to_owned())
            })?;
            let ids = select_section_quiz(
                state,
                &request.certification_id,
                version,
                &domain_id,
                &module_id,
                owner,
                now,
            )
            .await?;
            let task_id = ids
                .first()
                .and_then(|id| state.content.question(version, id))
                .map(|question| question.task_id.clone());
            Ok((Some(domain_id), task_id, Some(module_id), ids))
        }
        // A challenge is composed from its authored definition by
        // `start_challenge`, not by the generic mission-issuance path.
        QuizMode::Challenge => Err(ApiError::BadRequest(
            "challenges must be started from their track".to_owned(),
        )),
    }
}

/// Starts an authored multi-stage challenge as one ordinary mission.
///
/// The server owns composition: it resolves the authored definition, checks
/// authored prerequisites against the learner's discovery, freezes the
/// referenced content version, and issues one mission whose `question_ids` are
/// the challenge's question stages in order. The client never supplies question
/// ids and cannot construct a challenge.
pub async fn start_challenge(
    state: &AppState,
    user: &AuthenticatedUser,
    track_id: &str,
    challenge_id: &str,
    request: ChallengeStartRequest,
) -> Result<MissionResponse, ApiError> {
    let bundle = state
        .content
        .bundle_for_certification(track_id)
        .ok_or(ApiError::NotFound)?;
    let challenge = state
        .content
        .challenge(track_id, challenge_id)
        .ok_or(ApiError::NotFound)?;
    if challenge.certification_version != bundle.version.id {
        return Err(ApiError::NotFound);
    }

    // Authored prerequisites reuse existing Knowledge Map unlock semantics.
    if !challenge.prerequisite_node_ids.is_empty() {
        let merged =
            merged_track_discovery(state, user.id, &bundle.version.id, &request.discovery).await;
        let derived = derive_track_discovery(state, &bundle.version.id, &merged);
        let unmet = challenge
            .prerequisite_node_ids
            .iter()
            .filter(|node_id| !derived.unlocked_node_ids.contains(*node_id))
            .count();
        if unmet > 0 {
            return Err(ApiError::Conflict(
                "challenge prerequisites are not met yet".to_owned(),
            ));
        }
    }

    let now = Utc::now();
    let device_id = request.device_id.unwrap_or_else(Uuid::new_v4);
    let mission = MissionInstance {
        id: Uuid::new_v4(),
        user_id: Some(user.id),
        device_id,
        certification_id: bundle.certification.id.clone(),
        certification_version: bundle.version.id.clone(),
        content_version: bundle.version.content_version.clone(),
        mode: QuizMode::Challenge,
        recommendation_id: None,
        daily_mission_id: None,
        daily_item_position: None,
        domain_id: challenge.domain_id.clone(),
        task_id: None,
        module_id: None,
        question_ids: challenge.ordered_question_ids(),
        status: MissionStatus::Issued,
        issued_at: now,
        expires_at: now + Duration::minutes(QuizMode::Challenge.ttl_minutes()),
        completed_at: None,
    };
    let stored = db::missions::insert(&state.pool, &mission).await?;

    if let Some(device) = request.device_id {
        if let Err(error) = db::devices::upsert(&state.pool, device, user.id).await {
            tracing::debug!(error = %error, "could not associate device with user");
        }
    }

    // Measurement only; failure never affects the issued challenge.
    log_predictions_best_effort(state, Some(user), &stored, "challenge", false).await;

    let mut response = mission_response(state, stored);
    response.challenge = Some(challenge_view(state, challenge));
    Ok(response)
}

/// Maps an authored challenge into its learner-facing orchestration view.
fn challenge_view(
    state: &AppState,
    challenge: &adaptive_learn_content::ChallengeDefinition,
) -> ChallengeView {
    let version = &challenge.certification_version;
    let stages = challenge
        .ordered_stages()
        .into_iter()
        .map(|stage| {
            let (kind, question_id, node_id) = match stage {
                adaptive_learn_content::ChallengeStage::Question { question_id, .. } => (
                    ChallengeStageKind::Question,
                    Some(question_id.clone()),
                    None,
                ),
                adaptive_learn_content::ChallengeStage::LearningNode { node_id, .. } => (
                    ChallengeStageKind::LearningNode,
                    None,
                    Some(node_id.clone()),
                ),
            };
            let domain_id = question_id
                .as_deref()
                .and_then(|id| state.content.question(version, id))
                .map(|question| question.domain_id.clone())
                .or_else(|| {
                    node_id
                        .as_deref()
                        .and_then(|id| state.content.node_domain_id(version, id))
                        .map(str::to_owned)
                });
            ChallengeStageView {
                id: stage.id().to_owned(),
                order: stage.order(),
                kind,
                question_id,
                node_id,
                domain_id,
            }
        })
        .collect();

    ChallengeView {
        id: challenge.id.clone(),
        title: challenge.title.clone(),
        description: challenge.description.clone(),
        estimated_minutes: challenge.estimated_minutes(),
        stages,
    }
}

/// Builds the focused set for a recommended-practice mission.
///
/// The anchor question is always first and must exist in canonical content. The
/// remaining questions are selected server-side from authored concept overlap;
/// the client never supplies them.
async fn select_recommended_practice(
    state: &AppState,
    version: &str,
    anchor: &Question,
    owner: Uuid,
) -> Result<Vec<String>, ApiError> {
    let candidates: Vec<Candidate> = state
        .content
        .questions_for_version(version)
        .into_iter()
        .map(candidate_from)
        .collect();
    if candidates.is_empty() {
        return Err(ApiError::NotFound);
    }

    let anchor_candidate = candidate_from(anchor);
    let history = match state.content.bundle_for_version(version) {
        Some(bundle) => history_entries(
            state,
            version,
            db::learning_events::recent_for_user(
                &state.pool,
                owner,
                &bundle.certification.id,
                HISTORY_LIMIT,
            )
            .await?,
        ),
        None => Vec::new(),
    };

    Ok(selection::recommended_practice(
        &anchor_candidate,
        &candidates,
        &history,
        selection::RECOMMENDED_PRACTICE_LEN,
    ))
}

/// Selects the single adaptive question for a section (module) quiz.
///
/// The module's question pool comes from canonical learning content, so the
/// client never supplies it. Selection reuses the learner's cross-device
/// history and derived concept state, exactly like the other adaptive modes.
async fn select_section_quiz(
    state: &AppState,
    certification_id: &str,
    version: &str,
    domain_id: &str,
    module_id: &str,
    owner: Uuid,
    now: chrono::DateTime<Utc>,
) -> Result<Vec<String>, ApiError> {
    let questions = state
        .content
        .questions_for_module(version, domain_id, module_id);
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

    let history = history_entries(
        state,
        version,
        db::learning_events::recent_for_user(&state.pool, owner, certification_id, HISTORY_LIMIT)
            .await?,
    );

    let states: Vec<ConceptEvidence> =
        db::concept_state::list_for_user(&state.pool, owner, version)
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

    Ok(selection::section_quiz(
        &candidates,
        &domains,
        &history,
        &states,
        now,
    ))
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
    let history = history_entries(
        state,
        version,
        db::learning_events::recent_for_user(
            &state.pool,
            user_id,
            &request.certification_id,
            HISTORY_LIMIT,
        )
        .await?,
    );

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
        pedagogy: question.pedagogy.clone(),
    }
}

/// Maps accepted history rows, joining authored pedagogy metadata by question id.
///
/// The learning event never stores pedagogy metadata; it is reconstructed from
/// canonical content here so selection can use it without duplication or a
/// schema change. A missing or changed question simply contributes no metadata.
fn history_entries(
    state: &AppState,
    version: &str,
    rows: Vec<db::learning_events::UserHistoryEntry>,
) -> Vec<HistoryEntry> {
    rows.into_iter()
        .map(|entry| {
            let question = state.content.question(version, &entry.question_id);
            let pedagogy = question.and_then(|question| question.pedagogy.clone());
            // Pair each authoritative stored error code with its authored
            // remediation metadata. The code comes from the accepted event; the
            // metadata is joined from canonical content, never duplicated onto
            // the event.
            let error_codes = entry
                .structured_error_codes
                .iter()
                .map(|code| HistoryErrorCode {
                    code: code.clone(),
                    remediation: question
                        .and_then(|question| {
                            question
                                .error_codes
                                .iter()
                                .find(|definition| &definition.code == code)
                        })
                        .and_then(|definition| definition.remediation.clone()),
                })
                .collect();
            HistoryEntry {
                question_id: entry.question_id,
                score: entry.score,
                assessment_mode: entry.assessment_mode,
                occurred_at: entry.occurred_at,
                concepts: entry.concepts,
                attempt_number: entry.attempt_number,
                hint_count: entry.hint_count,
                pedagogy,
                error_codes,
            }
        })
        .collect()
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

    let mut newly_accepted_any = false;
    for event in request.events {
        let event_id = event.event_id;
        let mission_id = event.mission_instance_id;

        let Some(mission) = missions.get(&mission_id).cloned() else {
            results.push(reject(event_id, "not_found"));
            continue;
        };

        match apply_event(state, user, device_id, &mission, event).await {
            Ok(applied) => {
                if applied.newly_accepted {
                    newly_accepted_any = true;
                }
                results.push(SyncEventResult {
                    event_id,
                    accepted: true,
                    error_code: None,
                    correct: applied.correct,
                    score: applied.score,
                    error_codes: applied.error_codes,
                    bits_settled: applied.bits_settled,
                });
            }
            Err(SyncRejection::Fatal(error)) => return Err(ApiError::Internal(error)),
            Err(SyncRejection::Rejected(code)) => results.push(reject(event_id, code)),
        }
    }

    // Completion is derived from server-known evidence, never from a client
    // claim: a mission completes once every one of its questions has an accepted
    // attempt. This lets a normal study session finish with two requests
    // (issue + sync) instead of a separate completion call. It is checked for
    // every mission referenced by the batch, so a retry after events were
    // accepted but not yet finalized still completes it. Bookkeeping failure is
    // logged and never fails the accepted events above.
    complete_satisfied_missions(state, user, device_id, &missions).await;

    let bits_balance = match user {
        Some(user) => db::wallets::balance(&state.pool, user.id).await?,
        None => 0,
    };

    // Account-wide study streak: a day qualifies when at least one scored event
    // was newly accepted. This runs after the authoritative events commit, in its
    // own statement, and every failure is swallowed, so a streak problem can
    // never fail answer acceptance, concept state, or Bits.
    if let Some(user) = user {
        if newly_accepted_any {
            let timezone = effective_timezone(state, user.id, request.timezone.as_deref()).await;
            record_study_day_best_effort(state, user.id, timezone.as_deref()).await;
        }
    }

    // Optional sections are processed after the authoritative events have been
    // committed, each in its own transaction and with its own disposition. An
    // auxiliary failure is logged and reported as not accepted; it can never
    // reject or roll back an accepted learning event.
    let discovery = persist_discovery_best_effort(state, user, &request.discovery_updates).await;
    let auxiliary =
        record_auxiliary_events_best_effort(state, user, &request.auxiliary_events).await;

    Ok(SyncResponse {
        results,
        bits_balance,
        discovery,
        auxiliary,
    })
}

/// Persists optional discovery deltas, swallowing every failure.
///
/// Discovery is a set-union, so a failure here is reported as not accepted and
/// the client may resend the same batch later; duplicates are harmless.
async fn persist_discovery_best_effort(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    updates: &[DiscoveryUpdateRequest],
) -> SyncSectionResult {
    if updates.is_empty() {
        return SyncSectionResult { accepted: true };
    }
    // Anonymous callers have no account to own persisted progress.
    let Some(user) = user else {
        return SyncSectionResult { accepted: false };
    };

    let mut accepted = true;
    for update in updates {
        // Only persist progress for content the server actually knows about, so a
        // client cannot accumulate arbitrary `(track, domain)` rows in hot
        // Postgres. Unknown domains are dropped; the Knowledge Map derivation
        // ignores unknown ids anyway.
        let domains: Vec<DomainDiscoveryInput> = update
            .domains
            .iter()
            .filter(|domain| {
                state
                    .content
                    .learning_domain(&update.track_version, &domain.domain_id)
                    .is_some()
            })
            .cloned()
            .collect();
        if domains.is_empty() {
            continue;
        }

        if let Err(error) = db::discovery::merge(
            &state.pool,
            user.id,
            &update.track_version,
            &update.content_version,
            &domains,
        )
        .await
        {
            tracing::debug!(error = %error, "could not persist discovery progress");
            accepted = false;
        }
    }
    SyncSectionResult { accepted }
}

/// Records optional auxiliary telemetry, swallowing every failure.
///
/// Each event carries a stable id, so retries are idempotent. A failure is
/// reported as not accepted without affecting the accepted learning events.
async fn record_auxiliary_events_best_effort(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    events: &[AuxiliaryEventRequest],
) -> SyncSectionResult {
    if events.is_empty() {
        return SyncSectionResult { accepted: true };
    }
    let Some(user) = user else {
        return SyncSectionResult { accepted: false };
    };

    let mut accepted = true;
    for event in events {
        let response = record_event_best_effort(
            &state.pool,
            &db::recommendations::RecommendationEventEntry {
                event_id: event.event_id,
                recommendation_id: event.recommendation_id,
                user_id: user.id,
                track_id: &event.track_id,
                event: event.event.as_str(),
                action: event.action.map(|action| action.as_str()),
                domain_id: event.domain_id.as_deref(),
                node_id: event.node_id.as_deref(),
                question_id: event.question_id.as_deref(),
            },
        )
        .await;
        if !response.recorded {
            accepted = false;
        }
    }
    SyncSectionResult { accepted }
}

fn reject(event_id: Uuid, code: impl Into<String>) -> SyncEventResult {
    SyncEventResult {
        event_id,
        accepted: false,
        error_code: Some(code.into()),
        correct: false,
        score: 0.0,
        error_codes: Vec::new(),
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

/// Outcome of applying one synced event.
struct AppliedEvent {
    /// Bits settled for this event (0 when rejected or already settled).
    bits_settled: i64,
    /// Whether the event was newly accepted (not a duplicate retry).
    newly_accepted: bool,
    /// Server-authoritative correctness verdict from canonical scoring.
    correct: bool,
    /// Server-authoritative partial score in `[0, 1]`.
    score: f64,
    /// Server-authoritative structured error codes.
    error_codes: Vec<String>,
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

    let mission = finalize_mission_completion(state, &mission)
        .await?
        .ok_or(ApiError::NotFound)?;

    Ok(CompleteMissionResponse {
        id: mission.id,
        status: mission.status,
        completed_at: mission.completed_at,
    })
}

/// Marks a mission completed and performs every completion side effect.
///
/// Used by the explicit `/complete` endpoint and by `/v1/sync` when
/// server-known completion criteria are met. Returns `None` when the mission row
/// no longer matches its owner/device. The daily-mission side effects are
/// idempotent, so a repeated call cannot double-settle a bonus.
async fn finalize_mission_completion(
    state: &AppState,
    mission: &MissionInstance,
) -> Result<Option<MissionInstance>, ApiError> {
    let updated = match mission.user_id {
        Some(owner) => db::missions::mark_completed(&state.pool, mission.id, owner).await?,
        None => {
            db::missions::mark_completed_anonymous_device(
                &state.pool,
                mission.id,
                mission.device_id,
            )
            .await?
        }
    };

    let Some(mission) = updated else {
        return Ok(None);
    };

    // Best-effort lifecycle telemetry: a mission started from a recommendation
    // was completed. Telemetry never affects mission completion.
    if let (Some(recommendation_id), Some(owner)) = (mission.recommendation_id, mission.user_id) {
        let _ = record_event_best_effort(
            &state.pool,
            &db::recommendations::RecommendationEventEntry {
                event_id: Uuid::new_v4(),
                recommendation_id,
                user_id: owner,
                track_id: &mission.certification_id,
                event: "completed",
                action: None,
                domain_id: mission.domain_id.as_deref(),
                node_id: None,
                question_id: None,
            },
        )
        .await;
    }

    // A mission that executes a Daily Mission item completes that item, which
    // may complete the whole Daily Mission and settle its bonus. This is
    // separate from authoritative mission completion and never fails it.
    if let (Some(daily_mission_id), Some(position)) =
        (mission.daily_mission_id, mission.daily_item_position)
    {
        match db::daily_missions::mark_item_complete(&state.pool, daily_mission_id, position).await
        {
            Ok(Some(updated)) => settle_completed_reward(state, &updated).await,
            Ok(None) => {}
            Err(error) => {
                tracing::debug!(error = %error, "could not update daily mission item");
            }
        }
    }

    // A completed section quiz settles its one-time section bonus. Settlement is
    // idempotent per learner/section, and it requires accepted evidence, so the
    // explicit `/complete` shortcut cannot mint Bits without answering.
    if mission.mode == QuizMode::SectionQuiz {
        settle_section_quiz_reward(state, &mission).await;
    }

    Ok(Some(mission))
}

/// Settles the one-time section-quiz completion bonus, best-effort.
///
/// Completion is derived from accepted evidence: the mission must have an
/// accepted attempt for every question. A bookkeeping failure is logged and
/// never fails the authoritative mission completion.
async fn settle_section_quiz_reward(state: &AppState, mission: &MissionInstance) {
    let (Some(user_id), Some(domain_id), Some(module_id)) = (
        mission.user_id,
        mission.domain_id.as_deref(),
        mission.module_id.as_deref(),
    ) else {
        return;
    };
    if mission.question_ids.is_empty() {
        return;
    }

    match db::learning_events::covered_question_count(&state.pool, mission.id).await {
        Ok(covered) if covered >= mission.question_ids.len() as i64 => {}
        Ok(_) => return,
        Err(error) => {
            tracing::debug!(error = %error, "could not check section quiz coverage");
            return;
        }
    }

    let settle = async {
        let mut tx = state.pool.begin().await?;
        db::section_quiz::settle_bonus(
            &mut tx,
            db::section_quiz::SectionQuizSettlement {
                user_id,
                track_id: &mission.certification_id,
                track_version: &mission.certification_version,
                domain_id,
                module_id,
                mission_instance_id: mission.id,
                amount: SECTION_QUIZ_BONUS_BITS,
            },
        )
        .await?;
        tx.commit().await?;
        Ok::<_, db::DbError>(())
    }
    .await;

    if let Err(error) = settle {
        tracing::debug!(error = %error, "could not settle section quiz reward");
    }
}

/// Completes every touched mission whose questions are all covered by accepted
/// server-side evidence.
///
/// This is the server-known completion criterion for the local-scoring flow:
/// the client finishes the mission and syncs its raw answers, and the server
/// decides completion from what it has actually accepted. Any bookkeeping
/// failure is logged; the accepted learning events, concept state, and Bits from
/// this batch are already committed and must not be rolled back.
async fn complete_satisfied_missions(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    device_id: Option<Uuid>,
    missions: &HashMap<Uuid, MissionInstance>,
) {
    for mission in missions.values() {
        let mission_id = mission.id;
        if mission.status == MissionStatus::Completed || mission.question_ids.is_empty() {
            continue;
        }

        // Ownership must still hold for the batch's caller.
        let authorized = match mission.user_id {
            Some(owner) => user.is_some_and(|user| user.id == owner),
            None => {
                is_demo_certification(&mission.certification_id)
                    && device_id == Some(mission.device_id)
            }
        };
        if !authorized {
            continue;
        }

        let covered =
            match db::learning_events::covered_question_count(&state.pool, mission_id).await {
                Ok(covered) => covered,
                Err(error) => {
                    tracing::debug!(error = %error, "could not check mission coverage");
                    continue;
                }
            };
        if covered < mission.question_ids.len() as i64 {
            continue;
        }

        if let Err(error) = finalize_mission_completion(state, mission).await {
            tracing::debug!(error = %error, "could not finalize completed mission");
        }
    }
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

/// Stable error code reported when a mission references content that no longer
/// exists because the certification content changed after it was issued.
pub const MISSION_CONTENT_STALE: &str = "mission_content_stale";

/// Whether every question a mission references still exists in current content.
///
/// Content updates rename or remove questions and bump the content version, so
/// a mission issued from older content can outlive its own questions. Such a
/// mission can never be scored and must be replaced rather than resumed.
fn mission_questions_resolve(state: &AppState, mission: &MissionInstance) -> bool {
    mission.question_ids.iter().all(|question_id| {
        state
            .content
            .question(&mission.certification_version, question_id)
            .is_some()
    })
}

async fn apply_event(
    state: &AppState,
    user: Option<&AuthenticatedUser>,
    device_id: Option<Uuid>,
    mission: &MissionInstance,
    event: SyncEventRequest,
) -> Result<AppliedEvent, SyncRejection> {
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

    // A missing question means the mission was issued from older content. That
    // is a recoverable per-event rejection, not a server failure: the client
    // drops the stale mission and starts a new one.
    let question = state
        .content
        .question(&mission.certification_version, &event.question_id)
        .ok_or_else(|| {
            tracing::warn!(
                mission = %mission.id,
                question = %event.question_id,
                "rejecting event for a mission whose content has changed"
            );
            SyncRejection::Rejected(MISSION_CONTENT_STALE.to_owned())
        })?;

    let submitted = to_submitted(event.answer)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;
    let scored = score(question, &submitted)
        .map_err(|error| SyncRejection::Rejected(error.code().to_owned()))?;
    let event_id = event.event_id;
    let question_id = event.question_id.clone();
    let occurred_at = event.occurred_at;
    // The authoritative result is mirrored back to the client so it can
    // reconcile its optimistic local score. Rejected events never reach here.
    let scored_correct = scored.correct;
    let scored_score = scored.score;
    let scored_error_codes = scored.error_codes.clone();

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

    // Measurement only: link the accepted event to its pre-answer prediction.
    // Failure here is ignored and never affects scoring or rewards.
    if let Some(attempt_number) = attempt {
        record_prediction_outcome_best_effort(
            state,
            mission,
            &question_id,
            event_id,
            attempt_number,
            scored.score,
            occurred_at,
        )
        .await;
    }

    let bits_settled = match attempt {
        Some(attempt_number) if owned_by_user => {
            reward_bits(attempt_number, scored_score, question.difficulty_prior)
        }
        _ => 0,
    };

    Ok(AppliedEvent {
        bits_settled,
        newly_accepted: attempt.is_some(),
        correct: scored_correct,
        score: scored_score,
        error_codes: scored_error_codes,
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
            tracing::warn!(
                mission = %mission.id,
                question = %question_id,
                "mission references content that has changed"
            );
            ApiError::MissionStale
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

/// Maps an answer payload into the normalized primitives the scorer consumes.
///
/// Public so the cross-language golden scoring tests exercise the exact same
/// transport-to-scorer conversion the request path uses.
pub fn to_submitted(payload: AnswerPayload) -> Result<SubmittedAnswer, ApiError> {
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
        choice_id,
        choice_ids,
        python_results,
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
        + usize::from(typed_answers.is_some())
        + usize::from(choice_id.is_some())
        + usize::from(choice_ids.is_some())
        + usize::from(python_results.is_some());

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
    if let Some(choice_id) = choice_id {
        return Ok(SubmittedAnswer::MultipleChoice(choice_id));
    }
    if let Some(choice_ids) = choice_ids {
        return Ok(SubmittedAnswer::MultipleResponse(choice_ids));
    }
    if let Some(python_results) = python_results {
        return Ok(SubmittedAnswer::PythonCode {
            passed: python_results.passed,
            total: python_results.total,
        });
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
        instruction: question.instruction.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: concept_weights(question),
        hints: question.hints.clone(),
        interaction: question.interaction.clone(),
    }
}

/// Builds the locally scoreable view used by ordinary study missions.
///
/// This is the deliberate boundary between the hidden-answer [`QuestionView`]
/// (practice tests, catalogs, pre-submit content) and study missions, which
/// carry their canonical answer so the browser can score immediately. The
/// server remains authoritative and re-scores every raw answer during sync.
fn study_question_view(question: &adaptive_learn_content::Question) -> StudyQuestionView {
    StudyQuestionView {
        id: question.id.clone(),
        domain_id: question.domain_id.clone(),
        task_id: question.task_id.clone(),
        prompt: question.prompt.clone(),
        instruction: question.instruction.clone(),
        interaction_type: question.interaction_type,
        assessment_mode: question.assessment_mode,
        difficulty_prior: question.difficulty_prior,
        concepts: concept_weights(question),
        hints: question.hints.clone(),
        interaction: question.interaction.clone(),
        canonical_answer: question.canonical_answer.clone(),
        explanation: question.explanation.clone(),
        choice_feedback: question.choice_feedback.clone(),
        // Learner-safe projection: strips authored remediation metadata, which
        // could reveal the intended repair before scoring.
        error_codes: question
            .error_codes
            .iter()
            .map(|definition| QuestionErrorCode {
                code: definition.code.clone(),
                description: definition.description.clone(),
            })
            .collect(),
    }
}

/// Note shown with every practice-test result.
///
/// Certification-neutral: the raw practice score is a study aid, not an
/// official vendor scaled score or a pass/fail result.
pub const PRACTICE_TEST_SCORE_NOTE: &str =
    "This is a raw practice score, not an official scaled score or a pass/fail result.";

/// Lists the practice tests available for a certification.
pub fn list_practice_tests(state: &AppState, certification_id: &str) -> PracticeTestListResponse {
    let practice_tests = state
        .content
        .practice_tests_for_certification(certification_id)
        .into_iter()
        .map(practice_test_summary)
        .collect();
    PracticeTestListResponse { practice_tests }
}

fn practice_test_summary(test: &PracticeTest) -> PracticeTestSummaryDto {
    PracticeTestSummaryDto {
        id: test.id.clone(),
        title: test.title.clone(),
        exam_code: test.exam_code.clone(),
        certification_version: test.certification_version.clone(),
        time_limit_minutes: test.time_limit_minutes,
        question_count: test.items.len(),
        scored_question_count: test.scored_question_count(),
        question_types: test.question_types.clone(),
    }
}

/// Returns learner-safe practice-test content, scoped to a certification.
///
/// The response never contains canonical answers, per-choice feedback, or
/// scored/unscored flags.
pub fn get_practice_test(
    state: &AppState,
    certification_id: &str,
    practice_test_id: &str,
) -> Result<PracticeTestResponse, ApiError> {
    let test = practice_test_for_certification(state, certification_id, practice_test_id)?;
    Ok(practice_test_view(test))
}

fn practice_test_view(test: &PracticeTest) -> PracticeTestResponse {
    PracticeTestResponse {
        id: test.id.clone(),
        title: test.title.clone(),
        exam_code: test.exam_code.clone(),
        certification_version: test.certification_version.clone(),
        content_version: test.content_version.clone(),
        time_limit_minutes: test.time_limit_minutes,
        question_count: test.items.len(),
        scored_question_count: test.scored_question_count(),
        question_types: test.question_types.clone(),
        items: test
            .items
            .iter()
            .map(|item| PracticeTestItemView {
                order: item.order,
                question: practice_test_question_view(&item.question),
            })
            .collect(),
    }
}

/// Learner-safe question projection for a pre-submission practice-test item.
///
/// Like [`question_view`], but never includes hints: a hint could reveal the
/// answer before the exam is submitted.
fn practice_test_question_view(question: &Question) -> QuestionView {
    QuestionView {
        hints: Vec::new(),
        ..question_view(question)
    }
}

/// Resolves a practice test, ensuring it belongs to the requested certification.
fn practice_test_for_certification<'a>(
    state: &'a AppState,
    certification_id: &str,
    practice_test_id: &str,
) -> Result<&'a PracticeTest, ApiError> {
    state
        .content
        .practice_tests_for_certification(certification_id)
        .into_iter()
        .find(|test| test.id == practice_test_id)
        .ok_or(ApiError::NotFound)
}

/// Scores a full practice-test submission against canonical content.
///
/// The whole attempt is scored in one call: there is no per-question feedback
/// while the exam is in progress, and answers are only revealed here. Scoring
/// is pure and idempotent, so retrying a submission yields the same result.
/// Only items marked scored count toward the practice score.
pub fn submit_practice_test(
    state: &AppState,
    certification_id: &str,
    practice_test_id: &str,
    request: PracticeTestSubmissionRequest,
) -> Result<PracticeTestResultResponse, ApiError> {
    let test = practice_test_for_certification(state, certification_id, practice_test_id)?;

    let items_by_id: HashMap<&str, &PracticeTestItem> = test
        .items
        .iter()
        .map(|item| (item.question.id.as_str(), item))
        .collect();

    let mut provided: HashMap<String, (AnswerPayload, SubmittedAnswer)> = HashMap::new();
    for entry in request.answers {
        let Some(item) = items_by_id.get(entry.question_id.as_str()) else {
            return Err(ApiError::BadRequest(format!(
                "unknown practice-test question {}",
                entry.question_id
            )));
        };
        if provided.contains_key(entry.question_id.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "question {} was submitted more than once",
                entry.question_id
            )));
        }
        let submitted = to_submitted(entry.answer.clone())?;
        // Validate against the authored interaction even if the learner left it
        // blank; a shape mismatch is a client bug, not a wrong answer.
        if !matches_submitted_shape(item, &submitted) {
            return Err(ApiError::BadRequest(format!(
                "answer shape does not match question {}",
                entry.question_id
            )));
        }
        provided.insert(entry.question_id, (entry.answer, submitted));
    }

    let mut questions = Vec::with_capacity(test.items.len());
    let mut correct_count = 0_usize;
    let mut answered_count = 0_usize;
    let mut domain_order: Vec<String> = Vec::new();
    let mut domains: HashMap<String, (usize, usize)> = HashMap::new();

    for item in &test.items {
        let question = &item.question;
        let entry = provided.remove(question.id.as_str());
        let (submitted_answer, correct) = match entry {
            Some((payload, submitted)) => {
                let scored = score(question, &submitted).map_err(|error| {
                    ApiError::BadRequest(format!(
                        "could not score question {}: {}",
                        question.id,
                        error.code()
                    ))
                })?;
                answered_count += 1;
                (Some(payload), Some(scored.correct))
            }
            None => (None, None),
        };

        if item.is_scored {
            let domain = domains
                .entry(question.domain_id.clone())
                .or_insert_with(|| {
                    domain_order.push(question.domain_id.clone());
                    (0, 0)
                });
            domain.1 += 1;
            if correct == Some(true) {
                correct_count += 1;
                domain.0 += 1;
            }
        }

        questions.push(PracticeTestItemResult {
            order: item.order,
            question_id: question.id.clone(),
            domain_id: question.domain_id.clone(),
            task_id: question.task_id.clone(),
            prompt: question.prompt.clone(),
            instruction: question.instruction.clone(),
            interaction_type: question.interaction_type,
            assessment_mode: question.assessment_mode,
            interaction: question.interaction.clone(),
            canonical_answer: question.canonical_answer.clone(),
            explanation: question.explanation.clone(),
            choice_feedback: question.choice_feedback.clone(),
            is_scored: item.is_scored,
            answered: submitted_answer.is_some(),
            submitted_answer,
            correct,
        });
    }

    let scored_question_count = test.scored_question_count();
    let total_questions = test.items.len();
    let raw_accuracy = if scored_question_count == 0 {
        0.0
    } else {
        correct_count as f64 / scored_question_count as f64
    };

    let domain_breakdown = domain_order
        .into_iter()
        .map(|domain_id| {
            let (correct, scored_count) = domains.remove(&domain_id).unwrap_or((0, 0));
            PracticeTestDomainResult {
                domain_id,
                correct,
                scored_count,
            }
        })
        .collect();

    Ok(PracticeTestResultResponse {
        id: test.id.clone(),
        title: test.title.clone(),
        exam_code: test.exam_code.clone(),
        total_questions,
        scored_question_count,
        correct_count,
        raw_accuracy,
        answered_count,
        unanswered_count: total_questions.saturating_sub(answered_count),
        domain_breakdown,
        questions,
        score_note: PRACTICE_TEST_SCORE_NOTE.to_owned(),
    })
}

/// Whether a submitted answer's shape matches the question's interaction.
///
/// `score` already rejects mismatches, but this keeps the error specific to the
/// item before any scoring side effects.
fn matches_submitted_shape(item: &PracticeTestItem, submitted: &SubmittedAnswer) -> bool {
    matches!(
        (&item.question.interaction, submitted),
        (
            adaptive_learn_content::Interaction::MultipleChoice { .. },
            SubmittedAnswer::MultipleChoice(_)
        ) | (
            adaptive_learn_content::Interaction::MultipleResponse { .. },
            SubmittedAnswer::MultipleResponse(_)
        ) | (
            adaptive_learn_content::Interaction::Classification { .. },
            SubmittedAnswer::Classification(_)
        ) | (
            adaptive_learn_content::Interaction::Ordering { .. },
            SubmittedAnswer::Ordering(_)
        ) | (
            adaptive_learn_content::Interaction::NodeConnection { .. },
            SubmittedAnswer::NodeConnection(_)
        ) | (
            adaptive_learn_content::Interaction::Reconstruction { .. },
            SubmittedAnswer::Reconstruction { .. }
        ) | (
            adaptive_learn_content::Interaction::EvidenceSelection { .. },
            SubmittedAnswer::EvidenceSelection(_)
        ) | (
            adaptive_learn_content::Interaction::SpotTheFault { .. },
            SubmittedAnswer::SpotTheFault(_)
        ) | (
            adaptive_learn_content::Interaction::FillSlots { .. },
            SubmittedAnswer::FillSlots(_)
        ) | (
            adaptive_learn_content::Interaction::Troubleshooting { .. }
                | adaptive_learn_content::Interaction::ScenarioChoiceChain { .. },
            SubmittedAnswer::Branching(_)
        ) | (
            adaptive_learn_content::Interaction::ConfigurationBuilder { .. },
            SubmittedAnswer::ConfigurationBuilder(_)
        ) | (
            adaptive_learn_content::Interaction::TwoDimensionalPlacement { .. },
            SubmittedAnswer::TwoDimensionalPlacement(_)
        ) | (
            adaptive_learn_content::Interaction::CommandAssembly { .. },
            SubmittedAnswer::CommandAssembly(_)
        ) | (
            adaptive_learn_content::Interaction::TypedFillBlank { .. },
            SubmittedAnswer::TypedFillBlank(_)
        )
    )
}

// ---------------------------------------------------------------------------
// Cyber Defense Stage 2 progression
// ---------------------------------------------------------------------------

/// Minimum plausible Cyber Defense attempt duration, in milliseconds.
const CYBER_MIN_DURATION_MS: i64 = 5_000;
/// Maximum plausible Cyber Defense attempt duration, in milliseconds.
const CYBER_MAX_DURATION_MS: i64 = 2 * 60 * 60 * 1000;
/// Maximum plausible remaining system health accepted from a client.
const CYBER_MAX_HEALTH: i32 = 100_000;
/// One-time career XP granted to a returning defender with imported progress.
const LEGACY_RETURNING_DEFENDER_XP: i64 = 50;

/// Derives the career transport view from raw XP.
fn career_dto(xp: i64) -> CyberCareerDto {
    let level = career_level_from_xp(xp);
    let current = xp_for_career_level(level).unwrap_or(0);
    let next = xp_for_career_level(level + 1);
    CyberCareerDto {
        xp,
        level,
        rank: career_rank(level).to_owned(),
        next_level_xp: next,
        xp_into_level: (xp - current).max(0),
        xp_for_next_level: next.map(|threshold| (threshold - current).max(0)),
    }
}

/// Derives the hero transport view from raw XP.
fn hero_dto(hero_id: &str, xp: i64, selected_talents: serde_json::Value) -> CyberHeroProgressDto {
    let level = hero_level_from_xp(xp);
    let current = xp_for_hero_level(level).unwrap_or(0);
    let next = xp_for_hero_level(level + 1);
    CyberHeroProgressDto {
        hero_id: hero_id.to_owned(),
        xp,
        level,
        max_level: adaptive_learn_domain::HERO_MAX_LEVEL,
        next_level_xp: next,
        xp_into_level: (xp - current).max(0),
        xp_for_next_level: next.map(|threshold| (threshold - current).max(0)),
        selected_talents,
    }
}

/// Builds the complete, server-authoritative Cyber Defense profile snapshot.
///
/// Levels and ranks are always derived here from stored XP; the client never
/// reconstructs them. The two Stage 1 heroes are reported even before any XP
/// row exists, so the frontend never has to invent defaults.
pub async fn cyber_defense_profile(
    state: &AppState,
    user: &AuthenticatedUser,
) -> Result<CyberDefenseProfileResponse, ApiError> {
    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;

    let profile = db::cyber_defense::get_or_create_profile(&mut conn, user.id).await?;
    let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
    let tower_rows = db::cyber_defense::list_tower_upgrades(&mut conn, user.id).await?;
    let hero_rows = db::cyber_defense::list_hero_progress(&mut conn, user.id).await?;
    let adversary_rows = db::cyber_defense::list_adversary_progress(&mut conn, user.id).await?;
    let story_rows = db::cyber_defense::list_story_progress(&mut conn, user.id).await?;
    let campaign_rows = db::cyber_defense::list_campaign_results(&mut conn, user.id).await?;
    let active = db::cyber_defense::find_active_operation_run(&mut conn, user.id).await?;
    let cosmetic_unlocks = db::cyber_defense::list_cosmetic_unlocks(&mut conn, user.id).await?;

    let tower_by_id: HashMap<&str, i32> = tower_rows
        .iter()
        .map(|row| (row.upgrade_id.as_str(), row.level))
        .collect();
    let levels: Vec<i32> = TOWER_UPGRADES
        .iter()
        .map(|definition| tower_by_id.get(definition.id).copied().unwrap_or(0))
        .collect();
    let tower_upgrades: Vec<CyberTowerUpgradeDto> = TOWER_UPGRADES
        .iter()
        .zip(levels.iter())
        .map(|(definition, level)| CyberTowerUpgradeDto {
            upgrade_id: definition.id.to_owned(),
            level: *level,
            max_level: definition.max_level,
            next_cost: tower_upgrade_cost(definition.id, *level),
        })
        .collect();

    let hero_by_id: HashMap<&str, &db::cyber_defense::HeroProgress> = hero_rows
        .iter()
        .map(|row| (row.hero_id.as_str(), row))
        .collect();
    let heroes: Vec<CyberHeroProgressDto> = adaptive_learn_domain::DEFAULT_HERO_IDS
        .iter()
        .map(|hero_id| match hero_by_id.get(hero_id) {
            Some(row) => hero_dto(hero_id, row.xp, row.selected_talents.clone()),
            None => hero_dto(hero_id, 0, serde_json::json!({})),
        })
        .collect();

    let adversaries: Vec<CyberAdversaryProgressDto> = adversary_rows
        .iter()
        .map(|row| CyberAdversaryProgressDto {
            adversary_id: row.adversary_id.clone(),
            progress: row.progress,
            rank: adaptive_learn_domain::adversary_rank_from_progress(row.progress),
            encounters: row.encounters,
            victories: row.victories,
            highest_threat_level_cleared: row.highest_threat_level_cleared,
            dossier_flags: row.dossier_flags.clone(),
        })
        .collect();

    let campaign: Vec<CyberCampaignResultDto> = campaign_rows
        .iter()
        .map(|row| CyberCampaignResultDto {
            mission_id: row.mission_id.clone(),
            completed: row.completed,
            best_stars: row.best_stars,
            best_health: row.best_health,
            attempts: row.attempts,
            first_clear_reward_settled: row.first_clear_reward_settled,
        })
        .collect();

    let story = CyberStoryProgressDto {
        active_chapter: profile.active_story_chapter.clone(),
        completed_nodes: story_rows
            .iter()
            .map(|row| row.story_node_id.clone())
            .collect(),
    };

    let completed_campaign_missions: Vec<String> = campaign_rows
        .iter()
        .filter(|row| row.completed)
        .map(|row| row.mission_id.clone())
        .collect();
    let operations_unlocked = campaign_complete(&completed_campaign_missions);
    let story_input = StoryProgressInput {
        completed_campaign_missions,
        total_operations_completed: profile.total_operations_completed,
        highest_threat_level_cleared: profile.highest_threat_level_cleared,
        adversary_ranks: adversary_rows
            .iter()
            .map(|row| {
                (
                    row.adversary_id.clone(),
                    adversary_rank_from_progress(row.progress),
                )
            })
            .collect(),
        completed_operation_templates: Vec::new(),
        completed_nodes: story.completed_nodes.clone(),
    };
    let adversaries_available = available_adversaries(&AdversaryUnlockInput {
        campaign_complete: operations_unlocked,
        completed_story_nodes: story.completed_nodes.clone(),
    })
    .iter()
    .map(|id| (*id).to_owned())
    .collect();

    Ok(CyberDefenseProfileResponse {
        career: career_dto(profile.career_xp),
        bits_balance,
        tower_level: tower_level(&levels),
        tower_upgrades,
        heroes,
        adversaries,
        story,
        campaign,
        highest_threat_level_cleared: profile.highest_threat_level_cleared,
        recommended_threat_level: profile.recommended_threat_level,
        unlocked_threat_level: unlocked_threat_level(
            profile.recommended_threat_level,
            profile.highest_threat_level_cleared,
        ),
        total_operations_completed: profile.total_operations_completed,
        active_operation_run_id: active.map(|run| run.id),
        legacy_progress_imported: profile.legacy_progress_imported,
        operations_unlocked,
        confrontation_available: confrontation_available(&story_input),
        available_adversaries: adversaries_available,
        cosmetics: cosmetics_state(
            &cosmetic_unlocks,
            profile.equipped_theme.as_deref(),
            bits_balance,
        )
        .cosmetics,
        equipped_theme: profile.equipped_theme,
    })
}

/// Settles one Stage 1 campaign mission result and its reward.
///
/// The server derives completion, first-clear status, and every reward value
/// from canonical policy. `result_id` is the client idempotency key, so a
/// retried completion settles nothing a second time. Bits and progression
/// changes commit in one transaction.
pub async fn cyber_defense_campaign_complete(
    state: &AppState,
    user: &AuthenticatedUser,
    mission_id: &str,
    request: CyberCampaignCompleteRequest,
) -> Result<CyberCampaignCompleteResponse, ApiError> {
    if !is_campaign_mission(mission_id) {
        return Err(ApiError::BadRequest("unknown campaign mission".to_owned()));
    }
    if !(0..=3).contains(&request.stars) {
        return Err(ApiError::BadRequest(
            "stars must be between 0 and 3".to_owned(),
        ));
    }
    if !(0..=CYBER_MAX_HEALTH).contains(&request.health) {
        return Err(ApiError::BadRequest("invalid health".to_owned()));
    }
    if !(CYBER_MIN_DURATION_MS..=CYBER_MAX_DURATION_MS).contains(&request.duration_ms) {
        return Err(ApiError::BadRequest("implausible duration".to_owned()));
    }

    let hero_id = match request.hero_id.as_deref() {
        Some(hero) if !hero.is_empty() => {
            if !is_known_hero(hero) {
                return Err(ApiError::BadRequest("unknown hero".to_owned()));
            }
            Some(hero.to_owned())
        }
        _ => None,
    };

    let completed = request.stars > 0;
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;

    let profile = db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    // Serialize settlement for one wallet so two racing results cannot both
    // read the same pre-settlement state.
    db::wallets::lock_wallet(&mut tx, user.id).await?;

    let existing = db::cyber_defense::get_campaign_result(&mut tx, user.id, mission_id).await?;
    let already_settled = existing
        .as_ref()
        .is_some_and(|result| result.first_clear_reward_settled);

    // Server-side campaign order: a client cannot submit the boss (or any later
    // mission) before its prerequisite is already recorded as completed. The UI
    // also locks missions, but the server never trusts a client claim.
    let campaign_rows = db::cyber_defense::list_campaign_results(&mut tx, user.id).await?;
    let completed_missions: Vec<String> = campaign_rows
        .iter()
        .filter(|row| row.completed)
        .map(|row| row.mission_id.clone())
        .collect();
    if !campaign_mission_unlocked(mission_id, &completed_missions) {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::CyberCampaignMissionLocked);
    }

    let claimed = db::cyber_defense::claim_reward_event(
        &mut tx,
        request.result_id,
        user.id,
        "cyber_campaign",
    )
    .await?;

    if !claimed {
        // A duplicate of an already-settled result: settle nothing and report
        // the stored state.
        tx.rollback().await.map_err(db::DbError::from)?;
        let campaign = existing.ok_or(ApiError::NotFound)?;
        return Ok(CyberCampaignCompleteResponse {
            campaign: CyberCampaignResultDto {
                mission_id: campaign.mission_id,
                completed: campaign.completed,
                best_stars: campaign.best_stars,
                best_health: campaign.best_health,
                attempts: campaign.attempts,
                first_clear_reward_settled: campaign.first_clear_reward_settled,
            },
            reward: CyberRewardDto {
                bits: 0,
                career_xp: 0,
                hero_xp: 0,
            },
            bits_balance: db::wallets::balance(&state.pool, user.id).await?,
            career: CyberCareerSummaryDto {
                xp: profile.career_xp,
                level: career_level_from_xp(profile.career_xp),
                rank: career_rank(career_level_from_xp(profile.career_xp)).to_owned(),
                level_up: false,
            },
            newly_settled: false,
            story_nodes_completed: Vec::new(),
        });
    }

    let first_clear = completed && !already_settled;
    let mut reward = fixed_mission_reward(mission_id, request.stars, first_clear);
    // Hero XP only lands when a known hero is named, so the selected hero is
    // the one that levels. The Training Center bonus is derived server-side.
    let training_level =
        db::cyber_defense::get_tower_upgrade_level(&mut tx, user.id, "training_center").await?;
    let hero_xp = if hero_id.is_some() {
        scale_xp(
            reward.hero_xp,
            training_center_hero_xp_multiplier(training_level),
        )
    } else {
        reward.hero_xp = 0;
        0
    };

    if reward.bits > 0 {
        let transaction = db::wallets::BitTransaction {
            user_id: user.id,
            device_id: None,
            event_id: request.result_id,
            mission_instance_id: request.result_id,
            question_id: mission_id.to_owned(),
            amount: reward.bits,
            reason: "cyber_campaign_reward".to_owned(),
        };
        db::wallets::settle(&mut tx, &transaction).await?;
    }

    let career_xp =
        db::cyber_defense::increment_career_xp(&mut tx, user.id, reward.career_xp).await?;
    if let Some(hero) = hero_id.as_deref() {
        db::cyber_defense::increment_hero_xp(&mut tx, user.id, hero, hero_xp).await?;
    }

    let campaign = db::cyber_defense::upsert_campaign_result(
        &mut tx,
        user.id,
        mission_id,
        completed,
        request.stars,
        request.health,
        first_clear,
    )
    .await?;

    let story_nodes_completed = evaluate_and_record_story(&mut tx, user.id).await?;

    tx.commit().await.map_err(db::DbError::from)?;

    let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
    let level = career_level_from_xp(career_xp);
    Ok(CyberCampaignCompleteResponse {
        campaign: CyberCampaignResultDto {
            mission_id: campaign.mission_id,
            completed: campaign.completed,
            best_stars: campaign.best_stars,
            best_health: campaign.best_health,
            attempts: campaign.attempts,
            first_clear_reward_settled: campaign.first_clear_reward_settled,
        },
        reward: CyberRewardDto {
            bits: reward.bits,
            career_xp: reward.career_xp,
            hero_xp,
        },
        bits_balance,
        career: CyberCareerSummaryDto {
            xp: career_xp,
            level,
            rank: career_rank(level).to_owned(),
            level_up: level > career_level_from_xp(profile.career_xp),
        },
        newly_settled: true,
        story_nodes_completed,
    })
}

/// Purchases the next level of one Tower/HQ room.
///
/// The client sends only an idempotency `event_id`; the server derives the room
/// level from the settled ledger, checks prerequisites, computes the canonical
/// cost, and debits the wallet. Bits spend and the level increment commit in one
/// transaction.
pub async fn cyber_defense_tower_purchase(
    state: &AppState,
    user: &AuthenticatedUser,
    upgrade_id: &str,
    request: CyberTowerUpgradePurchaseRequest,
) -> Result<CyberTowerUpgradePurchaseResponse, ApiError> {
    let definition = tower_upgrade(upgrade_id)
        .ok_or_else(|| ApiError::BadRequest("unknown tower upgrade".to_owned()))?;
    // Tower purchases are not tied to an Operation run; the ledger groups them
    // under the nil run id.
    let run_id = Uuid::nil();

    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    db::wallets::lock_wallet(&mut tx, user.id).await?;

    // Derive the room level from the settled ledger, excluding this request's
    // own key so a retry resolves to the level it originally upgraded from.
    let purchased =
        db::wallets::count_upgrades(&mut tx, user.id, run_id, upgrade_id, request.event_id).await?;
    let from_level = i32::try_from(purchased)
        .map_err(|_| ApiError::Conflict("tower upgrade level overflow".to_owned()))?;

    if from_level >= definition.max_level {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::Conflict(
            "tower upgrade is already at its maximum level".to_owned(),
        ));
    }

    if let Some((required_id, required_level)) = definition.prerequisite {
        let current =
            db::wallets::count_upgrades(&mut tx, user.id, run_id, required_id, request.event_id)
                .await?;
        if current < i64::from(required_level) {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::Conflict(format!(
                "requires {required_id} level {required_level}"
            )));
        }
    }

    let cost = tower_upgrade_cost(upgrade_id, from_level).ok_or_else(|| {
        ApiError::Conflict("tower upgrade is already at its maximum level".to_owned())
    })?;

    let spend = db::wallets::BitSpend {
        user_id: user.id,
        device_id: None,
        event_id: request.event_id,
        run_id,
        item_id: upgrade_id.to_owned(),
        amount: cost,
        reason: "cyber_tower_upgrade".to_owned(),
    };

    match db::wallets::spend(&mut tx, &spend).await? {
        db::wallets::SpendOutcome::Settled { balance } => {
            db::cyber_defense::increment_tower_upgrade(&mut tx, user.id, upgrade_id).await?;
            let levels = db::cyber_defense::list_tower_upgrades(&mut tx, user.id).await?;
            let aggregate = tower_level(&levels.iter().map(|row| row.level).collect::<Vec<_>>());
            tx.commit().await.map_err(db::DbError::from)?;
            Ok(CyberTowerUpgradePurchaseResponse {
                upgrade_id: upgrade_id.to_owned(),
                level: from_level + 1,
                tower_level: aggregate,
                bits_balance: balance,
                spent: cost,
                newly_settled: true,
            })
        }
        db::wallets::SpendOutcome::AlreadySettled => {
            tx.rollback().await.map_err(db::DbError::from)?;
            let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
            let levels = db::cyber_defense::list_tower_upgrades(&mut conn, user.id).await?;
            let aggregate = tower_level(&levels.iter().map(|row| row.level).collect::<Vec<_>>());
            let level = levels
                .iter()
                .find(|row| row.upgrade_id == upgrade_id)
                .map(|row| row.level)
                .unwrap_or(from_level + 1);
            Ok(CyberTowerUpgradePurchaseResponse {
                upgrade_id: upgrade_id.to_owned(),
                level,
                tower_level: aggregate,
                bits_balance: db::wallets::balance(&state.pool, user.id).await?,
                spent: cost,
                newly_settled: false,
            })
        }
        db::wallets::SpendOutcome::KeyReused => {
            tx.rollback().await.map_err(db::DbError::from)?;
            Err(ApiError::Conflict(
                "idempotency key was reused for a different purchase".to_owned(),
            ))
        }
        db::wallets::SpendOutcome::InsufficientFunds => {
            tx.rollback().await.map_err(db::DbError::from)?;
            Err(ApiError::InsufficientBits)
        }
    }
}

/// Purchases a permanent Tower theme cosmetic with Bits.
///
/// Cosmetics have no gameplay effect. The price is derived from canonical
/// policy, the wallet ledger is reused, and owning a cosmetic is idempotent: a
/// retry (or a purchase of something already owned) charges nothing.
pub async fn cyber_defense_purchase_cosmetic(
    state: &AppState,
    user: &AuthenticatedUser,
    cosmetic_id: &str,
    request: CyberCosmeticPurchaseRequest,
) -> Result<CyberCosmeticPurchaseResponse, ApiError> {
    let definition =
        cosmetic(cosmetic_id).ok_or_else(|| ApiError::BadRequest("unknown cosmetic".to_owned()))?;
    let run_id = Uuid::nil();

    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    let profile = db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    db::wallets::lock_wallet(&mut tx, user.id).await?;

    let owned = db::cyber_defense::list_cosmetic_unlocks(&mut tx, user.id).await?;
    if owned.iter().any(|id| id == definition.id) {
        tx.rollback().await.map_err(db::DbError::from)?;
        let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
        return Ok(CyberCosmeticPurchaseResponse {
            cosmetic_id: definition.id.to_owned(),
            spent: 0,
            newly_settled: false,
            state: cosmetics_state(&owned, profile.equipped_theme.as_deref(), bits_balance),
        });
    }

    let spend = db::wallets::BitSpend {
        user_id: user.id,
        device_id: None,
        event_id: request.event_id,
        run_id,
        item_id: definition.id.to_owned(),
        amount: definition.price,
        reason: "cyber_cosmetic".to_owned(),
    };

    match db::wallets::spend(&mut tx, &spend).await? {
        db::wallets::SpendOutcome::Settled { balance } => {
            db::cyber_defense::unlock_cosmetic(&mut tx, user.id, definition.id).await?;
            let owned = db::cyber_defense::list_cosmetic_unlocks(&mut tx, user.id).await?;
            tx.commit().await.map_err(db::DbError::from)?;
            Ok(CyberCosmeticPurchaseResponse {
                cosmetic_id: definition.id.to_owned(),
                spent: definition.price,
                newly_settled: true,
                state: cosmetics_state(&owned, profile.equipped_theme.as_deref(), balance),
            })
        }
        db::wallets::SpendOutcome::AlreadySettled => {
            tx.rollback().await.map_err(db::DbError::from)?;
            let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
            let owned = db::cyber_defense::list_cosmetic_unlocks(&mut conn, user.id).await?;
            let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
            Ok(CyberCosmeticPurchaseResponse {
                cosmetic_id: definition.id.to_owned(),
                spent: 0,
                newly_settled: false,
                state: cosmetics_state(&owned, profile.equipped_theme.as_deref(), bits_balance),
            })
        }
        db::wallets::SpendOutcome::KeyReused => {
            tx.rollback().await.map_err(db::DbError::from)?;
            Err(ApiError::Conflict(
                "idempotency key was reused for a different purchase".to_owned(),
            ))
        }
        db::wallets::SpendOutcome::InsufficientFunds => {
            tx.rollback().await.map_err(db::DbError::from)?;
            Err(ApiError::InsufficientBits)
        }
    }
}

/// Equips (or clears) an owned Tower theme.
///
/// Only an owned theme can be equipped; equipping has no gameplay effect and is
/// freely reversible.
pub async fn cyber_defense_equip_cosmetic(
    state: &AppState,
    user: &AuthenticatedUser,
    request: CyberCosmeticEquipRequest,
) -> Result<CyberCosmeticsStateDto, ApiError> {
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    let owned = db::cyber_defense::list_cosmetic_unlocks(&mut tx, user.id).await?;

    if let Some(theme_id) = request.theme_id.as_deref() {
        if cosmetic(theme_id).is_none() {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest("unknown cosmetic".to_owned()));
        }
        if !owned.iter().any(|id| id == theme_id) {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest(
                "that cosmetic is not owned".to_owned(),
            ));
        }
    }

    db::cyber_defense::set_equipped_theme(&mut tx, user.id, request.theme_id.as_deref()).await?;
    tx.commit().await.map_err(db::DbError::from)?;

    let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
    Ok(cosmetics_state(
        &owned,
        request.theme_id.as_deref(),
        bits_balance,
    ))
}

/// Replaces a hero's selected talents.
///
/// The selection is validated against canonical milestones: the hero must exist,
/// each milestone must be unlocked by the hero's level, and each choice must be
/// legal. Because the selection is keyed by milestone, mutually exclusive
/// choices can never both be active. Respec is free in Stage 2.
pub async fn cyber_defense_set_hero_talents(
    state: &AppState,
    user: &AuthenticatedUser,
    hero_id: &str,
    request: CyberHeroTalentRequest,
) -> Result<CyberHeroProgressDto, ApiError> {
    if !is_known_hero(hero_id) {
        return Err(ApiError::BadRequest("unknown hero".to_owned()));
    }

    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    let heroes = db::cyber_defense::list_hero_progress(&mut tx, user.id).await?;
    let xp = heroes
        .iter()
        .find(|row| row.hero_id == hero_id)
        .map(|row| row.xp)
        .unwrap_or(0);
    let level = hero_level_from_xp(xp);

    let mut normalized = serde_json::Map::new();
    for (milestone, choice) in &request.talents {
        let milestone_level: i32 = milestone
            .parse()
            .map_err(|_| ApiError::BadRequest("invalid talent milestone".to_owned()))?;
        if milestone_level > level {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::Conflict(format!(
                "milestone {milestone_level} is not unlocked"
            )));
        }
        if !is_legal_talent(hero_id, milestone_level, choice) {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest("invalid talent choice".to_owned()));
        }
        normalized.insert(milestone.clone(), serde_json::Value::String(choice.clone()));
    }

    let stored = db::cyber_defense::set_hero_talents(
        &mut tx,
        user.id,
        hero_id,
        &serde_json::Value::Object(normalized),
    )
    .await?;
    tx.commit().await.map_err(db::DbError::from)?;

    Ok(hero_dto(hero_id, stored.xp, stored.selected_talents))
}

/// Builds the compact career summary returned after a reward.
fn career_summary(xp: i64, level_up: bool) -> CyberCareerSummaryDto {
    let level = career_level_from_xp(xp);
    CyberCareerSummaryDto {
        xp,
        level,
        rank: career_rank(level).to_owned(),
        level_up,
    }
}

/// Builds the adversary transport view from a stored row.
fn adversary_dto_from_row(row: &db::cyber_defense::AdversaryProgress) -> CyberAdversaryProgressDto {
    CyberAdversaryProgressDto {
        adversary_id: row.adversary_id.clone(),
        progress: row.progress,
        rank: adversary_rank_from_progress(row.progress),
        encounters: row.encounters,
        victories: row.victories,
        highest_threat_level_cleared: row.highest_threat_level_cleared,
        dossier_flags: row.dossier_flags.clone(),
    }
}

/// Default adversary view for one never encountered.
fn empty_adversary_dto(adversary_id: &str) -> CyberAdversaryProgressDto {
    CyberAdversaryProgressDto {
        adversary_id: adversary_id.to_owned(),
        progress: 0,
        rank: 1,
        encounters: 0,
        victories: 0,
        highest_threat_level_cleared: 0,
        dossier_flags: Vec::new(),
    }
}

/// Builds the cosmetic ownership/equipped view from stored state.
fn cosmetics_state(
    owned: &[String],
    equipped: Option<&str>,
    bits_balance: i64,
) -> CyberCosmeticsStateDto {
    let cosmetics = COSMETICS
        .iter()
        .map(|definition| CyberCosmeticDto {
            cosmetic_id: definition.id.to_owned(),
            name: definition.name.to_owned(),
            description: definition.description.to_owned(),
            price: definition.price,
            owned: owned.iter().any(|id| id == definition.id),
            equipped: equipped == Some(definition.id),
        })
        .collect();
    CyberCosmeticsStateDto {
        cosmetics,
        equipped_theme: equipped.map(str::to_owned),
        bits_balance,
    }
}

/// Captures the run-start progression snapshot for one Operation.
///
/// Every run-affecting room and the selected hero's talents are read once here
/// and stored inside the immutable Operation, so later profile changes affect
/// only future runs.
async fn build_progression_snapshot(
    conn: &mut db::PgConnection,
    user_id: Uuid,
    hero_id: Option<&str>,
) -> Result<OperationProgressionSnapshot, ApiError> {
    let tower_rows = db::cyber_defense::list_tower_upgrades(conn, user_id).await?;
    let tower_by_id: HashMap<&str, i32> = tower_rows
        .iter()
        .map(|row| (row.upgrade_id.as_str(), row.level))
        .collect();
    let level_of = |id: &str| tower_by_id.get(id).copied().unwrap_or(0);
    let tower = OperationTowerSnapshot {
        soc_level: level_of("soc"),
        threat_intelligence_level: level_of("threat_intelligence"),
        training_center_level: level_of("training_center"),
        engineering_lab_level: level_of("engineering_lab"),
        resilience_center_level: level_of("resilience_center"),
    };

    let hero = match hero_id {
        Some(hero_id) => {
            let heroes = db::cyber_defense::list_hero_progress(conn, user_id).await?;
            let row = heroes.iter().find(|row| row.hero_id == hero_id);
            Some(OperationHeroSnapshot {
                hero_id: hero_id.to_owned(),
                level: hero_level_from_xp(row.map(|row| row.xp).unwrap_or(0)),
                selected_talents: row
                    .map(|row| row.selected_talents.clone())
                    .unwrap_or_else(|| serde_json::json!({})),
            })
        }
        None => None,
    };

    Ok(OperationProgressionSnapshot { hero, tower })
}

/// Builds the transport view of one stored Operation run.
fn operation_run_dto(
    run: &db::cyber_defense::OperationRun,
) -> Result<CyberOperationRunDto, ApiError> {
    let operation: GeneratedOperation = serde_json::from_value(run.generated_config.clone())
        .map_err(|error| {
            ApiError::Internal(anyhow::anyhow!(
                "stored operation config is invalid: {error}"
            ))
        })?;
    let result = run.result_stars.map(|stars| CyberOperationResultDto {
        completed: run.status == "completed",
        stars,
        health: run.result_health.unwrap_or(0),
        duration_ms: run.duration_ms.unwrap_or(0),
    });
    Ok(CyberOperationRunDto {
        run_id: run.id,
        status: run.status.clone(),
        seed: run.seed,
        template_id: run.template_id.clone(),
        adversary_id: run.adversary_id.clone(),
        adversary_name: operation.adversary_name.clone(),
        hero_id: run.hero_id.clone(),
        threat_level: run.threat_level,
        operation,
        started_at: run.started_at,
        result,
        bits_awarded: run.bits_awarded,
        career_xp_awarded: run.career_xp_awarded,
        hero_xp_awarded: run.hero_xp_awarded,
    })
}

/// Evaluates story triggers from stored progress and records any new nodes.
async fn evaluate_and_record_story(
    tx: &mut db::PgConnection,
    user_id: Uuid,
) -> Result<Vec<String>, ApiError> {
    let profile = db::cyber_defense::get_or_create_profile(tx, user_id).await?;
    let campaign = db::cyber_defense::list_campaign_results(tx, user_id).await?;
    let adversaries = db::cyber_defense::list_adversary_progress(tx, user_id).await?;
    let story = db::cyber_defense::list_story_progress(tx, user_id).await?;
    let completed_templates =
        db::cyber_defense::list_completed_operation_templates(tx, user_id).await?;

    let input = StoryProgressInput {
        completed_campaign_missions: campaign
            .iter()
            .filter(|result| result.completed)
            .map(|result| result.mission_id.clone())
            .collect(),
        total_operations_completed: profile.total_operations_completed,
        highest_threat_level_cleared: profile.highest_threat_level_cleared,
        adversary_ranks: adversaries
            .iter()
            .map(|row| {
                (
                    row.adversary_id.clone(),
                    adversary_rank_from_progress(row.progress),
                )
            })
            .collect(),
        completed_operation_templates: completed_templates,
        completed_nodes: story.iter().map(|row| row.story_node_id.clone()).collect(),
    };

    let newly = evaluate_story_nodes(&input);
    for node_id in &newly {
        db::cyber_defense::record_story_progress(tx, user_id, node_id).await?;
    }
    if !newly.is_empty() {
        let mut all = input.completed_nodes.clone();
        all.extend(newly.iter().cloned());
        db::cyber_defense::set_active_story_chapter(tx, user_id, active_chapter(&all)).await?;
    }
    Ok(newly)
}

/// Builds one offer DTO from a persisted offer row.
///
/// The preview is generated deterministically from the stored seed/template/
/// adversary/rank at the requested Threat Level, so the preview matches the run
/// the same offer would start at that level.
fn operation_offer_dto(
    offer: &db::cyber_defense::OperationOffer,
    threat_level: i32,
) -> Result<CyberOperationOfferDto, ApiError> {
    let operation = generate_operation(&OperationGenerationInput {
        seed: offer.seed,
        template_id: offer.template_id.clone(),
        adversary_id: offer.adversary_id.clone(),
        threat_level,
        adversary_rank: offer.adversary_rank,
        hero_id: None,
    })
    .map_err(|error| {
        ApiError::Internal(anyhow::anyhow!("stored offer failed to generate: {error}"))
    })?;

    let mut threat_types: Vec<String> = Vec::new();
    for wave in &operation.waves {
        for group in &wave.groups {
            if let Some(attack) = operation_attack(&group.attack_id) {
                let attack_type = attack.attack_type.to_owned();
                if !threat_types.contains(&attack_type) {
                    threat_types.push(attack_type);
                }
            }
        }
    }

    Ok(CyberOperationOfferDto {
        offer_id: offer.id,
        template_id: offer.template_id.clone(),
        title: operation.title.clone(),
        adversary_id: offer.adversary_id.clone(),
        adversary_name: operation.adversary_name.clone(),
        estimated_minutes: estimated_operation_minutes(&operation),
        map_id: operation.map_id.clone(),
        summary: operation.summary.clone(),
        threat_summary: threat_types,
        reward_preview: CyberRewardDto {
            bits: operation.reward_preview.bits,
            career_xp: operation.reward_preview.career_xp,
            hero_xp: operation.reward_preview.hero_xp,
        },
    })
}

/// Returns a stable set of Operation offers for the dashboard.
///
/// Offers are persisted and reused until they expire or are consumed, so a
/// re-render or a second tab sees the same choices. Only templates whose
/// adversary is currently unlocked can be offered, and the story confrontation
/// is never mixed into the random offer pool.
pub async fn cyber_defense_operation_offers(
    state: &AppState,
    user: &AuthenticatedUser,
    request: CyberOperationOffersRequest,
) -> Result<CyberOperationOffersResponse, ApiError> {
    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
    let profile = db::cyber_defense::get_or_create_profile(&mut conn, user.id).await?;

    let campaign_rows = db::cyber_defense::list_campaign_results(&mut conn, user.id).await?;
    let completed_campaign_missions: Vec<String> = campaign_rows
        .iter()
        .filter(|row| row.completed)
        .map(|row| row.mission_id.clone())
        .collect();
    if !campaign_complete(&completed_campaign_missions) {
        return Err(ApiError::CyberOperationsLocked);
    }

    let story_rows = db::cyber_defense::list_story_progress(&mut conn, user.id).await?;
    let completed_nodes: Vec<String> = story_rows
        .iter()
        .map(|row| row.story_node_id.clone())
        .collect();
    let available = available_adversaries(&AdversaryUnlockInput {
        campaign_complete: true,
        completed_story_nodes: completed_nodes.clone(),
    });
    let adversary_rows = db::cyber_defense::list_adversary_progress(&mut conn, user.id).await?;
    let story_input = StoryProgressInput {
        completed_campaign_missions,
        total_operations_completed: profile.total_operations_completed,
        highest_threat_level_cleared: profile.highest_threat_level_cleared,
        adversary_ranks: adversary_rows
            .iter()
            .map(|row| {
                (
                    row.adversary_id.clone(),
                    adversary_rank_from_progress(row.progress),
                )
            })
            .collect(),
        completed_operation_templates: Vec::new(),
        completed_nodes,
    };

    let preview_threat_level = request
        .requested_threat_level
        .unwrap_or(profile.recommended_threat_level)
        .clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX);

    let mut offers = db::cyber_defense::list_active_operation_offers(&mut conn, user.id).await?;
    if offers.is_empty() {
        let pool = selectable_templates(&available, true);
        if !pool.is_empty() {
            let recent_rows =
                db::cyber_defense::list_recent_operation_identities(&mut conn, user.id, 8).await?;
            let recent: Vec<RecentOperationIdentity> = recent_rows
                .iter()
                .map(|row| RecentOperationIdentity {
                    template_id: row.template_id.clone(),
                    adversary_id: row.adversary_id.clone(),
                })
                .collect();
            let seed = Uuid::new_v4().as_u128() as i64;
            let templates =
                select_operation_offer_templates(&pool, &recent, seed as u64, MAX_OPERATION_OFFERS);
            let expires_at = Utc::now() + Duration::minutes(30);
            let mut new_offers = Vec::new();
            for template in templates {
                let Some(adversary) = template
                    .adversary_ids
                    .iter()
                    .find(|adversary| available.contains(adversary))
                    .copied()
                else {
                    continue;
                };
                let adversary_rank = adversary_rows
                    .iter()
                    .find(|row| row.adversary_id == adversary)
                    .map(|row| adversary_rank_from_progress(row.progress))
                    .unwrap_or(1);
                let id = Uuid::new_v4();
                new_offers.push(db::cyber_defense::NewOperationOffer {
                    id,
                    user_id: user.id,
                    // The offer id doubles as the deterministic run seed.
                    seed: id.as_u128() as i64,
                    template_id: template.id,
                    adversary_id: adversary,
                    adversary_rank,
                    expires_at,
                });
            }
            db::cyber_defense::insert_operation_offers(&mut conn, &new_offers).await?;
            offers = db::cyber_defense::list_active_operation_offers(&mut conn, user.id).await?;
        }
    }

    // Stable display order: oldest first, tie-broken by id.
    offers.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let offers = offers
        .iter()
        .map(|offer| operation_offer_dto(offer, preview_threat_level))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(CyberOperationOffersResponse {
        offers,
        confrontation_available: confrontation_available(&story_input),
        preview_threat_level,
    })
}

/// Starts one repeatable Operation for the authenticated learner.
///
/// The server selects the template/adversary, generates a secure seed, produces
/// a deterministic Operation, and persists the whole snapshot so a refresh
/// restores the exact same run. A learner can have only one active run.
pub async fn cyber_defense_start_operation(
    state: &AppState,
    user: &AuthenticatedUser,
    request: CyberOperationStartRequest,
) -> Result<CyberOperationRunDto, ApiError> {
    // One transaction covers the whole start, so a consumed offer is rolled
    // back (released) if the run cannot be persisted. A dropped offer would
    // otherwise silently remove a player's choice.
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    let profile = db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;

    let unlocked = unlocked_threat_level(
        profile.recommended_threat_level,
        profile.highest_threat_level_cleared,
    );
    if !(THREAT_LEVEL_MIN..=THREAT_LEVEL_MAX).contains(&request.requested_threat_level)
        || request.requested_threat_level > unlocked
    {
        return Err(ApiError::BadRequest(
            "threat level is not unlocked".to_owned(),
        ));
    }

    let hero_id = match request.hero_id.as_deref() {
        Some(hero) if !hero.is_empty() => {
            if !is_known_hero(hero) {
                return Err(ApiError::BadRequest("unknown hero".to_owned()));
            }
            Some(hero.to_owned())
        }
        _ => Some(adaptive_learn_domain::DEFAULT_HERO_IDS[0].to_owned()),
    };

    // Operations are gated on the campaign boss. The UI also hides them, but the
    // server is authoritative: a client claim is never trusted.
    let campaign_rows = db::cyber_defense::list_campaign_results(&mut tx, user.id).await?;
    let completed_campaign_missions: Vec<String> = campaign_rows
        .iter()
        .filter(|row| row.completed)
        .map(|row| row.mission_id.clone())
        .collect();
    if !campaign_complete(&completed_campaign_missions) {
        return Err(ApiError::CyberOperationsLocked);
    }

    if let Some(active) = db::cyber_defense::find_active_operation_run(&mut tx, user.id).await? {
        return Err(ApiError::ActiveOperationExists(active.id));
    }

    // Adversary availability is story-driven. Adversaries never appear before
    // their introduction milestone, and the template pool always keeps at least
    // one selectable template once Operations are unlocked.
    let adversary_rows = db::cyber_defense::list_adversary_progress(&mut tx, user.id).await?;
    let story_rows = db::cyber_defense::list_story_progress(&mut tx, user.id).await?;
    let completed_nodes: Vec<String> = story_rows
        .iter()
        .map(|row| row.story_node_id.clone())
        .collect();
    let available = available_adversaries(&AdversaryUnlockInput {
        campaign_complete: true,
        completed_story_nodes: completed_nodes.clone(),
    });
    let story_input = StoryProgressInput {
        completed_campaign_missions: completed_campaign_missions.clone(),
        total_operations_completed: profile.total_operations_completed,
        highest_threat_level_cleared: profile.highest_threat_level_cleared,
        adversary_ranks: adversary_rows
            .iter()
            .map(|row| {
                (
                    row.adversary_id.clone(),
                    adversary_rank_from_progress(row.progress),
                )
            })
            .collect(),
        completed_operation_templates: Vec::new(),
        completed_nodes,
    };

    let rank_of = |adversary: &str| {
        adversary_rows
            .iter()
            .find(|row| row.adversary_id == adversary)
            .map(|row| adversary_rank_from_progress(row.progress))
            .unwrap_or(1)
    };

    // Template/adversary selection is server-side and immutable per run. When an
    // offer id is supplied, the server starts exactly that offered
    // template/adversary; a client cannot forge an offer for locked content.
    // Only the story confrontation may be pinned by template id.
    let operation = if let Some(offer_id) = request.offer_id {
        let offer = db::cyber_defense::consume_operation_offer(&mut tx, user.id, offer_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest("that Operation offer is no longer valid".to_owned())
            })?;
        if !available.contains(&offer.adversary_id.as_str()) {
            return Err(ApiError::CyberOperationLocked);
        }
        generate_operation(&OperationGenerationInput {
            seed: offer.seed,
            template_id: offer.template_id,
            adversary_id: offer.adversary_id,
            threat_level: request.requested_threat_level,
            adversary_rank: offer.adversary_rank,
            hero_id: hero_id.clone(),
        })
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    } else if let Some(template_id) = request.template_id.as_deref() {
        if template_id != CONFRONTATION_TEMPLATE_ID {
            return Err(ApiError::BadRequest(
                "start ordinary Operations from an offer".to_owned(),
            ));
        }
        if !confrontation_available(&story_input) {
            return Err(ApiError::CyberOperationLocked);
        }
        let template = operation_template(CONFRONTATION_TEMPLATE_ID)
            .ok_or_else(|| ApiError::BadRequest("unknown operation template".to_owned()))?;
        let adversary = template
            .adversary_ids
            .iter()
            .find(|adversary| available.contains(adversary))
            .copied()
            .ok_or_else(|| ApiError::Conflict("no adversary is available".to_owned()))?;
        let seed = Uuid::new_v4().as_u128() as i64;
        generate_operation(&OperationGenerationInput {
            seed,
            template_id: template.id.to_owned(),
            adversary_id: adversary.to_owned(),
            threat_level: request.requested_threat_level,
            adversary_rank: rank_of(adversary),
            hero_id: hero_id.clone(),
        })
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    } else {
        // Backward-compatible random selection with anti-repetition: never the
        // last two templates when alternatives exist, and never the immediately
        // preceding template when possible. The confrontation is never random.
        let pool = selectable_templates(&available, true);
        if pool.is_empty() {
            return Err(ApiError::Conflict(
                "no repeatable operations are available".to_owned(),
            ));
        }
        let recent_rows =
            db::cyber_defense::list_recent_operation_identities(&mut tx, user.id, 8).await?;
        let recent: Vec<RecentOperationIdentity> = recent_rows
            .iter()
            .map(|row| RecentOperationIdentity {
                template_id: row.template_id.clone(),
                adversary_id: row.adversary_id.clone(),
            })
            .collect();
        let seed = Uuid::new_v4().as_u128() as i64;
        let template = select_operation_template(&pool, &recent, seed as u64)
            .ok_or_else(|| ApiError::Conflict("no adversary is available".to_owned()))?;
        let adversary = template
            .adversary_ids
            .iter()
            .find(|adversary| available.contains(adversary))
            .copied()
            .ok_or_else(|| ApiError::Conflict("no adversary is available".to_owned()))?;
        generate_operation(&OperationGenerationInput {
            seed,
            template_id: template.id.to_owned(),
            adversary_id: adversary.to_owned(),
            threat_level: request.requested_threat_level,
            adversary_rank: rank_of(adversary),
            hero_id: hero_id.clone(),
        })
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    };

    // Freeze run-start progression into the immutable Operation snapshot.
    let mut operation = operation;
    operation.progression_snapshot =
        build_progression_snapshot(&mut tx, user.id, hero_id.as_deref()).await?;

    let config =
        serde_json::to_value(&operation).map_err(|error| ApiError::Internal(error.into()))?;
    let new_run = db::cyber_defense::NewOperationRun {
        id: Uuid::new_v4(),
        user_id: user.id,
        seed: operation.seed,
        template_id: operation.template_id.as_str(),
        adversary_id: operation.adversary_id.as_str(),
        hero_id: hero_id.as_deref(),
        threat_level: operation.threat_level,
        generated_config: &config,
    };

    let run = match db::cyber_defense::create_operation_run(&mut tx, &new_run).await {
        Ok(run) => run,
        Err(error) if error.is_unique_violation() => {
            // Roll back so a consumed offer is released, then report the
            // blocking active run from a fresh connection.
            tx.rollback().await.map_err(db::DbError::from)?;
            let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
            return match db::cyber_defense::find_active_operation_run(&mut conn, user.id).await? {
                Some(active) => Err(ApiError::ActiveOperationExists(active.id)),
                None => Err(ApiError::Conflict("could not start operation".to_owned())),
            };
        }
        Err(error) => return Err(error.into()),
    };

    tx.commit().await.map_err(db::DbError::from)?;
    operation_run_dto(&run)
}

/// Reads one Operation run owned by the authenticated learner.
pub async fn cyber_defense_get_operation(
    state: &AppState,
    user: &AuthenticatedUser,
    run_id: Uuid,
) -> Result<CyberOperationRunDto, ApiError> {
    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
    let run = db::cyber_defense::get_operation_run_for_user(&mut conn, user.id, run_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    operation_run_dto(&run)
}

/// Applies Engineering Lab defense substitutions to an active Operation.
///
/// The allowance comes from the learner's Engineering Lab level, never from the
/// request. Each swap must name a currently offered control and a canonical
/// defense that is not already offered; the resulting loadout is re-validated
/// against the generation invariants so a swap can never remove the only viable
/// counter and create an impossible run. The player may always keep the default
/// loadout by sending no swaps.
pub async fn cyber_defense_set_operation_loadout(
    state: &AppState,
    user: &AuthenticatedUser,
    run_id: Uuid,
    request: CyberOperationLoadoutRequest,
) -> Result<CyberOperationRunDto, ApiError> {
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    let run = db::cyber_defense::lock_operation_run(&mut tx, user.id, run_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if run.status != "active" {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::Conflict("operation is not active".to_owned()));
    }

    let mut operation: GeneratedOperation = serde_json::from_value(run.generated_config.clone())
        .map_err(|error| {
            ApiError::Internal(anyhow::anyhow!(
                "stored operation config is invalid: {error}"
            ))
        })?;

    // The allowance is frozen at run creation: upgrading the Engineering Lab
    // after a run starts must not widen that run's substitutions.
    let lab_level = operation.progression_snapshot.tower.engineering_lab_level;
    let allowance = if lab_level >= 2 {
        2
    } else if lab_level >= 1 {
        1
    } else {
        0
    };
    if allowance == 0 {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::BadRequest(
            "the Engineering Lab is not upgraded".to_owned(),
        ));
    }
    if request.defense_swaps.len() > allowance {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::BadRequest(format!(
            "at most {allowance} substitutions are allowed"
        )));
    }

    let mut available = operation.available_defenses.clone();
    for swap in &request.defense_swaps {
        if operation_defense(&swap.add).is_none() {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest(format!(
                "unknown defense: {}",
                swap.add
            )));
        }
        let Some(index) = available.iter().position(|id| *id == swap.remove) else {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest(format!(
                "{} is not offered in this operation",
                swap.remove
            )));
        };
        if available.contains(&swap.add) {
            tx.rollback().await.map_err(db::DbError::from)?;
            return Err(ApiError::BadRequest(format!(
                "{} is already offered",
                swap.add
            )));
        }
        available[index] = swap.add.clone();
    }
    available.sort();
    available.dedup();
    operation.available_defenses = available;

    validate_generated_operation(&operation).map_err(|error| {
        ApiError::BadRequest(format!("that loadout would be unsolvable: {error}"))
    })?;

    let config =
        serde_json::to_value(&operation).map_err(|error| ApiError::Internal(error.into()))?;
    let updated = db::cyber_defense::update_operation_run_config(&mut tx, user.id, run_id, &config)
        .await?
        .ok_or_else(|| ApiError::Conflict("operation is no longer active".to_owned()))?;
    tx.commit().await.map_err(db::DbError::from)?;
    operation_run_dto(&updated)
}

/// Abandons an active Operation run. Abandoning grants no reward.
pub async fn cyber_defense_abandon_operation(
    state: &AppState,
    user: &AuthenticatedUser,
    run_id: Uuid,
) -> Result<CyberOperationRunDto, ApiError> {
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    let abandoned = db::cyber_defense::abandon_operation_run(&mut tx, user.id, run_id).await?;
    if !abandoned {
        let existing =
            db::cyber_defense::get_operation_run_for_user(&mut tx, user.id, run_id).await?;
        tx.rollback().await.map_err(db::DbError::from)?;
        return match existing {
            None => Err(ApiError::NotFound),
            Some(_) => Err(ApiError::Conflict("operation is not active".to_owned())),
        };
    }
    let run = db::cyber_defense::get_operation_run_for_user(&mut tx, user.id, run_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    tx.commit().await.map_err(db::DbError::from)?;
    operation_run_dto(&run)
}

/// Builds the response for an Operation that was already settled.
async fn duplicate_operation_response(
    state: &AppState,
    user: &AuthenticatedUser,
    run: &db::cyber_defense::OperationRun,
    profile: &db::cyber_defense::CyberDefenseProfile,
) -> Result<CyberOperationCompleteResponse, ApiError> {
    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
    let adversary = db::cyber_defense::list_adversary_progress(&mut conn, user.id)
        .await?
        .iter()
        .find(|row| row.adversary_id == run.adversary_id)
        .map(adversary_dto_from_row)
        .unwrap_or_else(|| empty_adversary_dto(&run.adversary_id));
    let hero = match run.hero_id.as_deref() {
        Some(hero_id) => db::cyber_defense::list_hero_progress(&mut conn, user.id)
            .await?
            .iter()
            .find(|row| row.hero_id == hero_id)
            .map(|row| hero_dto(hero_id, row.xp, row.selected_talents.clone())),
        None => None,
    };

    Ok(CyberOperationCompleteResponse {
        run: operation_run_dto(run)?,
        reward: CyberRewardDto {
            bits: 0,
            career_xp: 0,
            hero_xp: 0,
        },
        bits_balance: db::wallets::balance(&state.pool, user.id).await?,
        career: career_summary(profile.career_xp, false),
        hero,
        adversary,
        newly_settled: false,
        recommended_threat_level: profile.recommended_threat_level,
        unlocked_threat_level: unlocked_threat_level(
            profile.recommended_threat_level,
            profile.highest_threat_level_cleared,
        ),
        dossier_unlocks: Vec::new(),
        story_nodes_completed: Vec::new(),
    })
}

/// Settles one Operation run's result and permanent rewards exactly once.
pub async fn cyber_defense_complete_operation(
    state: &AppState,
    user: &AuthenticatedUser,
    run_id: Uuid,
    request: CyberOperationCompleteRequest,
) -> Result<CyberOperationCompleteResponse, ApiError> {
    if !(0..=3).contains(&request.stars) {
        return Err(ApiError::BadRequest(
            "stars must be between 0 and 3".to_owned(),
        ));
    }
    if !(0..=CYBER_MAX_HEALTH).contains(&request.health) {
        return Err(ApiError::BadRequest("invalid health".to_owned()));
    }
    if !(CYBER_MIN_DURATION_MS..=CYBER_MAX_DURATION_MS).contains(&request.duration_ms) {
        return Err(ApiError::BadRequest("implausible duration".to_owned()));
    }
    if request.completed && request.stars == 0 {
        return Err(ApiError::BadRequest(
            "a completed operation needs at least one star".to_owned(),
        ));
    }
    if !request.completed && request.stars != 0 {
        return Err(ApiError::BadRequest(
            "a failed operation cannot earn stars".to_owned(),
        ));
    }

    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    let profile = db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;
    let run = db::cyber_defense::lock_operation_run(&mut tx, user.id, run_id)
        .await?
        .ok_or(ApiError::NotFound)?;

    if run.status != "active" {
        tx.rollback().await.map_err(db::DbError::from)?;
        return duplicate_operation_response(state, user, &run, &profile).await;
    }

    // Integrity guard: the browser simulation is never replayed server-side, so
    // reject results that are impossible for the run's server age, and cap
    // reward-bearing settlement frequency. Neither check blocks normal play.
    let server_elapsed_ms = (Utc::now() - run.started_at).num_milliseconds().max(0);
    if !operation_result_is_plausible(server_elapsed_ms, request.duration_ms) {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::BadRequest(
            "result is not plausible for this run".to_owned(),
        ));
    }
    let window_start = Utc::now() - Duration::minutes(OPERATION_RATE_WINDOW_MINUTES);
    let settled =
        db::cyber_defense::count_settled_operations_since(&mut tx, user.id, window_start).await?;
    if settled >= OPERATION_RATE_MAX_SETTLED {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Err(ApiError::Conflict(
            "too many operations settled recently; try again later".to_owned(),
        ));
    }

    let operation: GeneratedOperation = serde_json::from_value(run.generated_config.clone())
        .map_err(|error| {
            ApiError::Internal(anyhow::anyhow!(
                "stored operation config is invalid: {error}"
            ))
        })?;

    let completed = request.completed;
    let stars = request.stars;

    let adversary_rows = db::cyber_defense::list_adversary_progress(&mut tx, user.id).await?;
    let existing = adversary_rows
        .iter()
        .find(|row| row.adversary_id == run.adversary_id);
    let prior_victories = existing.map(|row| row.victories).unwrap_or(0);
    let prior_flags = existing
        .map(|row| row.dossier_flags.clone())
        .unwrap_or_default();
    let first_adversary_clear = completed && prior_victories == 0;
    let first_boss_clear = completed && operation.boss && prior_victories == 0;

    let reward = operation_reward(run.threat_level, stars, completed, first_adversary_clear);
    // The Training Center bonus uses the level frozen at run creation, so
    // upgrading the room mid-run affects only future Operations.
    let hero_xp = if run.hero_id.is_some() {
        scale_xp(
            reward.hero_xp,
            training_center_hero_xp_multiplier(
                operation.progression_snapshot.tower.training_center_level,
            ),
        )
    } else {
        0
    };

    db::wallets::lock_wallet(&mut tx, user.id).await?;
    let reward_event_id = Uuid::new_v4();
    if reward.bits > 0 {
        let transaction = db::wallets::BitTransaction {
            user_id: user.id,
            device_id: None,
            event_id: reward_event_id,
            mission_instance_id: run.id,
            question_id: run.template_id.clone(),
            amount: reward.bits,
            reason: "cyber_operation_reward".to_owned(),
        };
        db::wallets::settle(&mut tx, &transaction).await?;
    }

    let career_xp =
        db::cyber_defense::increment_career_xp(&mut tx, user.id, reward.career_xp).await?;
    if let Some(hero) = run.hero_id.as_deref() {
        db::cyber_defense::increment_hero_xp(&mut tx, user.id, hero, hero_xp).await?;
    }

    let progress_delta = adversary_progress_award(
        run.threat_level,
        completed,
        operation.boss,
        first_boss_clear,
    );
    let highest_cleared = if completed { run.threat_level } else { 0 };
    let adversary_row = db::cyber_defense::apply_adversary_encounter(
        &mut tx,
        user.id,
        &run.adversary_id,
        progress_delta,
        true,
        completed,
        highest_cleared,
    )
    .await?;
    let rank = adversary_rank_from_progress(adversary_row.progress);

    let mut flags: Vec<String> = Vec::new();
    match operation.dominant_attack_type.as_str() {
        "credential_stuffing" => flags.push("identity_specialist".to_owned()),
        "sql_injection" | "xss" => flags.push("web_specialist".to_owned()),
        "ransomware" => flags.push("impact_specialist".to_owned()),
        _ => {}
    }
    if operation.modifiers.iter().any(|m| m.id == "hidden_traffic") {
        flags.push("uses_hidden_traffic".to_owned());
    }
    if operation
        .modifiers
        .iter()
        .any(|m| m.id == "credential_surge")
    {
        flags.push("credential_surge_observed".to_owned());
    }
    if operation.boss && completed {
        flags.push("boss_pattern_seen".to_owned());
    }
    if completed && run.threat_level >= 5 {
        flags.push("highest_threat_5".to_owned());
    }
    if rank >= 3 {
        flags.push("rank_3_story_clue".to_owned());
    }
    let dossier_unlocks: Vec<String> = flags
        .iter()
        .filter(|flag| !prior_flags.contains(flag))
        .cloned()
        .collect();
    db::cyber_defense::add_dossier_flags(&mut tx, user.id, &run.adversary_id, &flags).await?;

    let update = db::cyber_defense::OperationResultUpdate {
        completed,
        stars,
        health: request.health,
        duration_ms: request.duration_ms,
        bits: reward.bits,
        career_xp: reward.career_xp,
        hero_xp,
        reward_event_id,
    };
    let run = db::cyber_defense::complete_operation_run(&mut tx, user.id, run_id, &update)
        .await?
        .ok_or_else(|| ApiError::Conflict("operation is no longer active".to_owned()))?;

    // Recommended Threat Level uses the last five settled results, including
    // this one, and never changes difficulty during a run.
    let new_highest = profile.highest_threat_level_cleared.max(highest_cleared);
    let recent = db::cyber_defense::list_recent_operation_outcomes(&mut tx, user.id, 5).await?;
    let recent_outcomes: Vec<OperationOutcome> = recent
        .iter()
        .map(|row| OperationOutcome {
            completed: row.completed,
            stars: row.stars,
            remaining_health_ratio: if row.starting_health > 0 {
                f64::from(row.health) / f64::from(row.starting_health)
            } else {
                0.0
            },
        })
        .collect();
    let recommended = recommend_threat_level(&ThreatRecommendationInput {
        current: profile.recommended_threat_level,
        recent: recent_outcomes,
        health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
    });
    db::cyber_defense::update_threat_progress(
        &mut tx,
        user.id,
        new_highest,
        recommended,
        if completed { 1 } else { 0 },
    )
    .await?;

    let story_nodes_completed = evaluate_and_record_story(&mut tx, user.id).await?;

    tx.commit().await.map_err(db::DbError::from)?;

    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
    let bits_balance = db::wallets::balance(&state.pool, user.id).await?;
    let hero = match run.hero_id.as_deref() {
        Some(hero_id) => db::cyber_defense::list_hero_progress(&mut conn, user.id)
            .await?
            .iter()
            .find(|row| row.hero_id == hero_id)
            .map(|row| hero_dto(hero_id, row.xp, row.selected_talents.clone())),
        None => None,
    };
    let adversary = db::cyber_defense::list_adversary_progress(&mut conn, user.id)
        .await?
        .iter()
        .find(|row| row.adversary_id == run.adversary_id)
        .map(adversary_dto_from_row)
        .unwrap_or_else(|| empty_adversary_dto(&run.adversary_id));
    let unlocked = unlocked_threat_level(recommended, new_highest);

    Ok(CyberOperationCompleteResponse {
        run: operation_run_dto(&run)?,
        reward: CyberRewardDto {
            bits: reward.bits,
            career_xp: reward.career_xp,
            hero_xp,
        },
        bits_balance,
        career: career_summary(
            career_xp,
            career_level_from_xp(career_xp) > career_level_from_xp(profile.career_xp),
        ),
        hero,
        adversary,
        newly_settled: true,
        recommended_threat_level: recommended,
        unlocked_threat_level: unlocked,
        dossier_unlocks,
        story_nodes_completed,
    })
}

/// Imports legacy Stage 1 local campaign progress exactly once.
///
/// Local progress is untrusted: only completion state, best stars, best health,
/// and attempts are imported. No retroactive Bits or arbitrary XP are granted
/// from client-local values. A single fixed returning-defender career XP amount
/// is granted when at least one valid mission was previously completed.
pub async fn cyber_defense_import_legacy(
    state: &AppState,
    user: &AuthenticatedUser,
    request: CyberLegacyImportRequest,
) -> Result<CyberLegacyImportResponse, ApiError> {
    let mut tx = state.pool.begin().await.map_err(db::DbError::from)?;
    let profile = db::cyber_defense::get_or_create_profile(&mut tx, user.id).await?;

    if profile.legacy_progress_imported {
        tx.rollback().await.map_err(db::DbError::from)?;
        return Ok(CyberLegacyImportResponse {
            imported: false,
            missions_imported: 0,
            career_xp_granted: 0,
            bits_balance: db::wallets::balance(&state.pool, user.id).await?,
            career: career_summary(profile.career_xp, false),
        });
    }

    // Only a contiguous prefix of the canonical campaign order is imported.
    // Local progress is untrusted, so a client cannot claim the boss (or skip
    // missions) to unlock Operations or claim campaign rewards out of order.
    // Imported completions are also marked reward-settled so they can never
    // claim a first-clear reward later.
    let existing = db::cyber_defense::list_campaign_results(&mut tx, user.id).await?;
    let completed_in_db = |mission_id: &str| {
        existing
            .iter()
            .any(|row| row.mission_id == mission_id && row.completed)
    };

    let mut missions_imported = 0i32;
    let mut any_completed = false;
    let mut prefix_open = true;
    for mission_id in CAMPAIGN_ORDER {
        if !prefix_open {
            break;
        }
        let already_completed = completed_in_db(mission_id);
        match request.missions.get(*mission_id) {
            Some(mission) => {
                let stars = mission.stars.clamp(0, 3);
                let health = mission.best_health.clamp(0, CYBER_MAX_HEALTH);
                let attempts = mission.attempts.clamp(0, 10_000);
                let completed = mission.completed && stars > 0;
                any_completed |= completed;
                db::cyber_defense::import_campaign_result(
                    &mut tx, user.id, mission_id, completed, stars, health, attempts,
                )
                .await?;
                missions_imported += 1;
                if !completed && !already_completed {
                    prefix_open = false;
                }
            }
            None => {
                if !already_completed {
                    prefix_open = false;
                }
            }
        }
    }

    let imported = db::cyber_defense::mark_legacy_progress_imported(&mut tx, user.id).await?;
    let mut career_xp_granted = 0;
    if imported && any_completed {
        career_xp_granted = LEGACY_RETURNING_DEFENDER_XP;
        db::cyber_defense::increment_career_xp(&mut tx, user.id, career_xp_granted).await?;
    }

    evaluate_and_record_story(&mut tx, user.id).await?;
    tx.commit().await.map_err(db::DbError::from)?;

    let career_xp = profile.career_xp + career_xp_granted;
    Ok(CyberLegacyImportResponse {
        imported,
        missions_imported,
        career_xp_granted,
        bits_balance: db::wallets::balance(&state.pool, user.id).await?,
        career: career_summary(
            career_xp,
            career_level_from_xp(career_xp) > career_level_from_xp(profile.career_xp),
        ),
    })
}

/// Known balance-telemetry event names.
const CYBER_TELEMETRY_EVENTS: &[&str] = &[
    "cyber_dashboard_view",
    "cyber_operation_offered",
    "cyber_operation_started",
    "cyber_operation_resumed",
    "cyber_operation_completed",
    "cyber_operation_failed",
    "cyber_operation_abandoned",
    "cyber_threat_level_selected",
    "cyber_defense_placed",
    "cyber_defense_upgraded",
    "cyber_defense_removed",
    "cyber_hero_selected",
    "cyber_hero_deployed",
    "cyber_tower_upgrade_purchased",
    "cyber_hero_level_up",
    "cyber_hero_talent_selected",
    "cyber_adversary_rank_up",
    "cyber_dossier_unlock",
    "cyber_story_seen",
];

/// Maximum events accepted in one telemetry batch.
const CYBER_TELEMETRY_MAX_BATCH: usize = 50;
/// Maximum length of a telemetry text dimension.
const CYBER_TELEMETRY_MAX_TEXT: usize = 64;

/// Appends a batch of balance-telemetry events.
///
/// Only game identifiers and results are accepted, and unknown event names are
/// rejected so the stream stays analyzable. No raw personal data is stored.
pub async fn cyber_defense_telemetry(
    state: &AppState,
    user: &AuthenticatedUser,
    request: CyberTelemetryRequest,
) -> Result<CyberTelemetryResponse, ApiError> {
    if request.events.len() > CYBER_TELEMETRY_MAX_BATCH {
        return Err(ApiError::BadRequest(
            "telemetry batch is too large".to_owned(),
        ));
    }

    for event in &request.events {
        if !CYBER_TELEMETRY_EVENTS.contains(&event.name.as_str()) {
            return Err(ApiError::BadRequest("unknown telemetry event".to_owned()));
        }
        if event.stars.is_some_and(|stars| !(0..=3).contains(&stars)) {
            return Err(ApiError::BadRequest("invalid telemetry stars".to_owned()));
        }
        if event
            .threat_level
            .is_some_and(|threat| !(THREAT_LEVEL_MIN..=THREAT_LEVEL_MAX).contains(&threat))
        {
            return Err(ApiError::BadRequest(
                "invalid telemetry threat level".to_owned(),
            ));
        }
        if event.wave.is_some_and(|wave| !(0..=100).contains(&wave)) {
            return Err(ApiError::BadRequest("invalid telemetry wave".to_owned()));
        }
        let text_values = [
            event.template_id.as_deref(),
            event.adversary_id.as_deref(),
            event.hero_id.as_deref(),
            event.defense_id.as_deref(),
            event.result.as_deref(),
            event.duration_bucket.as_deref(),
        ];
        for value in text_values.into_iter().flatten() {
            if value.len() > CYBER_TELEMETRY_MAX_TEXT {
                return Err(ApiError::BadRequest(
                    "telemetry value is too long".to_owned(),
                ));
            }
        }
    }

    let mut conn = state.pool.acquire().await.map_err(db::DbError::from)?;
    let events: Vec<db::cyber_defense::NewTelemetryEvent<'_>> = request
        .events
        .iter()
        .map(|event| db::cyber_defense::NewTelemetryEvent {
            event_name: event.name.as_str(),
            run_id: event.run_id,
            template_id: event.template_id.as_deref(),
            adversary_id: event.adversary_id.as_deref(),
            threat_level: event.threat_level,
            hero_id: event.hero_id.as_deref(),
            defense_id: event.defense_id.as_deref(),
            wave: event.wave,
            result: event.result.as_deref(),
            stars: event.stars,
            duration_bucket: event.duration_bucket.as_deref(),
        })
        .collect();
    db::cyber_defense::insert_telemetry_events(&mut conn, user.id, &events).await?;

    Ok(CyberTelemetryResponse {
        accepted: i32::try_from(events.len()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn practice_test_score_note_is_vendor_neutral() {
        // Practice tests exist for both AWS and Microsoft certifications, so the
        // note must not name a single vendor's scoring scale.
        assert!(!PRACTICE_TEST_SCORE_NOTE.contains("AWS"));
        assert!(PRACTICE_TEST_SCORE_NOTE.contains("not"));
    }

    #[tokio::test]
    async fn recommendation_logging_failure_is_swallowed() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let concept_ids = vec!["c1".to_owned()];
        let entry = db::recommendations::RecommendationLogEntry {
            recommendation_id: Uuid::new_v4(),
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

    #[tokio::test]
    async fn recommendation_event_telemetry_failure_is_swallowed() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let entry = db::recommendations::RecommendationEventEntry {
            event_id: Uuid::new_v4(),
            recommendation_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            track_id: "track",
            event: "shown",
            action: Some("learn_node"),
            domain_id: Some("d1"),
            node_id: Some("n1"),
            question_id: None,
        };

        // Unreachable database: the helper reports failure without panicking or
        // propagating, so the caller can continue normally.
        let response = record_event_best_effort(&pool, &entry).await;
        assert!(!response.recorded);
    }

    #[tokio::test]
    async fn study_session_logging_failure_is_swallowed() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let entry = db::sessions::StudySessionLogEntry {
            session_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            track_id: "track",
            track_version: "track-v1",
            available_minutes: 20,
            preference: "balanced",
            estimated_minutes: 18,
            activity_count: 4,
        };

        // Auxiliary persistence must never panic or propagate.
        log_study_session(&pool, &entry).await;
    }

    #[tokio::test]
    async fn prediction_logging_failure_is_swallowed() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );
        let user = AuthenticatedUser {
            id: Uuid::new_v4(),
            auth_subject: "test".to_owned(),
            email: None,
        };
        let now = Utc::now();
        let mission = MissionInstance {
            id: Uuid::new_v4(),
            user_id: Some(user.id),
            device_id: Uuid::new_v4(),
            certification_id: "aws-soa-c03".to_owned(),
            certification_version: "soa-c03".to_owned(),
            content_version: "soa-c03-content-v1".to_owned(),
            mode: QuizMode::TaskPractice,
            recommendation_id: None,
            daily_mission_id: None,
            daily_item_position: None,
            domain_id: Some("domain-1".to_owned()),
            task_id: Some("1.1".to_owned()),
            module_id: None,
            question_ids: vec!["monitoring-classification-001".to_owned()],
            status: MissionStatus::Issued,
            issued_at: now,
            expires_at: now + Duration::minutes(60),
            completed_at: None,
        };

        // Unreachable database: prediction measurement must never panic or
        // propagate into mission issuance.
        log_predictions_best_effort(&state, Some(&user), &mission, "task_practice", false).await;
        record_prediction_outcome_best_effort(
            &state,
            &mission,
            "monitoring-classification-001",
            Uuid::new_v4(),
            1,
            1.0,
            now,
        )
        .await;
    }

    #[tokio::test]
    async fn discovery_persistence_failure_is_swallowed() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );
        let user = AuthenticatedUser {
            id: Uuid::new_v4(),
            auth_subject: "test".to_owned(),
            email: None,
        };

        // A valid, known domain against an unreachable database: the helper
        // reports failure without panicking or propagating.
        let update = DiscoveryUpdateRequest {
            track_version: "soa-c03".to_owned(),
            content_version: "soa-c03-content-v1".to_owned(),
            domains: vec![DomainDiscoveryInput {
                domain_id: "domain-1".to_owned(),
                revealed_prompt_ids: BTreeMap::from([("n1".to_owned(), vec!["p1".to_owned()])]),
                revealed_element_ids: BTreeMap::new(),
            }],
        };
        let result =
            persist_discovery_best_effort(&state, Some(&user), std::slice::from_ref(&update)).await;
        assert!(!result.accepted);

        // An unknown domain is dropped before any database work, so it cannot
        // accumulate arbitrary rows and is not reported as a failure.
        let unknown = DiscoveryUpdateRequest {
            track_version: "soa-c03".to_owned(),
            content_version: "soa-c03-content-v1".to_owned(),
            domains: vec![DomainDiscoveryInput {
                domain_id: "does-not-exist".to_owned(),
                revealed_prompt_ids: BTreeMap::from([("n1".to_owned(), vec!["p1".to_owned()])]),
                revealed_element_ids: BTreeMap::new(),
            }],
        };
        let result = persist_discovery_best_effort(&state, Some(&user), &[unknown]).await;
        assert!(result.accepted);
    }

    #[tokio::test]
    async fn study_day_persistence_failure_is_swallowed() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );

        // Unreachable database: recording a study day must never panic or
        // propagate, so a streak problem can never fail answer acceptance.
        record_study_day_best_effort(&state, Uuid::new_v4(), Some("UTC")).await;
    }

    fn concept_weight(concept_id: &str) -> ConceptWeight {
        ConceptWeight {
            concept_id: concept_id.to_owned(),
            weight: 1.0,
        }
    }

    fn state_view(
        concept_id: &str,
        mode: adaptive_learn_domain::AssessmentMode,
        estimate: f64,
        mass: f64,
        last: Option<DateTime<Utc>>,
    ) -> ConceptStateView {
        ConceptStateView {
            concept_id: concept_id.to_owned(),
            assessment_mode: mode,
            estimate,
            evidence_mass: mass,
            exposure_count: 1,
            last_practiced_at: last,
        }
    }

    fn planner_question(
        id: &str,
        mode: adaptive_learn_domain::AssessmentMode,
        concept_ids: &[&str],
    ) -> PlannerQuestion {
        PlannerQuestion {
            id: id.to_owned(),
            domain_id: "d1".to_owned(),
            task_id: "t1".to_owned(),
            interaction_type: adaptive_learn_domain::InteractionType::Ordering,
            assessment_mode: mode,
            difficulty_prior: 0.5,
            concepts: concept_ids.iter().map(|id| concept_weight(id)).collect(),
            pedagogy: None,
        }
    }

    fn planner_context(
        states: Vec<ConceptStateView>,
        questions: Vec<PlannerQuestion>,
        recent: HashSet<String>,
    ) -> PlannerContext {
        PlannerContext {
            track_version: "v1".to_owned(),
            input: PlannerInput {
                track_id: "track".to_owned(),
                track_version: "v1".to_owned(),
                now: Utc::now(),
                states,
                domains: vec![PlannerDomain {
                    id: "d1".to_owned(),
                    name: "D1".to_owned(),
                    weight: 1.0,
                }],
                nodes: Vec::new(),
                questions,
                explored_node_ids: HashSet::new(),
                unlocked_node_ids: HashSet::new(),
                completed_module_ids: HashSet::new(),
                recent_question_ids: recent,
                recent_pedagogy: RecentPedagogy::default(),
                remediation: None,
            },
            history: Vec::new(),
        }
    }

    #[test]
    fn delayed_retrieval_prefers_the_most_stale_concept() {
        use adaptive_learn_domain::AssessmentMode;
        let now = Utc::now();
        let context = planner_context(
            vec![
                state_view("c-fresh", AssessmentMode::Recall, 0.9, 6.0, Some(now)),
                state_view(
                    "c-stale",
                    AssessmentMode::Recall,
                    0.3,
                    3.0,
                    Some(now - Duration::days(20)),
                ),
            ],
            vec![
                planner_question("q-fresh", AssessmentMode::Recall, &["c-fresh"]),
                planner_question("q-stale", AssessmentMode::Recall, &["c-stale"]),
            ],
            HashSet::new(),
        );

        let item = delayed_retrieval_item(&context, &[], now).expect("delayed item");
        assert_eq!(item.kind, "practice");
        assert_eq!(item.title, "Delayed retrieval");
        assert_eq!(
            item.practice_context["delayed_retrieval"],
            serde_json::json!(true)
        );
        let ids = practice_question_ids(&item.practice_context);
        assert!(ids.contains(&"q-stale".to_owned()));
    }

    #[test]
    fn delayed_retrieval_skips_recent_and_underevidenced_concepts() {
        use adaptive_learn_domain::AssessmentMode;
        let now = Utc::now();

        // The only due question was just practiced.
        let recent = HashSet::from(["q-stale".to_owned()]);
        let context = planner_context(
            vec![state_view(
                "c-stale",
                AssessmentMode::Recall,
                0.3,
                3.0,
                Some(now - Duration::days(20)),
            )],
            vec![planner_question(
                "q-stale",
                AssessmentMode::Recall,
                &["c-stale"],
            )],
            recent,
        );
        assert!(delayed_retrieval_item(&context, &[], now).is_none());

        // Too little evidence to be worth spacing.
        let context = planner_context(
            vec![state_view(
                "c-thin",
                AssessmentMode::Recall,
                0.3,
                1.0,
                Some(now - Duration::days(20)),
            )],
            vec![planner_question(
                "q-thin",
                AssessmentMode::Recall,
                &["c-thin"],
            )],
            HashSet::new(),
        );
        assert!(delayed_retrieval_item(&context, &[], now).is_none());

        // Practiced too recently to be due.
        let context = planner_context(
            vec![state_view(
                "c-recent",
                AssessmentMode::Recall,
                0.3,
                6.0,
                Some(now - Duration::hours(1)),
            )],
            vec![planner_question(
                "q-recent",
                AssessmentMode::Recall,
                &["c-recent"],
            )],
            HashSet::new(),
        );
        assert!(delayed_retrieval_item(&context, &[], now).is_none());
    }

    #[test]
    fn delayed_retrieval_keeps_assessment_modes_separate() {
        use adaptive_learn_domain::AssessmentMode;
        let now = Utc::now();
        // The stale state is recognition, but only an application question exists.
        let context = planner_context(
            vec![state_view(
                "c-stale",
                AssessmentMode::Recognition,
                0.3,
                3.0,
                Some(now - Duration::days(20)),
            )],
            vec![planner_question(
                "q-app",
                AssessmentMode::Application,
                &["c-stale"],
            )],
            HashSet::new(),
        );
        assert!(delayed_retrieval_item(&context, &[], now).is_none());
    }

    #[tokio::test]
    async fn standard_daily_items_depend_only_on_content() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );

        // The fallback is built from authored content only, with no learner
        // state, and still produces a usable, ordered plan.
        let items = standard_daily_items(&state, "soa-c03");
        assert!(!items.is_empty(), "fallback should plan items");
        for (index, item) in items.iter().enumerate() {
            assert_eq!(item.position, index as i32);
            assert!(
                matches!(item.kind, "learn_node" | "domain_practice"),
                "unexpected fallback kind {}",
                item.kind
            );
            assert!(!item.domain_id.is_empty());
        }
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
        });
        assert!(two_shapes.is_err());
    }

    #[test]
    fn python_results_map_without_any_learner_source() {
        // Learner Python is executed only in the browser sandbox. The API must
        // never accept source, stdout, or tracebacks for execution or storage;
        // the only Python answer primitive is the reported test count.
        let payload = AnswerPayload {
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
            choice_id: None,
            choice_ids: None,
            python_results: Some(crate::dto::PythonCodeAnswer {
                passed: 2,
                total: 3,
            }),
        };

        let serialized = serde_json::to_value(&payload).expect("serializes");
        let keys: Vec<&str> = serialized
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        for forbidden in ["source", "code", "program", "stdout", "stderr", "traceback"] {
            assert!(
                !keys.contains(&forbidden),
                "answer payload must not carry {forbidden}"
            );
        }

        assert_eq!(
            to_submitted(payload).expect("maps python results"),
            SubmittedAnswer::PythonCode {
                passed: 2,
                total: 3
            }
        );
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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
            choice_id: None,
            choice_ids: None,
            python_results: None,
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

    #[tokio::test]
    async fn challenge_view_maps_stages_and_domains() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );

        let challenge = state
            .content
            .challenge("ai-python-fluency", "python-fluency-zip-journey")
            .expect("the embedded sample challenge resolves");
        let view = challenge_view(&state, challenge);

        assert_eq!(view.id, "python-fluency-zip-journey");
        assert_eq!(view.stages.len(), 4);
        assert_eq!(view.stages[0].kind, ChallengeStageKind::Question);
        assert_eq!(
            view.stages[0].question_id.as_deref(),
            Some("py1-zip-behavior-002")
        );
        assert_eq!(view.stages[0].domain_id.as_deref(), Some("domain-1"));
        assert_eq!(view.stages[2].kind, ChallengeStageKind::LearningNode);
        assert_eq!(
            view.stages[2].node_id.as_deref(),
            Some("domain-1-zip_parallel")
        );
        assert_eq!(view.stages[2].domain_id.as_deref(), Some("domain-1"));
        assert!(
            view.stages
                .windows(2)
                .all(|pair| pair[0].order < pair[1].order),
            "stages must be in authored order"
        );
    }

    /// A question carrying full Phase 1 pedagogy metadata.
    fn question_with_pedagogy() -> adaptive_learn_content::Question {
        use adaptive_learn_content::{CanonicalAnswer, Choice, Interaction, Question, SourceRef};
        use adaptive_learn_domain::{
            AssessmentMode, InteractionType, PedagogyMetadata, PedagogyStage,
        };

        Question {
            id: "leak-q-001".to_owned(),
            content_version: "leak-v1-content".to_owned(),
            certification_version: "leak-v1".to_owned(),
            domain_id: "domain-1".to_owned(),
            task_id: "1.1".to_owned(),
            assessment_mode: AssessmentMode::Application,
            interaction_type: InteractionType::MultipleChoice,
            difficulty_prior: 0.4,
            pedagogy: Some(PedagogyMetadata {
                family_id: Some("dsa.sliding_window.variable".to_owned()),
                stage: Some(PedagogyStage::Transfer),
                scaffold_level: Some(0),
                transfer_group_id: Some("moving_contiguous_range".to_owned()),
                surface_context: Some("api_rate_limiting".to_owned()),
                challenge_group_id: None,
            }),
            prompt: "Which approach fits this cold scenario?".to_owned(),
            instruction: None,
            interaction: Interaction::MultipleChoice {
                choices: vec![
                    Choice {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                    },
                    Choice {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                    },
                ],
            },
            canonical_answer: CanonicalAnswer::MultipleChoice {
                choice_id: "a".to_owned(),
            },
            concepts: vec![adaptive_learn_content::QuestionConcept {
                concept_id: "c1".to_owned(),
                weight: 1.0,
            }],
            explanation: "A fits.".to_owned(),
            choice_feedback: BTreeMap::new(),
            blueprint_skill_ids: Vec::new(),
            difficulty_label: None,
            hints: Vec::new(),
            error_codes: Vec::new(),
            source_refs: vec![SourceRef {
                title: "Source".to_owned(),
                url: "https://example.com".to_owned(),
            }],
        }
    }

    /// Answer-leak regression: pre-answer payloads never expose family metadata.
    ///
    /// Phase 5 adds authored family guides and comparisons, but they are only
    /// ever served post-exposure through a separate, authenticated endpoint. The
    /// ordinary question payloads must stay free of `pedagogy`, family ids,
    /// signals, and summaries so a cold-transfer item cannot be pre-labelled.
    #[test]
    fn learner_question_views_never_leak_family_metadata() {
        let question = question_with_pedagogy();
        let safe = serde_json::to_value(question_view(&question)).expect("serializes");
        let study = serde_json::to_value(study_question_view(&question)).expect("serializes");

        for payload in [&safe, &study] {
            // Structural check: the whole pedagogy object is absent, not just
            // its individual keys.
            assert!(
                payload.get("pedagogy").is_none(),
                "a pre-answer payload must not carry a pedagogy object"
            );
            for forbidden in [
                "pedagogy",
                "family_id",
                "transfer_group_id",
                "surface_context",
                "recognition_signals",
                "structural_steps",
                "core_rules",
                "common_confusions",
                "example_contexts",
                "sliding_window",
            ] {
                assert!(
                    !payload.to_string().contains(forbidden),
                    "a pre-answer question payload must not expose {forbidden}"
                );
            }
        }

        // The learner-safe view never carries the answer key; the study view
        // intentionally does, because ordinary missions score locally first and
        // the server always re-scores authoritatively.
        assert!(safe.get("canonical_answer").is_none());
        assert!(study.get("canonical_answer").is_some());
    }

    /// A track without authored family guides returns an empty insight list.
    #[tokio::test]
    async fn family_insights_are_empty_without_guides() {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        let content = Arc::new(
            adaptive_learn_content::ContentRegistry::embedded().expect("embedded content"),
        );
        let state = AppState::new(
            pool,
            content,
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        );
        let user = AuthenticatedUser {
            id: Uuid::new_v4(),
            auth_subject: "test-user".to_owned(),
            email: None,
        };

        // No content currently authors family guides, so this returns early and
        // never touches the unreachable database.
        let response = family_insights(&state, &user, "aws-soa-c03", None)
            .await
            .expect("track resolves");
        assert!(response.insights.is_empty());
        assert!(!response.has_guides);
    }

    /// A minimal content registry with one pedagogy question and one guide.
    fn registry_with_family() -> adaptive_learn_content::ContentRegistry {
        let bundle = serde_json::json!({
            "certification": {
                "id": "phase5-track",
                "vendor": "Test",
                "name": "Phase 5",
                "exam_code": "PHASE5",
                "official_source_url": "https://example.com/blueprint",
                "last_reviewed": "2026-09-25"
            },
            "version": {
                "id": "phase5-v1",
                "exam_code": "PHASE5",
                "effective_date": "2026-09-25",
                "content_version": "phase5-v1-content",
                "domains": [{
                    "id": "domain-1",
                    "name": "Domain",
                    "weight": 1.0,
                    "tasks": [{ "id": "1.1", "name": "Task", "question_ids": ["p5-q-1"] }]
                }]
            },
            "concepts": [
                { "id": "test.concept", "name": "Concept", "description": "A concept." }
            ],
            "questions": [{
                "id": "p5-q-1",
                "content_version": "phase5-v1-content",
                "certification_version": "phase5-v1",
                "domain_id": "domain-1",
                "task_id": "1.1",
                "assessment_mode": "application",
                "interaction_type": "multiple_choice",
                "difficulty_prior": 0.4,
                "pedagogy": {
                    "family_id": "dsa.sliding_window.variable",
                    "surface_context": "api_rate_limiting",
                    "transfer_group_id": "g1"
                },
                "prompt": "A rate-limiting window problem.",
                "instruction": null,
                "interaction": {
                    "type": "multiple_choice",
                    "choices": [{ "id": "a", "label": "A" }, { "id": "b", "label": "B" }]
                },
                "canonical_answer": { "type": "multiple_choice", "choice_id": "a" },
                "concepts": [{ "concept_id": "test.concept", "weight": 1.0 }],
                "explanation": "A fits.",
                "hints": [],
                "error_codes": [{ "code": "wrong", "description": "Wrong." }],
                "source_refs": [{ "title": "Source", "url": "https://example.com" }]
            }]
        })
        .to_string();

        let guide = serde_json::json!({
            "schema_version": "family-guide-v1",
            "certification_id": "phase5-track",
            "certification_version": "phase5-v1",
            "family_id": "dsa.sliding_window.variable",
            "title": "Moving Valid Window",
            "summary": "Maintain one active contiguous range.",
            "recognition_signals": ["contiguous ranges"],
            "core_rules": ["After repair, the range is valid."],
            "structural_steps": ["add the incoming item"],
            "common_confusions": [],
            "example_contexts": [
                { "context_id": "api_rate_limiting", "label": "API rate limiting" }
            ],
            "source_refs": [{ "title": "Source", "url": "https://example.com" }]
        })
        .to_string();

        adaptive_learn_content::ContentRegistry::from_all_sources_with_families(
            &[&bundle],
            &[],
            &[],
            &[],
            &[&guide],
        )
        .expect("custom content is valid")
    }

    fn state_with(config: adaptive_learn_content::ContentRegistry) -> AppState {
        use crate::auth::{Authenticator, DevVerifier};
        use std::sync::Arc;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(50))
            .connect_lazy("postgres://app:app@127.0.0.1:1/app")
            .expect("lazy pool");
        AppState::new(
            pool,
            Arc::new(config),
            Authenticator {
                verifier: Arc::new(DevVerifier),
                profile: None,
            },
        )
    }

    /// The history join resolves pedagogy and a learner-safe title, skips
    /// unknown questions, and applies an optional mission family scope.
    #[tokio::test]
    async fn seen_records_join_pedagogy_and_scope_to_mission() {
        let state = state_with(registry_with_family());
        let rows = vec![
            db::learning_events::SeenQuestion {
                question_id: "p5-q-1".to_owned(),
                last_occurred_at: Utc::now(),
            },
            db::learning_events::SeenQuestion {
                question_id: "removed-question".to_owned(),
                last_occurred_at: Utc::now(),
            },
        ];

        let seen = seen_records(&state, "phase5-v1", &rows, None);
        assert_eq!(seen.len(), 1, "an unknown question is skipped safely");
        assert_eq!(seen[0].family_id, "dsa.sliding_window.variable");
        assert_eq!(
            seen[0].surface_context.as_deref(),
            Some("api_rate_limiting")
        );
        assert_eq!(seen[0].title, "A rate-limiting window problem.");

        let allowed: HashSet<String> = ["dsa.sliding_window.variable".to_owned()].into();
        assert_eq!(
            seen_records(&state, "phase5-v1", &rows, Some(&allowed)).len(),
            1
        );

        let other: HashSet<String> = ["dsa.prefix_state".to_owned()].into();
        assert!(
            seen_records(&state, "phase5-v1", &rows, Some(&other)).is_empty(),
            "a mission scope excludes other families"
        );
    }
}
