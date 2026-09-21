import type {
  AnswerPayload,
  CanonicalAnswer,
  QuestionView,
} from "../api/types";
import { typedAnswerMatches } from "../lib/typedBlank";

export type ReviewKind = "missing" | "invalid" | "wrong";

export interface ReviewDetail {
  kind: ReviewKind;
  text: string;
}

/**
 * Number of directed connections in a canonical `node_connection` answer.
 *
 * Returns `null` for any other interaction type. Used to tell the learner how
 * many relationships a correct answer requires.
 */
export function canonicalConnectionCount(
  canonical: CanonicalAnswer,
): number | null {
  if (canonical.type !== "node_connection") {
    return null;
  }
  return canonical.edges.filter((edge) => edge.length === 2).length;
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

  if (
    interaction.type === "reconstruction" &&
    canonical.type === "reconstruction"
  ) {
    const submittedAnswer = submitted.reconstruction;
    if (!submittedAnswer) {
      return [];
    }

    const labels = new Map<string, string>();
    for (const node of interaction.fixed_nodes) {
      labels.set(node.id, node.label);
    }
    for (const piece of interaction.pieces) {
      labels.set(piece.id, piece.label);
    }
    const label = (id: string) => labels.get(id) ?? id;
    const required = new Set(Object.values(canonical.placements));
    const placed = new Set(Object.values(submittedAnswer.placements));
    const details: ReviewDetail[] = [];

    if (interaction.layout === "linear") {
      // Slot order is the structure, so report the exact position mistakes.
      interaction.slots.forEach((slot, index) => {
        const expected = canonical.placements[slot.id];
        const chosen = submittedAnswer.placements[slot.id];
        if (chosen === expected) {
          return;
        }
        const position = `Step ${index + 1}`;
        if (!chosen) {
          details.push({
            kind: "missing",
            text: `${position}: “${label(expected)}”`,
          });
        } else if (required.has(chosen)) {
          details.push({
            kind: "wrong",
            text: `${position}: “${label(chosen)}” should be “${label(expected)}”`,
          });
        } else {
          details.push({
            kind: "invalid",
            text: `${position}: “${label(chosen)}” is not part of the structure`,
          });
        }
      });
    }

    for (const piece of required) {
      if (!placed.has(piece)) {
        details.push({
          kind: "missing",
          text: `Missing component: ${label(piece)}`,
        });
      }
    }

    // In a graph, slot identity is not meaningful, so extra placed pieces are
    // reported without any per-slot "should be" guidance.
    if (interaction.layout === "graph") {
      for (const piece of placed) {
        if (!required.has(piece)) {
          details.push({
            kind: "invalid",
            text: `Not part of the structure: ${label(piece)}`,
          });
        }
      }
    }

    if (interaction.layout === "graph") {
      const key = (edge: string[]) => `${edge[0]}\u0000${edge[1]}`;
      const canonicalEdges = new Set((canonical.edges ?? []).map(key));
      const submittedEdges = new Set((submittedAnswer.edges ?? []).map(key));

      for (const edge of canonical.edges ?? []) {
        if (edge.length !== 2 || submittedEdges.has(key(edge))) {
          continue;
        }
        details.push({
          kind: "missing",
          text: `Missing relationship: ${label(edge[0])} → ${label(edge[1])}`,
        });
      }
      for (const edge of submittedAnswer.edges ?? []) {
        if (edge.length !== 2 || canonicalEdges.has(key(edge))) {
          continue;
        }
        details.push({
          kind: "invalid",
          text: `Not a valid relationship: ${label(edge[0])} → ${label(edge[1])}`,
        });
      }
    }

    return details;
  }

  if (
    interaction.type === "evidence_selection" &&
    canonical.type === "evidence_selection"
  ) {
    const selected = submitted.evidence_ids;
    if (!selected) {
      return [];
    }

    const labels = new Map(
      interaction.evidence.map((option) => [option.id, option.label]),
    );
    const label = (id: string) => labels.get(id) ?? id;
    const relevant = new Set(canonical.relevant_ids);
    const chosen = new Set(selected);
    const details: ReviewDetail[] = [];

    for (const id of canonical.relevant_ids) {
      if (!chosen.has(id)) {
        details.push({ kind: "missing", text: `Missing evidence: ${label(id)}` });
      }
    }
    for (const id of selected) {
      if (!relevant.has(id)) {
        details.push({
          kind: "invalid",
          text: `Not relevant here: ${label(id)}`,
        });
      }
    }

    return details;
  }

  if (
    interaction.type === "spot_the_fault" &&
    canonical.type === "spot_the_fault"
  ) {
    const selected = submitted.faulty_ids;
    if (!selected) {
      return [];
    }

    const labels = new Map(
      interaction.elements.map((element) => [element.id, element.label]),
    );
    const label = (id: string) => labels.get(id) ?? id;
    const faulty = new Set(canonical.faulty_ids);
    const chosen = new Set(selected);
    const details: ReviewDetail[] = [];

    for (const id of canonical.faulty_ids) {
      if (!chosen.has(id)) {
        details.push({ kind: "missing", text: `Fault missed: ${label(id)}` });
      }
    }
    for (const id of selected) {
      if (!faulty.has(id)) {
        details.push({
          kind: "invalid",
          text: `Not faulty: ${label(id)}`,
        });
      }
    }

    return details;
  }

  if (interaction.type === "fill_slots" && canonical.type === "fill_slots") {
    const values = submitted.slot_values;
    if (!values) {
      return [];
    }

    const optionLabels = new Map(
      interaction.options.map((option) => [option.id, option.label]),
    );
    const details: ReviewDetail[] = [];

    for (const slot of interaction.slots) {
      const expected = canonical.values[slot.id];
      const chosen = values[slot.id];
      if (chosen === expected) {
        continue;
      }
      const chosenLabel = chosen
        ? (optionLabels.get(chosen) ?? chosen)
        : "empty";
      const expectedLabel = optionLabels.get(expected) ?? expected;
      details.push({
        kind: chosen ? "wrong" : "missing",
        text: `${slot.label} — “${chosenLabel}”, should be “${expectedLabel}”`,
      });
    }

    return details;
  }

  if (
    (interaction.type === "troubleshooting" ||
      interaction.type === "scenario_choice_chain") &&
    (canonical.type === "troubleshooting" ||
      canonical.type === "scenario_choice_chain")
  ) {
    const path = submitted.choice_path;
    if (!path) {
      return [];
    }

    const labels = new Map<string, string>();
    for (const step of interaction.steps) {
      for (const choice of step.choices) {
        labels.set(choice.id, choice.label);
      }
    }
    const label = (id: string | undefined) =>
      id ? (labels.get(id) ?? id) : "no decision";

    const expected = canonical.expected_path;
    const details: ReviewDetail[] = [];
    const length = Math.max(expected.length, path.length);

    for (let index = 0; index < length; index += 1) {
      const chosen = path[index];
      const want = expected[index];
      if (chosen === want) {
        continue;
      }
      if (!chosen) {
        details.push({
          kind: "missing",
          text: `Missing decision ${index + 1}: “${label(want)}”`,
        });
        continue;
      }
      if (!want) {
        details.push({
          kind: "invalid",
          text: `Extra decision ${index + 1}: “${label(chosen)}”`,
        });
        continue;
      }
      details.push({
        kind: "wrong",
        text: `Decision ${index + 1}: “${label(chosen)}” should be “${label(want)}”`,
      });
    }

    return details;
  }

  if (
    interaction.type === "configuration_builder" &&
    canonical.type === "configuration_builder"
  ) {
    const assignments = submitted.assignments;
    if (!assignments) {
      return [];
    }

    const slotLabels = new Map(
      interaction.slots.map((slot) => [slot.id, slot.label]),
    );
    const pieceLabels = new Map(
      interaction.pieces.map((piece) => [piece.id, piece.label]),
    );
    const details: ReviewDetail[] = [];

    for (const [slotId, expectedPiece] of Object.entries(
      canonical.assignments,
    )) {
      const chosen = assignments[slotId];
      if (chosen === expectedPiece) {
        continue;
      }
      const slot = slotLabels.get(slotId) ?? slotId;
      const chosenLabel = chosen
        ? (pieceLabels.get(chosen) ?? chosen)
        : "empty";
      const expectedLabel = pieceLabels.get(expectedPiece) ?? expectedPiece;
      details.push({
        kind: chosen ? "wrong" : "missing",
        text: `${slot} — “${chosenLabel}”, should be “${expectedLabel}”`,
      });
    }

    return details;
  }

  if (
    interaction.type === "two_dimensional_placement" &&
    canonical.type === "two_dimensional_placement"
  ) {
    const points = submitted.positions;
    if (!points) {
      return [];
    }

    const labels = new Map(interaction.items.map((item) => [item.id, item.label]));
    const details: ReviewDetail[] = [];

    for (const item of interaction.items) {
      const label = labels.get(item.id) ?? item.id;
      const point = points[item.id];
      if (!point) {
        details.push({ kind: "missing", text: `${label} — not placed` });
        continue;
      }
      const region = canonical.regions[item.id];
      const xOk =
        region &&
        region.x.length === 2 &&
        point.x >= region.x[0] &&
        point.x <= region.x[1];
      const yOk =
        region &&
        region.y.length === 2 &&
        point.y >= region.y[0] &&
        point.y <= region.y[1];
      if (!xOk) {
        details.push({
          kind: "wrong",
          text: `${label} — check its position on ${interaction.x_axis.label}`,
        });
      }
      if (!yOk) {
        details.push({
          kind: "wrong",
          text: `${label} — check its position on ${interaction.y_axis.label}`,
        });
      }
    }

    return details;
  }

  if (
    interaction.type === "command_assembly" &&
    canonical.type === "command_assembly"
  ) {
    const values = submitted.token_values;
    if (!values) {
      return [];
    }

    const tokenLabels = new Map(
      interaction.tokens.map((token) => [token.id, token.label]),
    );
    const details: ReviewDetail[] = [];

    for (const slot of interaction.slots) {
      const expected = canonical.values[slot.id];
      const chosen = values[slot.id];
      if (chosen === expected) {
        continue;
      }
      const chosenLabel = chosen
        ? (tokenLabels.get(chosen) ?? chosen)
        : "empty";
      const expectedLabel = tokenLabels.get(expected) ?? expected;
      details.push({
        kind: chosen ? "wrong" : "missing",
        text: `${slot.label} — “${chosenLabel}”, should be “${expectedLabel}”`,
      });
    }

    return details;
  }

  if (
    interaction.type === "typed_fill_blank" &&
    canonical.type === "typed_fill_blank"
  ) {
    const values = submitted.typed_answers;
    if (!values) {
      return [];
    }

    const details: ReviewDetail[] = [];

    for (const slot of interaction.slots) {
      const accepted = canonical.answers[slot.id]?.accepted_answers ?? [];
      const typed = values[slot.id] ?? "";
      if (typedAnswerMatches(typed, accepted)) {
        continue;
      }
      const expected = accepted.join(" / ");
      details.push(
        typed.trim().length > 0
          ? {
              kind: "wrong",
              text: `${slot.label} — “${typed.trim()}”, expected “${expected}”`,
            }
          : { kind: "missing", text: `${slot.label} — expected “${expected}”` },
      );
    }

    return details;
  }

  return [];
}
