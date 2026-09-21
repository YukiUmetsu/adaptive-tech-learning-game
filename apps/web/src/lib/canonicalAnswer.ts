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
  interaction?: Interaction,
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
      return orderedSlotLines(
        interaction?.type === "fill_slots" ? interaction.slots : undefined,
        answer.values,
        name,
      );
    case "troubleshooting":
    case "scenario_choice_chain":
      return answer.expected_path.map((id, index) => ({
        label: `${index + 1}`,
        value: name(id),
      }));
    case "configuration_builder":
      return orderedSlotLines(
        interaction?.type === "configuration_builder"
          ? interaction.slots
          : undefined,
        answer.assignments,
        name,
      );
    case "two_dimensional_placement":
      return Object.entries(answer.regions).map(([item, region]) => ({
        label: name(item),
        value: `x ${region.x.join("–")}, y ${region.y.join("–")}`,
      }));
    case "command_assembly":
      // Slot order is the command order, so it must not follow the map's key
      // order. Each line is a labelled token in the assembled sequence.
      return orderedSlotLines(
        interaction?.type === "command_assembly" ? interaction.slots : undefined,
        answer.values,
        name,
      );
    case "typed_fill_blank":
      return orderedSlotLines(
        interaction?.type === "typed_fill_blank" ? interaction.slots : undefined,
        Object.fromEntries(
          Object.entries(answer.answers).map(([slot, value]) => [
            slot,
            value.accepted_answers.join(" / "),
          ]),
        ),
        (id) => id,
      );
    case "multiple_choice":
      return [{ value: name(answer.choice_id) }];
    case "multiple_response":
      return answer.choice_ids.map((id) => ({ value: name(id) }));
    default:
      return [];
  }
}

/** Orders slot values by the interaction's authored slot order when known. */
function orderedSlotLines(
  slots: ReadonlyArray<{ id: string; label: string }> | undefined,
  values: Record<string, string>,
  name: (id: string) => string,
): AnswerLine[] {
  if (slots && slots.length > 0) {
    const lines: AnswerLine[] = [];
    for (const slot of slots) {
      const value = values[slot.id];
      if (value !== undefined) {
        lines.push({ label: slot.label, value: name(value) });
      }
    }
    return lines;
  }
  return Object.entries(values).map(([slot, value]) => ({
    label: name(slot),
    value: name(value),
  }));
}
