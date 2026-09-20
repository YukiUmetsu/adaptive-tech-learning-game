import type { CanonicalAnswer, Interaction } from "../api/types";

/**
 * Read-only rendering helpers for canonical answers.
 *
 * Canonical answers reference raw ids; the interaction payload carries the
 * learner-facing labels. These helpers build an id → label index generically so
 * review screens can show readable content without per-interaction code.
 */

/** Recursively collects `{ id, label }` pairs from an interaction payload. */
export function labelIndex(interaction: Interaction): Record<string, string> {
  const index: Record<string, string> = {};
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && typeof record.label === "string") {
        index[record.id] = record.label;
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(interaction);
  return index;
}

/** One readable line of a canonical answer. */
export interface AnswerLine {
  /** Optional left-hand label (slot, step, item). */
  label?: string;
  /** Right-hand value. */
  value: string;
}

/** Formats a canonical answer into readable lines using known labels. */
export function formatCanonicalAnswer(
  answer: CanonicalAnswer,
  labels: Record<string, string>,
): AnswerLine[] {
  const name = (id: string): string => labels[id] ?? id;

  switch (answer.type) {
    case "classification":
      return Object.entries(answer.placements).map(([item, category]) => ({
        label: name(item),
        value: name(category),
      }));
    case "ordering":
      return answer.ordered_ids.map((id, index) => ({
        label: `${index + 1}`,
        value: name(id),
      }));
    case "node_connection":
      return answer.edges.map(([from, to]) => ({
        label: name(from),
        value: `→ ${name(to)}`,
      }));
    case "reconstruction":
      return [
        ...Object.entries(answer.placements).map(([slot, piece]) => ({
          label: name(slot),
          value: name(piece),
        })),
        ...(answer.edges ?? []).map(([from, to]) => ({
          label: name(from),
          value: `→ ${name(to)}`,
        })),
      ];
    case "evidence_selection":
      return answer.relevant_ids.map((id) => ({ value: name(id) }));
    case "spot_the_fault":
      return answer.faulty_ids.map((id) => ({ value: name(id) }));
    case "fill_slots":
      return Object.entries(answer.values).map(([slot, value]) => ({
        label: name(slot),
        value: name(value),
      }));
    case "troubleshooting":
    case "scenario_choice_chain":
      return answer.expected_path.map((id, index) => ({
        label: `${index + 1}`,
        value: name(id),
      }));
    case "configuration_builder":
      return Object.entries(answer.assignments).map(([slot, piece]) => ({
        label: name(slot),
        value: name(piece),
      }));
    case "two_dimensional_placement":
      return Object.entries(answer.regions).map(([item, region]) => ({
        label: name(item),
        value: `x ${region.x.join("–")}, y ${region.y.join("–")}`,
      }));
    case "command_assembly":
      return Object.entries(answer.values).map(([slot, token]) => ({
        label: name(slot),
        value: name(token),
      }));
    case "typed_fill_blank":
      return Object.entries(answer.answers).map(([slot, value]) => ({
        label: name(slot),
        value: value.accepted_answers.join(" / "),
      }));
    default:
      return [];
  }
}
