//! OpenAPI document generation.
//!
//! Rust response types are the source of truth for the HTTP contract. The web
//! client is generated from this document, so the two never drift by hand.

use utoipa::OpenApi;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};

use adaptive_learn_domain::{PedagogyMetadata, PedagogyStage};

use crate::dto::{
    AnswerPayload, AnswerRequest, AuxiliaryEventRequest, CalibrationBucketDto, CatalogResponse,
    CertificationDto, CertificationVersionDto, CompleteMissionRequest, CompleteMissionResponse,
    ConceptDto, CyberDefenseUpgradeRequest, CyberDefenseUpgradeResponse, DailyItemCompleteRequest,
    DailyItemCompleteResponse, DailyMissionItemDto, DailyMissionItemKind, DailyMissionItemStatus,
    DailyMissionPlanType, DailyMissionRequest, DailyMissionResponse, DailyMissionStatus,
    DiscoveryResponse, DiscoveryState, DiscoveryUpdateRequest, DomainDto, DomainProgressDto,
    EvaluationSliceDto, FeedbackResponse, IssueMissionRequest, LearningDomainResponse, MeResponse,
    MissionResponse, MissionReviewResponse, ModelEvaluationResponse, NodeProgressDto,
    PracticeTestAnswerRequest, PracticeTestDomainResult, PracticeTestItemResult,
    PracticeTestItemView, PracticeTestListResponse, PracticeTestResponse,
    PracticeTestResultResponse, PracticeTestSubmissionRequest, PracticeTestSummaryDto,
    PythonCodeAnswer, QuestionView, RecommendationEventRequest, RecommendationEventResponse,
    RecommendationRequest, RecommendationResponse, ReconstructionAnswerPayload, ReviewedAttempt,
    ReviewedQuestion, StreakDto, StudyQuestionView, StudySessionRequest, StudySessionResponse,
    SyncEventRequest, SyncEventResult, SyncRequest, SyncResponse, SyncSectionResult, TaskDto,
    TrackMapResponse, TrackProgressResponse, UpdateSettingsRequest, UserSettingsDto,
    WalletResponse,
};
use crate::error::{ErrorBody, ErrorResponse};
use crate::routes::health::{DatabaseStatus, HealthResponse, HealthStatus};

