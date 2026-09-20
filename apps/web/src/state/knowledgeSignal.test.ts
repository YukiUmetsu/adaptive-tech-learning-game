import { describe, expect, it } from "vitest";

import type { NodeProgressDto } from "../api/types";
import {
  deriveNodeVisual,
  describeNodeVisual,
  discoveryVisual,
  NEUTRAL_VISUAL,
} from "./knowledgeSignal";

function signal(overrides: Partial<NodeProgressDto> = {}): NodeProgressDto {
  return {
    node_id: "n1",
    discovery_state: "unexplored",
    evidence_level: "none",
    freshness_state: "unknown",
    mode_signals: [],
    ...overrides,
  };
}

describe("discoveryVisual", () => {
  it("maps local node states to discovery dimensions", () => {
    expect(discoveryVisual("ready")).toBe("unexplored");
    expect(discoveryVisual("locked")).toBe("unexplored");
    expect(discoveryVisual("in_progress")).toBe("explored");
    expect(discoveryVisual("unlocked")).toBe("completed");
  });
});

describe("deriveNodeVisual", () => {
  it("renders a neutral node without signal data", () => {
    const visual = deriveNodeVisual("n1", "ready", undefined, null);
    expect(visual).toEqual(NEUTRAL_VISUAL);
  });

  it("uses discovery from local state even when the signal says otherwise", () => {
    // Local discovery is authoritative for the discovery dimension.
    const visual = deriveNodeVisual(
      "n1",
      "in_progress",
      signal({ discovery_state: "completed" }),
      null,
    );
    expect(visual.discovery).toBe("explored");
  });

  it("keeps mode signals separate and preserves evidence/freshness", () => {
    const visual = deriveNodeVisual(
      "n1",
      "unlocked",
      signal({
        evidence_level: "substantial",
        freshness_state: "due",
        mode_signals: [
          { assessment_mode: "recall", evidence_level: "substantial", freshness_state: "due" },
          { assessment_mode: "application", evidence_level: "early", freshness_state: "fresh" },
        ],
      }),
      null,
    );
    expect(visual.evidence).toBe("substantial");
    expect(visual.freshness).toBe("due");
    expect(visual.modes).toHaveLength(2);
    expect(visual.modes[0].assessment_mode).toBe("recall");
    expect(visual.modes[1].assessment_mode).toBe("application");
  });

  it("marks only the recommended node", () => {
    expect(deriveNodeVisual("n1", "ready", undefined, "n1").recommended).toBe(true);
    expect(deriveNodeVisual("n2", "ready", undefined, "n1").recommended).toBe(false);
  });
});

describe("describeNodeVisual", () => {
  it("describes an unexplored node without negative labels", () => {
    const text = describeNodeVisual("Metrics", NEUTRAL_VISUAL).toLowerCase();
    expect(text).toContain("not explored yet");
    for (const forbidden of ["weak", "bad", "fail", "master", "percent", "%"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("keeps stale strong knowledge visibly learned", () => {
    const visual = deriveNodeVisual(
      "n1",
      "unlocked",
      signal({ evidence_level: "substantial", freshness_state: "due" }),
      null,
    );
    const text = describeNodeVisual("Metrics", visual).toLowerCase();
    expect(text).toContain("strong evidence");
    expect(text).toContain("a refresh would help");
    // The node is never described as lost or deficient.
    expect(text).not.toContain("lost");
    expect(text).not.toContain("weak");
    expect(text).not.toContain("master");
  });

  it("mentions the recommendation when present", () => {
    const visual = deriveNodeVisual("n1", "ready", undefined, "n1");
    expect(describeNodeVisual("Metrics", visual)).toContain("recommended next");
  });
});
