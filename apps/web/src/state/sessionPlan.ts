import type {
  DomainDto,
  SessionActivity,
  StudySessionResponse,
} from "../api/types";

/**
 * A single planned study activity, normalized for both adaptive and standard
 * sessions. `explore_domain` is a standard-fallback-only activity that opens a
 * domain's Knowledge Map.
 */
export type PlannedActivityKind =
  | SessionActivity["kind"]
  | "explore_domain";

export interface PlannedActivity {
  kind: PlannedActivityKind;
  domainId: string;
  domainName: string;
  nodeId: string | null;
  title: string;
  /** Server-selected for adaptive practice; never client-supplied. */
  questionIds: string[];
  estimatedMinutes: number;
}

export interface StudySessionPlan {
  /** Server session id for adaptive plans; `null` for the standard fallback. */
  sessionId: string | null;
  /** Whether the plan came from adaptive planning or the standard fallback. */
  source: "adaptive" | "standard";
  estimatedMinutes: number;
  activities: PlannedActivity[];
}

/** Minutes assumed for one standard-fallback activity. */
const STANDARD_ACTIVITY_MINUTES = 5;

/** Normalizes an adaptive session response into a plan. */
export function adaptiveSessionPlan(
  session: StudySessionResponse,
): StudySessionPlan {
  return {
    sessionId: session.session_id,
    source: "adaptive",
    estimatedMinutes: session.estimated_minutes,
    activities: session.activities.map((activity) => ({
      kind: activity.kind,
      domainId: activity.domain_id,
      domainName: activity.domain_name,
      nodeId: activity.node_id ?? null,
      title: activity.title,
      questionIds: [...activity.question_ids],
      estimatedMinutes: activity.estimated_minutes,
    })),
  };
}

/**
 * Builds a deterministic, non-adaptive study session from already-loaded track
 * data.
 *
 * This is the resilience fallback: it never calls the adaptive session API and
 * never needs learner state. Domains are used in authored order, alternating
 * available learning and practice so a learner still has a usable session when
 * adaptive planning is unavailable.
 */
export function buildStandardSession(
  domains: DomainDto[],
  availableMinutes: number,
): StudySessionPlan {
  const maxActivities = Math.max(
    1,
    Math.round(availableMinutes / STANDARD_ACTIVITY_MINUTES),
  );
  const activities: PlannedActivity[] = [];

  for (const domain of domains) {
    if (activities.length >= maxActivities) {
      break;
    }
    if (domain.learning_available) {
      activities.push({
        kind: "explore_domain",
        domainId: domain.id,
        domainName: domain.name,
        nodeId: null,
        title: `Learn ${domain.name}`,
        questionIds: [],
        estimatedMinutes: STANDARD_ACTIVITY_MINUTES,
      });
      if (activities.length >= maxActivities) {
        break;
      }
    }
    activities.push({
      kind: "practice_domain",
      domainId: domain.id,
      domainName: domain.name,
      nodeId: null,
      title: `Practice ${domain.name}`,
      questionIds: [],
      estimatedMinutes: STANDARD_ACTIVITY_MINUTES,
    });
  }

  const estimatedMinutes = activities.reduce(
    (total, activity) => total + activity.estimatedMinutes,
    0,
  );

  return {
    sessionId: null,
    source: "standard",
    estimatedMinutes,
    activities,
  };
}
