import type { MissionResponse } from "../api/types";
import type { AttemptRecord } from "./persistence";

/** Deterministic mission summary. No mastery or readiness predictions. */
export interface MissionSummary {
  totalQuestions: number;
  questionsCompleted: number;
  firstAttemptCorrect: number;
  recoveredAttempts: number;
  conceptsPracticed: string[];
  studyTimeMs: number;
  pendingEvents: number;
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

  let firstAttemptCorrect = 0;
  let recoveredAttempts = 0;
  let studyTimeMs = 0;
  const concepts = new Set<string>();

  for (const [questionId, list] of byQuestion) {
    const ordered = [...list].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const first = ordered[0];
    if (first?.correct) {
      firstAttemptCorrect += 1;
    } else if (ordered.some((attempt) => attempt.correct)) {
      recoveredAttempts += 1;
    }

    for (const attempt of ordered) {
      studyTimeMs += attempt.responseMs;
    }

    const question = questionById.get(questionId);
    question?.concepts.forEach((concept) => concepts.add(concept.concept_id));
  }

  return {
    totalQuestions: mission.questions.length,
    questionsCompleted: byQuestion.size,
    firstAttemptCorrect,
    recoveredAttempts,
    conceptsPracticed: [...concepts].sort(),
    studyTimeMs,
    pendingEvents,
  };
}

/** Formats a millisecond duration as `m:ss`. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
