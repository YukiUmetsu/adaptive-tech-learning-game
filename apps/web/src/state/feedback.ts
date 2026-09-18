import type {
  AnswerPayload,
  CanonicalAnswer,
  QuestionView,
} from "../api/types";

export type ReviewKind = "missing" | "invalid" | "wrong";

export interface ReviewDetail {
  kind: ReviewKind;
  text: string;
}

/**
 * Turns a submitted answer and the canonical answer into specific, learner-safe
 * review notes. Used for immediate corrective feedback.
 */
export function reviewDetails(
  question: QuestionView,
  submitted: AnswerPayload | null,
  canonical: CanonicalAnswer,
): ReviewDetail[] {
  if (!submitted) {
    return [];
  }

  const interaction = question.interaction;

  if (
    interaction.type === "classification" &&
    canonical.type === "classification"
  ) {
    const placements = submitted.placements;
    if (!placements) {
      return [];
    }

    const categoryLabels = new Map(
      interaction.categories.map((category) => [category.id, category.label]),
    );
    const details: ReviewDetail[] = [];

    for (const item of interaction.items) {
      const expected = canonical.placements[item.id];
      const chosen = placements[item.id];
      if (chosen === expected) {
        continue;
      }
      const chosenLabel = chosen
        ? (categoryLabels.get(chosen) ?? chosen)
        : "not placed";
      const expectedLabel = categoryLabels.get(expected) ?? expected;
      details.push({
        kind: "wrong",
        text: `${item.label} — placed in “${chosenLabel}”, should be “${expectedLabel}”`,
      });
    }

    return details;
  }

  if (interaction.type === "ordering" && canonical.type === "ordering") {
    const ordered = submitted.ordered_ids;
    if (!ordered) {
      return [];
    }

    const labels = new Map(
      interaction.items.map((item) => [item.id, item.label]),
    );
    const details: ReviewDetail[] = [];

    canonical.ordered_ids.forEach((expectedId, index) => {
      const chosenId = ordered[index];
      if (chosenId === expectedId) {
        return;
      }
      const chosen = chosenId ? (labels.get(chosenId) ?? chosenId) : "missing";
      const expected = labels.get(expectedId) ?? expectedId;
      details.push({
        kind: "wrong",
        text: `Position ${index + 1}: “${chosen}” should be “${expected}”`,
      });
    });

    return details;
  }

  if (
    interaction.type === "node_connection" &&
    canonical.type === "node_connection"
  ) {
    const edges = submitted.edges;
    if (!edges) {
      return [];
    }

    const labels = new Map(interaction.nodes.map((node) => [node.id, node.label]));
    const label = (id: string) => labels.get(id) ?? id;
    const key = (edge: string[]) => `${edge[0]}\u0000${edge[1]}`;
    const canonicalKeys = new Set(canonical.edges.map(key));
    const submittedKeys = new Set(edges.map(key));
    const details: ReviewDetail[] = [];

    for (const edge of canonical.edges) {
      if (edge.length !== 2) {
        continue;
      }
      if (!submittedKeys.has(key(edge))) {
        details.push({
          kind: "missing",
          text: `Missing connection: ${label(edge[0])} → ${label(edge[1])}`,
        });
      }
    }

    for (const edge of edges) {
      if (edge.length !== 2) {
        continue;
      }
      if (!canonicalKeys.has(key(edge))) {
        details.push({
          kind: "invalid",
          text: `Not a valid connection: ${label(edge[0])} → ${label(edge[1])}`,
        });
      }
    }

    return details;
  }

  return [];
}
