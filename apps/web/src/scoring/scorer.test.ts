import { describe, expect, it } from "vitest";

import type { AnswerPayload } from "../api/types";
import golden from "./fixtures/scoring_golden.json";
import { scoreQuestion, ScoringError, type ScoreableQuestion } from "./scorer";

interface GoldenCase {
  id: string;
  question: ScoreableQuestion;
  answer: AnswerPayload;
  expected?: { score: number; correct: boolean; error_codes: string[] };
  expected_error?: string;
}

const cases = (golden as unknown as { cases: GoldenCase[] }).cases;

describe("golden scoring fixtures", () => {
  it("covers every interaction type", () => {
    const types = new Set(cases.map((entry) => entry.question.interaction.type));
    expect([...types].sort()).toEqual(
      [
        "classification",
        "command_assembly",
        "configuration_builder",
        "evidence_selection",
        "fill_slots",
        "multiple_choice",
        "multiple_response",
        "node_connection",
        "ordering",
        "python_code",
        "reconstruction",
        "scenario_choice_chain",
        "spot_the_fault",
        "troubleshooting",
        "two_dimensional_placement",
        "typed_fill_blank",
      ].sort(),
    );
  });

  for (const entry of cases) {
    it(entry.id, () => {
      if (entry.expected_error) {
        try {
          scoreQuestion(entry.question, entry.answer);
          expect.fail(`expected ScoringError ${entry.expected_error}`);
        } catch (error) {
          expect(error).toBeInstanceOf(ScoringError);
          expect((error as ScoringError).code).toBe(entry.expected_error);
        }
        return;
      }

      const result = scoreQuestion(entry.question, entry.answer);
      const expected = entry.expected;
      if (!expected) {
        throw new Error(`case ${entry.id} is missing expected`);
      }

      expect(result.correct).toBe(expected.correct);
      expect(result.score).toBeCloseTo(expected.score, 9);
      expect(result.errorCodes).toEqual(expected.error_codes);
      expect(result.canonicalAnswer).toEqual(
        entry.question.canonical_answer,
      );
    });
  }
});
