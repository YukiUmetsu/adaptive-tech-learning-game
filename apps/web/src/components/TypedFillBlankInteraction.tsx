import type { TypedBlankSlot, TypedFillContent } from "../api/types";
import type { TypedBlankStatus } from "../lib/typedBlank";
import TypedCodeTemplate from "./TypedCodeTemplate";
import TypedTableTemplate from "./TypedTableTemplate";
import TypedTextTemplate from "./TypedTextTemplate";

interface TypedFillBlankInteractionProps {
  /** Explicit presentation context: prose, code, or table. */
  content: TypedFillContent;
  /** Blanks referenced anywhere in the content. */
  slots: TypedBlankSlot[];
  /** Slot id to the learner's typed answer. */
  value: Record<string, string>;
  disabled?: boolean;
  /** Per-blank correctness derived from server feedback, when available. */
  statuses?: Record<string, TypedBlankStatus>;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Type the missing word, phrase, service, value, or code into inline blanks.
 *
 * Dispatch is driven by the authored, tagged `content` type rather than by
 * guessing from a string, so prose, syntax-highlighted code, and tables each
 * render deterministically. All blanks keep the learner's text after
 * submission so the existing feedback panel can compare it with the canonical
 * answer.
 */
export default function TypedFillBlankInteraction({
  content,
  slots,
  value,
  disabled = false,
  statuses,
  onChange,
}: TypedFillBlankInteractionProps) {
  if (content.type === "code") {
    return (
      <TypedCodeTemplate
        language={content.language}
        template={content.template}
        slots={slots}
        value={value}
        disabled={disabled}
        statuses={statuses}
        onChange={onChange}
      />
    );
  }

  if (content.type === "table") {
    return (
      <TypedTableTemplate
        columns={content.columns}
        rows={content.rows}
        slots={slots}
        value={value}
        disabled={disabled}
        statuses={statuses}
        onChange={onChange}
      />
    );
  }

  return (
    <TypedTextTemplate
      template={content.template}
      slots={slots}
      value={value}
      disabled={disabled}
      statuses={statuses}
      onChange={onChange}
    />
  );
}
