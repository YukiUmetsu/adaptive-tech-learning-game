import type { TypedBlankSlot } from "../api/types";
import { parseTypedText } from "../lib/typedBlank";

interface TypedFillBlankInteractionProps {
  /** Authored sentence containing `{{slot_id}}` placeholders. */
  text: string;
  /** Blanks referenced by the text. */
  slots: TypedBlankSlot[];
  /** Slot id to the learner's typed answer. */
  value: Record<string, string>;
  disabled?: boolean;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Type the missing word, phrase, service, concept, or value into inline blanks.
 *
 * Blanks render in sentence order, follow the authored `{{slot_id}}` positions,
 * stay editable by keyboard, and keep the learner's text after submission so
 * the existing feedback panel can compare it with the canonical answer.
 */
export default function TypedFillBlankInteraction({
  text,
  slots,
  value,
  disabled = false,
  onChange,
}: TypedFillBlankInteractionProps) {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const segments = parseTypedText(text);

  const setValue = (slotId: string, next: string) => {
    onChange({ ...value, [slotId]: next });
  };

  return (
    <div className="typed-fill-blank">
      <p className="typed-fill-sentence">
        {segments.map((segment, index) => {
          if (segment.kind === "text") {
            return <span key={`text-${index}`}>{segment.text}</span>;
          }

          const slot = slotById.get(segment.slotId);
          return (
            <input
              key={`slot-${segment.slotId}`}
              type="text"
              className="typed-blank-input"
              value={value[segment.slotId] ?? ""}
              disabled={disabled}
              placeholder={slot?.placeholder || "Type…"}
              aria-label={slot?.label ?? segment.slotId}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setValue(segment.slotId, event.target.value)}
            />
          );
        })}
      </p>
    </div>
  );
}
