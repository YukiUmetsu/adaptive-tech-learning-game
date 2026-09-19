import { beforeEach, describe, expect, it } from "vitest";

import type { MissionResponse } from "../api/types";
import {
  appendPendingEvent,
  getDeviceId,
  loadMission,
  loadPendingEvents,
  markEventsSynced,
  pendingEventCount,
  saveMission,
  type AttemptRecord,
  type MissionProgress,
} from "./persistence";

const mission: MissionResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  certification_id: "aws-soa-c03",
  certification_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  mode: "task_practice",
  domain_id: "domain-1",
  task_id: "1.1",
  issued_at: "2026-09-19T10:00:00Z",
  expires_at: "2026-09-19T11:00:00Z",
  questions: [],
};

function progress(): MissionProgress {
  return {
    mission,
    currentIndex: 0,
    attempts: [],
    startedAt: "2026-09-19T10:00:00Z",
    finished: false,
  };
}

const attempt: AttemptRecord = {
  eventId: "33333333-3333-4333-8333-333333333333",
  questionId: "q1",
  attemptNumber: 1,
  correct: true,
  score: 1,
  errorCodes: [],
  hintCount: 0,
  responseMs: 1000,
  occurredAt: "2026-09-19T10:00:01Z",
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("persistence", () => {
  it("returns a stable device id", () => {
    const first = getDeviceId();
    const second = getDeviceId();

    expect(first).toBe(second);
    expect(first).toMatch(/[0-9a-f-]{36}/);
  });

  it("round-trips mission progress", () => {
    saveMission(progress());

    expect(loadMission()?.mission.id).toBe(mission.id);
  });

  it("tracks pending events until they are synced", () => {
    const persisted = appendPendingEvent({
      eventId: attempt.eventId,
      missionInstanceId: mission.id,
      questionId: "q1",
      contentVersion: mission.content_version,
      attemptNumber: 1,
      hintCount: 0,
      responseMs: 1000,
      occurredAt: "2026-09-19T10:00:01Z",
      answer: { placements: { a: "x" } },
    });

    expect(persisted).toBe(true);
    expect(pendingEventCount()).toBe(1);

    markEventsSynced([attempt.eventId]);

    expect(pendingEventCount()).toBe(0);
    expect(loadPendingEvents()).toHaveLength(0);
  });
});