/// Declares the public API surface.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Adaptive Learning API",
        description = "Operational endpoints plus the Phase 1 learning MVP for AWS SOA-C03."
    ),
    paths(
        crate::routes::health::health,
        crate::routes::openapi::openapi_json,
        crate::routes::certifications::list_certifications,
        crate::routes::learning::get_learning_domain,
        crate::routes::practice_tests::list_practice_tests,
        crate::routes::practice_tests::get_practice_test,
        crate::routes::practice_tests::submit_practice_test,
        crate::routes::discovery::get_track_discovery,
        crate::routes::progress::get_track_map,
        crate::routes::progress::get_track_progress,
        crate::routes::recommendations::create_recommendation,
        crate::routes::recommendations::record_recommendation_event,
        crate::routes::sessions::create_study_session,
        crate::routes::daily_missions::get_today_daily_mission,
        crate::routes::daily_missions::start_daily_item,
        crate::routes::daily_missions::complete_daily_item,
        crate::routes::daily_missions::review_daily_item,
        crate::routes::internal::get_model_evaluation,
        crate::routes::missions::issue_mission,
        crate::routes::missions::answer_mission,
        crate::routes::missions::complete_mission,
        crate::routes::missions::review_mission,
        crate::routes::sync::sync,
        crate::routes::wallet::get_wallet,
        crate::routes::cyber_defense::spend_upgrade,
        crate::routes::me::get_me,
        crate::routes::me::update_settings,
    ),
    components(schemas(
        HealthResponse,
        HealthStatus,
        DatabaseStatus,
        ErrorResponse,
        ErrorBody,
        CatalogResponse,
        CertificationDto,
        CertificationVersionDto,
        DomainDto,
        TaskDto,
        ConceptDto,
        PedagogyStage,
        PedagogyMetadata,
        IssueMissionRequest,
        MissionResponse,
        WalletResponse,
        CyberDefenseUpgradeRequest,
        CyberDefenseUpgradeResponse,
        MeResponse,
        QuestionView,
        StudyQuestionView,
        AnswerPayload,
        PythonCodeAnswer,
        ReconstructionAnswerPayload,
        AnswerRequest,
        FeedbackResponse,
        SyncRequest,
        SyncEventRequest,
        SyncResponse,
        SyncEventResult,
        SyncSectionResult,
        DiscoveryUpdateRequest,
        AuxiliaryEventRequest,
        DiscoveryResponse,
        TrackMapResponse,
        TrackProgressResponse,
        DomainProgressDto,
        NodeProgressDto,
        DiscoveryState,
        StreakDto,
        MissionReviewResponse,
        ReviewedQuestion,
        ReviewedAttempt,
        UserSettingsDto,
        UpdateSettingsRequest,
        crate::signals::EvidenceLevel,
        crate::signals::FreshnessState,
        crate::signals::ModeSignal,
        CompleteMissionRequest,
        CompleteMissionResponse,
        LearningDomainResponse,
        RecommendationResponse,
        RecommendationRequest,
        RecommendationEventRequest,
        RecommendationEventResponse,
        crate::dto::RecommendationEventKind,
        StudySessionRequest,
        StudySessionResponse,
        crate::planner::session::SessionPreference,
        crate::planner::session::SessionActivity,
        crate::planner::session::SessionActivityKind,
        crate::planner::session::StudySession,
        DailyMissionResponse,
        DailyMissionRequest,
        DailyMissionItemDto,
        DailyMissionItemKind,
        DailyMissionItemStatus,
        DailyMissionPlanType,
        DailyMissionStatus,
        DailyItemCompleteRequest,
        DailyItemCompleteResponse,
        CalibrationBucketDto,
        EvaluationSliceDto,
        ModelEvaluationResponse,
        PracticeTestListResponse,
        PracticeTestSummaryDto,
        PracticeTestResponse,
        PracticeTestItemView,
        PracticeTestAnswerRequest,
        PracticeTestSubmissionRequest,
        PracticeTestResultResponse,
        PracticeTestItemResult,
        PracticeTestDomainResult,
        adaptive_learn_content::DomainDiscoveryInput,
        crate::planner::Recommendation,
        crate::planner::PlannerAction,
        crate::planner::RecommendationReason,
        adaptive_learn_content::Interaction,
        adaptive_learn_content::CanonicalAnswer,
        adaptive_learn_content::ErrorCodeDef,
        adaptive_learn_content::Choice,
        adaptive_learn_content::Node,
        adaptive_learn_content::FillSlot,
        adaptive_learn_content::ScenarioStage,
        adaptive_learn_content::ScenarioStep,
        adaptive_learn_content::ConfigSlot,
        adaptive_learn_content::TypedBlankSlot,
        adaptive_learn_content::TypedBlankAnswer,
        adaptive_learn_content::TypedFillContent,
        adaptive_learn_content::TypedFillTableColumn,
        adaptive_learn_content::TypedFillTableRow,
        adaptive_learn_content::TypedFillTableCell,
        adaptive_learn_content::PlacementAxis,
        adaptive_learn_content::PlacementRegion,
        adaptive_learn_content::PlacementPoint,
        adaptive_learn_content::ReconstructionLayout,
        adaptive_learn_content::FixedNodePosition,
        adaptive_learn_content::FixedNode,
        adaptive_learn_content::ReconstructionSlot,
        adaptive_learn_content::PythonTest,
        adaptive_learn_content::SourceRef,
        adaptive_learn_content::LearningDomainMeta,
        adaptive_learn_content::LearningDesign,
        adaptive_learn_content::LearningModule,
        adaptive_learn_content::KnowledgeNode,
        adaptive_learn_content::KnowledgePrompt,
        adaptive_learn_content::PromptKind,
        adaptive_learn_content::LearningReveal,
        adaptive_learn_content::RevealColumn,
        adaptive_learn_content::RevealTableColumn,
        adaptive_learn_content::RevealTableRow,
        adaptive_learn_content::TableProgressiveReveal,
        adaptive_learn_content::TableRevealMode,
        adaptive_learn_content::TableInitialVisibility,
        adaptive_learn_content::TextProgressiveReveal,
        adaptive_learn_content::TextRevealSpan,
        adaptive_learn_content::CodeAnnotation,
        adaptive_learn_content::CodeAnnotationAnchor,
        adaptive_learn_content::MapPosition,
        adaptive_learn_domain::ConceptWeight,
        adaptive_learn_domain::AssessmentMode,
        adaptive_learn_domain::InteractionType,
        adaptive_learn_domain::MissionStatus,
        adaptive_learn_domain::QuizMode
    )),
    tags(
        (name = "system", description = "Operational endpoints"),
        (name = "catalog", description = "Certification catalog"),
        (name = "learning", description = "Pre-quiz knowledge maps and discovery progress"),
        (name = "recommendations", description = "Optional next-action recommendations for a track"),
        (name = "daily-missions", description = "Immutable daily study missions and their progress"),
        (name = "internal", description = "Internal, aggregate-only analytics"),
        (name = "missions", description = "Mission issuance, scoring, and completion"),
        (name = "practice-tests", description = "Fixed-order exam simulations with delayed feedback"),
        (name = "sync", description = "Batch reconciliation of learning events"),
        (name = "wallet", description = "Server-authoritative Bits balance"),
        (name = "cyber-defense", description = "Server-authoritative Cyber Defense spending"),
        (name = "account", description = "Authenticated learner account")
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

/// Adds the bearer-token security scheme used by protected routes.
struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearerAuth",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}

/// Returns the OpenAPI document with the crate version applied at runtime.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let mut document = ApiDoc::openapi();
    document.info.version = env!("CARGO_PKG_VERSION").to_owned();
    document
}
