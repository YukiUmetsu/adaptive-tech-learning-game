import { describe, expect, it } from "vitest";

import type { DailyMissionItemDto } from "../api/types";
import {
  completedItemCount,
  dailyActivityPresentation,
  firstIncompleteItem,
} from "./dailyMission";

function item(
  overrides: Partial<DailyMissionItemDto> & { position: number },
): DailyMissionItemDto {
  return {
    kind: "practice",
    domain_id: "d1",
    domain_name: "Domain 1",
    node_id: null,
    title: "Retrieval practice",
    estimated_minutes: 6,
    status: "pending",
    question_count: 3,
    completed_at: null,
    ...overrides,
  };
}

describe("dailyMission helpers", () => {
  it("resumes the first incomplete item", () => {
    const items = [
      item({ position: 0, status: "completed" }),
      item({ position: 1, status: "pending" }),
      item({ position: 2, status: "pending" }),
    ];
    expect(firstIncompleteItem(items)?.position).toBe(1);
    expect(firstIncompleteItem([item({ position: 0, status: "completed" })])).toBeNull();
    expect(completedItemCount(items)).toBe(1);
  });

  it("presents each kind concisely", () => {
    expect(dailyActivityPresentation(item({ position: 0, kind: "practice" }))).toMatchObject({
      kind: "Practice",
      primary: "3 questions",
    });
    expect(
      dailyActivityPresentation(
        item({ position: 1, kind: "learn_node", title: "Operational signals" }),
      ),
    ).toMatchObject({ kind: "Learn", primary: "Operational signals" });
    expect(
      dailyActivityPresentation(
        item({ position: 2, kind: "domain_practice", title: "Domain review" }),
      ),
    ).toMatchObject({ kind: "Domain practice", primary: "Domain review" });
  });
});
