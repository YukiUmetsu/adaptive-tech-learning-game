import { api } from "../api/client";
import type {
  DailyItemCompleteResponse,
  DailyMissionItemDto,
  DomainDiscoveryInput,
} from "../api/types";

/** Concise, game-like presentation for one Daily Mission item. */
export interface DailyActivityPresentation {
  icon: string;
  kind: string;
  primary: string;
}

export function dailyActivityPresentation(
  item: DailyMissionItemDto,
): DailyActivityPresentation {
  switch (item.kind) {
    case "learn_node":
      return { icon: "📘", kind: "Learn", primary: item.title };
    case "review_node":
      return { icon: "🔁", kind: "Review", primary: item.title };
    case "practice": {
      const count = item.question_count;
      return {
        icon: "✍️",
        kind: "Practice",
        primary:
          count > 0
            ? `${count} question${count === 1 ? "" : "s"}`
            : "Retrieval practice",
      };
    }
    case "domain_practice":
      return { icon: "🎯", kind: "Domain practice", primary: item.title };
  }
}

/** The first incomplete item, or `null` when the mission is complete. */
export function firstIncompleteItem(
  items: DailyMissionItemDto[],
): DailyMissionItemDto | null {
  return items.find((item) => item.status === "pending") ?? null;
}

/** Number of completed items. */
export function completedItemCount(items: DailyMissionItemDto[]): number {
  return items.filter((item) => item.status === "completed").length;
}

/** Reports a learning node's completion for a Daily Mission item. */
export async function completeDailyNodeItem(options: {
  dailyMissionId: string;
  position: number;
  discovery: DomainDiscoveryInput[];
}): Promise<DailyItemCompleteResponse> {
  const result = await api.POST(
    "/v1/daily-missions/{mission_id}/items/{position}/complete",
    {
      params: {
        path: {
          mission_id: options.dailyMissionId,
          position: options.position,
        },
      },
      body: { discovery: options.discovery },
    },
  );

  if (result.error || !result.data) {
    throw new Error(`Could not update Daily Mission (HTTP ${result.response.status})`);
  }

  return result.data;
}
