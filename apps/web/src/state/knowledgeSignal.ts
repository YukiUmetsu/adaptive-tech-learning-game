import type {
  EvidenceLevel,
  FreshnessState,
  ModeSignal,
  NodeProgressDto,
} from "../api/types";
import type { NodeState } from "./learningProgress";

/**
 * Knowledge Signal visual derivation.
 *
 * "Knowledge Signal" is a coarse, non-judgmental visualization. It is explicitly
 * not mastery: it never produces percentages, pass chances, or negative labels.
 * Three independent dimensions are combined:
 *
 * - discovery: whether the learner explored the node's learning content
 *   (from local discovery progress, which is always current on the client);
 * - evidence: how much scored evidence exists (from the aggregate progress API);
 * - freshness: whether that evidence is still retrievable (outer ring only).
 */

/** Discovery dimension, derived from local discovery progress. */
export type DiscoveryVisual = "unexplored" | "explored" | "completed";

/** The combined visual state for one knowledge node. */
export interface NodeVisual {
  discovery: DiscoveryVisual;
  evidence: EvidenceLevel;
  freshness: FreshnessState;
  modes: ModeSignal[];
  recommended: boolean;
}

/** A neutral visual for a node with no progress or signal data. */
export const NEUTRAL_VISUAL: NodeVisual = {
  discovery: "unexplored",
  evidence: "none",
  freshness: "unknown",
  modes: [],
  recommended: false,
};

/** Maps the local discovery node state to the discovery dimension. */
export function discoveryVisual(state: NodeState): DiscoveryVisual {
  switch (state) {
    case "unlocked":
      return "completed";
    case "in_progress":
      return "explored";
    default:
      return "unexplored";
  }
}

/**
 * Combines local discovery with an optional server signal.
 *
 * Discovery always comes from local progress so a reveal is visible instantly.
 * Evidence/freshness come from the aggregate signal; when it is missing the
 * node renders as a normal, un-decorated map node.
 */
export function deriveNodeVisual(
  nodeId: string,
  localState: NodeState,
  signal: NodeProgressDto | undefined,
  recommendedNodeId: string | null,
): NodeVisual {
  return {
    discovery: discoveryVisual(localState),
    evidence: signal?.evidence_level ?? "none",
    freshness: signal?.freshness_state ?? "unknown",
    modes: signal?.mode_signals ?? [],
    recommended: recommendedNodeId === nodeId,
  };
}

/** Plain-language, non-judgmental description for assistive technology. */
export function describeNodeVisual(title: string, visual: NodeVisual): string {
  const parts: string[] = [title];

  switch (visual.discovery) {
    case "completed":
      parts.push("explored");
      break;
    case "explored":
      parts.push("partly explored");
      break;
    case "unexplored":
      parts.push("not explored yet");
      break;
  }

  if (visual.evidence === "early") {
    parts.push("building evidence");
  } else if (visual.evidence === "developing") {
    parts.push("developing evidence");
  } else if (visual.evidence === "substantial") {
    parts.push("strong evidence");
  }

  if (visual.freshness === "becoming_due") {
    parts.push("review coming up");
  } else if (visual.freshness === "due") {
    parts.push("a refresh would help");
  }

  if (visual.recommended) {
    parts.push("recommended next");
  }

  return parts.join(", ");
}

/** Human label for one assessment mode, used only in the detail popover. */
export function assessmentModeLabel(mode: ModeSignal["assessment_mode"]): string {
  switch (mode) {
    case "recognition":
      return "Recognition";
    case "recall":
      return "Recall";
    case "application":
      return "Application";
    case "structural_reconstruction":
      return "Reconstruction";
    case "relationship_recall":
      return "Relationships";
    case "procedural_recall":
      return "Procedure";
    default:
      return "Practice";
  }
}
