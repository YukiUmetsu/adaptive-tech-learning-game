import type { components } from "./schema";

export type CatalogResponse = components["schemas"]["CatalogResponse"];
export type CertificationDto = components["schemas"]["CertificationDto"];
export type CertificationVersionDto =
  components["schemas"]["CertificationVersionDto"];
export type DomainDto = components["schemas"]["DomainDto"];
export type TaskDto = components["schemas"]["TaskDto"];
export type ConceptDto = components["schemas"]["ConceptDto"];
export type PedagogyStage = components["schemas"]["PedagogyStage"];
export type PedagogyMetadata = components["schemas"]["PedagogyMetadata"];
export type MissionResponse = components["schemas"]["MissionResponse"];
export type IssueMissionRequest = components["schemas"]["IssueMissionRequest"];
export type ChallengeView = components["schemas"]["ChallengeView"];
export type ChallengeStageView = components["schemas"]["ChallengeStageView"];
export type ChallengeStageKind = components["schemas"]["ChallengeStageKind"];
export type ChallengeSummaryDto = components["schemas"]["ChallengeSummaryDto"];
export type ChallengeStartRequest = components["schemas"]["ChallengeStartRequest"];
export type QuizMode = components["schemas"]["QuizMode"];
export type WalletResponse = components["schemas"]["WalletResponse"];
export type MeResponse = components["schemas"]["MeResponse"];
export type QuestionView = components["schemas"]["QuestionView"];
export type StudyQuestionView = components["schemas"]["StudyQuestionView"];
export type ErrorCodeDef = components["schemas"]["ErrorCodeDef"];
export type Interaction = components["schemas"]["Interaction"];
export type Choice = components["schemas"]["Choice"];
export type GraphNode = components["schemas"]["Node"];
export type FillSlot = components["schemas"]["FillSlot"];
export type ScenarioStep = components["schemas"]["ScenarioStep"];
export type ScenarioStage = components["schemas"]["ScenarioStage"];
export type ConfigSlot = components["schemas"]["ConfigSlot"];
export type TypedBlankSlot = components["schemas"]["TypedBlankSlot"];
export type TypedBlankAnswer = components["schemas"]["TypedBlankAnswer"];
export type TypedFillContent = components["schemas"]["TypedFillContent"];
export type TypedFillTableCell = components["schemas"]["TypedFillTableCell"];
export type TypedFillTableColumn = components["schemas"]["TypedFillTableColumn"];
export type TypedFillTableRow = components["schemas"]["TypedFillTableRow"];
export type PlacementAxis = components["schemas"]["PlacementAxis"];
export type PlacementRegion = components["schemas"]["PlacementRegion"];
export type PlacementPoint = components["schemas"]["PlacementPoint"];
export type ReconstructionLayout = components["schemas"]["ReconstructionLayout"];
export type FixedNode = components["schemas"]["FixedNode"];
export type FixedNodePosition = components["schemas"]["FixedNodePosition"];
export type ReconstructionSlot = components["schemas"]["ReconstructionSlot"];
export type AnswerPayload = components["schemas"]["AnswerPayload"];
export type ReconstructionAnswerPayload =
  components["schemas"]["ReconstructionAnswerPayload"];
export type FeedbackResponse = components["schemas"]["FeedbackResponse"];
export type CanonicalAnswer = components["schemas"]["CanonicalAnswer"];
export type SyncEventRequest = components["schemas"]["SyncEventRequest"];
export type SyncEventResult = components["schemas"]["SyncEventResult"];
export type SyncResponse = components["schemas"]["SyncResponse"];
export type SyncSectionResult = components["schemas"]["SyncSectionResult"];
export type DiscoveryUpdateRequest =
  components["schemas"]["DiscoveryUpdateRequest"];
export type AuxiliaryEventRequest =
  components["schemas"]["AuxiliaryEventRequest"];
export type DiscoveryResponse = components["schemas"]["DiscoveryResponse"];
export type TrackMapResponse = components["schemas"]["TrackMapResponse"];
export type FamilyInsightsResponse =
  components["schemas"]["FamilyInsightsResponse"];
export type FamilyInsightDto = components["schemas"]["FamilyInsightDto"];
export type FamilyConfusionDto = components["schemas"]["FamilyConfusionDto"];
export type StructureComparisonDto =
  components["schemas"]["StructureComparisonDto"];
export type SeenExampleDto = components["schemas"]["SeenExampleDto"];
export type FamilyExampleContext =
  components["schemas"]["FamilyExampleContext"];
export type TrackProgressResponse =
  components["schemas"]["TrackProgressResponse"];
export type DomainProgressDto = components["schemas"]["DomainProgressDto"];
export type NodeProgressDto = components["schemas"]["NodeProgressDto"];
export type DiscoveryState = components["schemas"]["DiscoveryState"];
export type StreakDto = components["schemas"]["StreakDto"];
export type EvidenceLevel = components["schemas"]["EvidenceLevel"];
export type FreshnessState = components["schemas"]["FreshnessState"];
export type ModeSignal = components["schemas"]["ModeSignal"];
export type MissionReviewResponse =
  components["schemas"]["MissionReviewResponse"];
