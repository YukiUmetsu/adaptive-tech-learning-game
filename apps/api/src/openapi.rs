//! OpenAPI document generation.
//!
//! Rust response types are the source of truth for the HTTP contract. The web
//! client is generated from this document, so the two never drift by hand.

use utoipa::OpenApi;

use crate::dto::{
    AnswerPayload, AnswerRequest, CatalogResponse, CertificationDto, CertificationVersionDto,
    CompleteMissionRequest, CompleteMissionResponse, ConceptDto, DomainDto, FeedbackResponse,
    IssueMissionRequest, LearningDomainResponse, MissionResponse, QuestionView,
    ReconstructionAnswerPayload, SyncEventRequest, SyncEventResult, SyncRequest, SyncResponse,
    TaskDto, WalletResponse,
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
        crate::routes::missions::issue_mission,
        crate::routes::missions::answer_mission,
        crate::routes::missions::complete_mission,
        crate::routes::sync::sync,
        crate::routes::wallet::get_wallet,
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
        IssueMissionRequest,
        MissionResponse,
        WalletResponse,
        QuestionView,
        AnswerPayload,
        ReconstructionAnswerPayload,
        AnswerRequest,
        FeedbackResponse,
        SyncRequest,
        SyncEventRequest,
        SyncResponse,
        SyncEventResult,
        CompleteMissionRequest,
        CompleteMissionResponse,
        LearningDomainResponse,
        adaptive_learn_content::Interaction,
        adaptive_learn_content::CanonicalAnswer,
        adaptive_learn_content::Choice,
        adaptive_learn_content::Node,
        adaptive_learn_content::FillSlot,
        adaptive_learn_content::ScenarioStage,
        adaptive_learn_content::ScenarioStep,
        adaptive_learn_content::ConfigSlot,
        adaptive_learn_content::TypedBlankSlot,
        adaptive_learn_content::TypedBlankAnswer,
        adaptive_learn_content::PlacementAxis,
        adaptive_learn_content::PlacementRegion,
        adaptive_learn_content::PlacementPoint,
        adaptive_learn_content::ReconstructionLayout,
        adaptive_learn_content::FixedNodePosition,
        adaptive_learn_content::FixedNode,
        adaptive_learn_content::ReconstructionSlot,
        adaptive_learn_content::SourceRef,
        adaptive_learn_content::LearningDomainMeta,
        adaptive_learn_content::LearningDesign,
        adaptive_learn_content::LearningModule,
        adaptive_learn_content::KnowledgeNode,
        adaptive_learn_content::KnowledgePrompt,
        adaptive_learn_content::PromptKind,
        adaptive_learn_content::LearningReveal,
        adaptive_learn_content::RevealColumn,
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
        (name = "missions", description = "Mission issuance, scoring, and completion"),
        (name = "sync", description = "Batch reconciliation of learning events"),
        (name = "wallet", description = "Server-authoritative Bits balance")
    )
)]
pub struct ApiDoc;

/// Returns the OpenAPI document with the crate version applied at runtime.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let mut document = ApiDoc::openapi();
    document.info.version = env!("CARGO_PKG_VERSION").to_owned();
    document
}
