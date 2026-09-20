import { describe, expect, it } from "vitest";

import type { DomainDto, StudySessionResponse } from "../api/types";
import { adaptiveSessionPlan, buildStandardSession } from "./sessionPlan";

function domain(id: string, learningAvailable: boolean): DomainDto {
  return {
    id,
    name: `Domain ${id}`,
    weight: 0.5,
    learning_available: learningAvailable,
    tasks: [],
  };
}

describe("buildStandardSession", () => {
  it("uses authored domain order and respects the requested duration", () => {
    const plan = buildStandardSession(
      [domain("d1", true), domain("d2", false), domain("d3", true)],
      15,
    );

    expect(plan.source).toBe("standard");
    expect(plan.sessionId).toBeNull();
    expect(plan.activities.map((activity) => activity.kind)).toEqual([
      "explore_domain",
      "practice_domain",
      "practice_domain",
    ]);
    expect(plan.activities.map((activity) => activity.domainId)).toEqual([
      "d1",
      "d1",
      "d2",
    ]);
    expect(plan.estimatedMinutes).toBe(15);
  });

  it("skips learning activities for domains without a learning map", () => {
    const plan = buildStandardSession([domain("d1", false)], 5);
    expect(plan.activities.map((activity) => activity.kind)).toEqual([
      "practice_domain",
    ]);
  });

  it("is deterministic and returns an empty plan without domains", () => {
    const first = buildStandardSession([domain("d1", true)], 20);
    expect(buildStandardSession([domain("d1", true)], 20)).toEqual(first);
    expect(buildStandardSession([], 20).activities).toEqual([]);
  });

  it("always plans at least one activity for a positive request", () => {
    const plan = buildStandardSession([domain("d1", false)], 1);
    expect(plan.activities).toHaveLength(1);
  });
});

describe("adaptiveSessionPlan", () => {
  it("normalizes a server session", () => {
    const session: StudySessionResponse = {
      session_id: "session-1",
      track_id: "ai-python-fluency",
      estimated_minutes: 8,
      activities: [
        {
          kind: "practice",
          domain_id: "domain-1",
          domain_name: "Domain 1",
          node_id: null,
          node_title: null,
          question_ids: ["q1", "q2"],
          concept_ids: ["c1"],
          title: "Practice Domain 1",
          estimated_minutes: 4,
        },
        {
          kind: "learn_node",
          domain_id: "domain-1",
          domain_name: "Domain 1",
          node_id: "n1",
          node_title: "Node 1",
          question_ids: [],
          concept_ids: ["c1"],
          title: "Learn Node 1",
          estimated_minutes: 4,
        },
      ],
    };

    const plan = adaptiveSessionPlan(session);
    expect(plan.source).toBe("adaptive");
    expect(plan.sessionId).toBe("session-1");
    expect(plan.activities[0]).toMatchObject({
      kind: "practice",
      domainId: "domain-1",
      questionIds: ["q1", "q2"],
    });
    expect(plan.activities[1]).toMatchObject({
      kind: "learn_node",
      nodeId: "n1",
    });
  });
});
