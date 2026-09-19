import { useMemo } from "react";

import type { TypedBlankSlot } from "../api/types";
import { parseTypedText, type TypedBlankStatus } from "../lib/typedBlank";
import TypedBlankInput from "./TypedBlankInput";

interface TypedTextTemplateProps {
  template: string;
  slots: TypedBlankSlot[];
  value: Record<string, string>;
  disabled?: boolean;
  statuses?: Record<string, TypedBlankStatus>;
  onChange: (next: Record<string, string>) => void;
}

/** Renders prose with inline blanks at each `{{slot_id}}` position. */
export default function TypedTextTemplate({
  template,
  slots,
  value,
  disabled = false,
  statuses,
  onChange,
}: TypedTextTemplateProps) {
  const slotById = useMemo(
    () => new Map(slots.map((slot) => [slot.id, slot])),
    [slots],
  );
  const segments = useMemo(() => parseTypedText(template), [template]);

  return (
    <p className="typed-fill-text">
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${index}`}>{segment.text}</span>;
        }

        const slot = slotById.get(segment.slotId);
        if (!slot) {
          return <span key={`slot-${index}`}>{`{{${segment.slotId}}}`}</span>;
        }

        return (
          <TypedBlankInput
            key={`slot-${segment.slotId}`}
            slot={slot}
            value={value[segment.slotId] ?? ""}
            disabled={disabled}
            status={statuses?.[segment.slotId]}
            onChange={(next) =>
              onChange({ ...value, [segment.slotId]: next })
            }
          />
        );
      })}
    </p>
  );
}
