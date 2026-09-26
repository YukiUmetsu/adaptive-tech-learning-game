import type { FamilyInsightDto, FamilyInsightsResponse } from "../api/types";

/** A representative family insight fixture used across Phase 5 UI tests. */
export function familyInsightFixture(
  overrides: Partial<FamilyInsightDto> = {},
): FamilyInsightDto {
  return {
    family_id: "dsa.sliding_window.variable",
    title: "Moving Valid Window",
    summary:
      "Maintain information about one contiguous active range while its boundaries move.",
    recognition_signals: [
      "candidate solutions are contiguous ranges",
      "one boundary adds state while the other removes it",
    ],
    core_rules: ["After repair, the active range satisfies the validity condition."],
    structural_steps: [
      "add the new right-side item",
      "repair by moving the left boundary",
    ],
    example_contexts: [
      { context_id: "api_rate_limiting", label: "API rate limiting" },
      { context_id: "security_events", label: "Recent fraud-event window" },
    ],
    common_confusions: [
      {
        other_family_id: "dsa.prefix_state",
        other_family_title: "Fixed Cumulative State",
        distinction:
          "A moving window maintains one active range. Prefix state precomputes cumulative information.",
      },
    ],
    source_refs: [
      { title: "MIT 6.006", url: "https://example.com/mit" },
    ],
    seen_context_count: 2,
    seen_example_count: 2,
    comparison: {
      family_id: "dsa.sliding_window.variable",
      title: "Moving Valid Window",
      summary:
        "Maintain information about one contiguous active range while its boundaries move.",
      recognition_signals: [
        "candidate solutions are contiguous ranges",
        "one boundary adds state while the other removes it",
      ],
      core_rules: ["After repair, the active range satisfies the validity condition."],
      structural_steps: [
        "add the new right-side item",
        "repair by moving the left boundary",
      ],
      examples: [
        {
          title: "Longest valid substring",
          context_label: "API rate limiting",
          seen_at: "2026-09-20T12:00:00Z",
        },
        {
          title: "Recent fraud-event window",
          context_label: "Recent fraud-event window",
          seen_at: "2026-09-21T12:00:00Z",
        },
      ],
    },
    ...overrides,
  };
}

export function familyInsightsResponseFixture(
  insights: FamilyInsightDto[] = [familyInsightFixture()],
): FamilyInsightsResponse {
  return {
    track_id: "dsa-track",
    track_version: "dsa-v1",
    insights,
  };
}