export type ReviewedQuestion = components["schemas"]["ReviewedQuestion"];
export type ReviewedAttempt = components["schemas"]["ReviewedAttempt"];
export type UserSettingsDto = components["schemas"]["UserSettingsDto"];
export type LearningDomainResponse =
  components["schemas"]["LearningDomainResponse"];
export type GlossaryTerm = components["schemas"]["GlossaryTerm"];
export type LearningModule = components["schemas"]["LearningModule"];
export type KnowledgeNode = components["schemas"]["KnowledgeNode"];
export type KnowledgePrompt = components["schemas"]["KnowledgePrompt"];
export type PromptKind = components["schemas"]["PromptKind"];
export type LearningReveal = components["schemas"]["LearningReveal"];
export type RevealColumn = components["schemas"]["RevealColumn"];
export type RevealTableColumn = components["schemas"]["RevealTableColumn"];
export type RevealTableRow = components["schemas"]["RevealTableRow"];
export type TableProgressiveReveal =
  components["schemas"]["TableProgressiveReveal"];
export type TableRevealMode = components["schemas"]["TableRevealMode"];
export type TableInitialVisibility =
  components["schemas"]["TableInitialVisibility"];
export type TextProgressiveReveal =
  components["schemas"]["TextProgressiveReveal"];
export type TextRevealSpan = components["schemas"]["TextRevealSpan"];
export type CodeAnnotation = components["schemas"]["CodeAnnotation"];
export type CodeAnnotationAnchor = components["schemas"]["CodeAnnotationAnchor"];
export type MapPosition = components["schemas"]["MapPosition"];
export type SourceRef = components["schemas"]["SourceRef"];
export type PlannerAction = components["schemas"]["PlannerAction"];
export type RecommendationReason =
  components["schemas"]["RecommendationReason"];
export type Recommendation = components["schemas"]["Recommendation"];
export type RecommendationResponse =
  components["schemas"]["RecommendationResponse"];
export type RecommendationRequest =
  components["schemas"]["RecommendationRequest"];
export type RecommendationEventRequest =
  components["schemas"]["RecommendationEventRequest"];
export type RecommendationEventResponse =
  components["schemas"]["RecommendationEventResponse"];
export type RecommendationEventKind =
  components["schemas"]["RecommendationEventKind"];
export type DomainDiscoveryInput =
  components["schemas"]["DomainDiscoveryInput"];
export type StudySessionRequest = components["schemas"]["StudySessionRequest"];
export type StudySessionResponse =
  components["schemas"]["StudySessionResponse"];
export type SessionActivity = components["schemas"]["SessionActivity"];
export type SessionActivityKind = components["schemas"]["SessionActivityKind"];
export type SessionPreference = components["schemas"]["SessionPreference"];
export type DailyMissionRequest = components["schemas"]["DailyMissionRequest"];
export type DailyMissionResponse = components["schemas"]["DailyMissionResponse"];
export type DailyMissionItemDto = components["schemas"]["DailyMissionItemDto"];
export type DailyMissionItemKind = components["schemas"]["DailyMissionItemKind"];
export type DailyMissionItemStatus =
  components["schemas"]["DailyMissionItemStatus"];
export type DailyMissionPlanType = components["schemas"]["DailyMissionPlanType"];
export type DailyMissionStatus = components["schemas"]["DailyMissionStatus"];
export type DailyItemCompleteRequest =
  components["schemas"]["DailyItemCompleteRequest"];
export type DailyItemCompleteResponse =
  components["schemas"]["DailyItemCompleteResponse"];
export type ModelEvaluationResponse =
  components["schemas"]["ModelEvaluationResponse"];
export type CalibrationBucketDto = components["schemas"]["CalibrationBucketDto"];
export type EvaluationSliceDto = components["schemas"]["EvaluationSliceDto"];
export type PracticeTestListResponse =
  components["schemas"]["PracticeTestListResponse"];
export type PracticeTestSummaryDto =
  components["schemas"]["PracticeTestSummaryDto"];
export type PracticeTestResponse =
  components["schemas"]["PracticeTestResponse"];
export type PracticeTestItemView =
  components["schemas"]["PracticeTestItemView"];
export type PracticeTestAnswerRequest =
  components["schemas"]["PracticeTestAnswerRequest"];
export type PracticeTestSubmissionRequest =
  components["schemas"]["PracticeTestSubmissionRequest"];
export type PracticeTestResultResponse =
  components["schemas"]["PracticeTestResultResponse"];
export type PracticeTestItemResult =
  components["schemas"]["PracticeTestItemResult"];
export type PracticeTestDomainResult =
  components["schemas"]["PracticeTestDomainResult"];
