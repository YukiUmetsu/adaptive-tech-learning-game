import type { MissionResponse } from "../api/types";
import type { AttemptRecord } from "./persistence";

/** Per-domain coverage for a mixed mission. */
export interface DomainSummary {
  domainId: string;
  totalQuestions: number;
  firstAttemptCorrect: number;
}

/** Deterministic mission summary. No mastery or readiness predictions. */
export interface MissionSummary {
  totalQuestions: number;
  questionsCompleted: number;
  firstAttemptCorrect: number;
  recoveredAttempts: number;
  conceptsPracticed: string[];
  studyTimeMs: number;
  pendingEvents: number;
  bitsEarned: number;
  domains: DomainSummary[];
}

export function computeSummary(
  mission: MissionResponse,
  attempts: AttemptRecord[],
  pendingEvents: number,
): MissionSummary {
  const byQuestion = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    const list = byQuestion.get(attempt.questionId) ?? [];
    list.push(attempt);
    byQuestion.set(attempt.questionId, list);
  }

  const questionById = new Map(
    mission.questions.map((question) => [question.id, question]),
  );

  const domainTotals = new Map<string, number>();
  for (const question of mission.questions) {
    domainTotals.set(
      question.domain_id,
      (domainTotals.get(question.domain_id) ?? 0) + 1,
    );
  }
  const domainCorrect = new Map<string, number>();

  let firstAttemptCorrect = 0;
  let recoveredAttempts = 0;
  let studyTimeMs = 0;
  let bitsEarned = 0;
  const concepts = new Set<string>();

  for (const [questionId, list] of byQuestion) {
    const ordered = [...list].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const first = ordered[0];
    if (first?.correct) {
      firstAttemptCorrect += 1;
      const domainId = questionById.get(questionId)?.domain_id;
      if (domainId) {
        domainCorrect.set(domainId, (domainCorrect.get(domainId) ?? 0) + 1);
      }
    } else if (ordered.some((attempt) => attempt.correct)) {
      recoveredAttempts += 1;
    }

    for (const attempt of ordered) {
      studyTimeMs += attempt.responseMs;
      bitsEarned += attempt.bits ?? 0;
    }

    const question = questionById.get(questionId);
    question?.concepts.forEach((concept) => concepts.add(concept.concept_id));
  }

  const domains: DomainSummary[] = [...domainTotals.entries()]
    .map(([domainId, totalQuestions]) => ({
      domainId,
      totalQuestions,
      firstAttemptCorrect: domainCorrect.get(domainId) ?? 0,
    }))
    .sort((a, b) => a.domainId.localeCompare(b.domainId));

  return {
    totalQuestions: mission.questions.length,
    questionsCompleted: byQuestion.size,
    firstAttemptCorrect,
    recoveredAttempts,
    conceptsPracticed: [...concepts].sort(),
    studyTimeMs,
    pendingEvents,
    bitsEarned,
    domains,
  };
}

/** Formats a millisecond duration as `m:ss`. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
