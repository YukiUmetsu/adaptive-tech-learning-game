import type { TypedBlankSlot } from "../api/types";
import type { TypedBlankStatus } from "../lib/typedBlank";

interface TypedBlankInputProps {
  slot: TypedBlankSlot;
  value: string;
  disabled?: boolean;
  status?: TypedBlankStatus;
  onChange: (next: string) => void;
}

/** Minimum characters for an auto-growing blank that authors no width hint. */
const DEFAULT_MIN_CHARS = 6;
/** Upper bound for an auto-growing blank so long answers cannot break layout. */
const DEFAULT_MAX_CHARS = 24;
/** Visible rows for a multi-line blank that authors no row hint. */
const DEFAULT_ROWS = 3;
/** Approximate column count for a multi-line blank that authors no width hint. */
const DEFAULT_MULTILINE_COLS = 40;

/**
 * A single inline blank.
 *
 * Shared by prose, code, and table presentations so the input, keyboard
 * behavior, accessible name, and correctness treatment stay identical.
 *
 * Presentation is driven only by optional authored hints:
 * - no hints: the historical auto-growing single-line input,
 * - `width_chars`: sets the starting/minimum visible width, still growing with
 *   the learner's text up to a safe cap,
 * - `multiline`: renders a `<textarea>` sized by `rows`, so larger answers can
 *   be typed comfortably.
 *
 * These hints never change what counts as correct; the server grades the same
 * `typed_answers` payload regardless of presentation.
 */
export default function TypedBlankInput({
  slot,
  value,
  disabled = false,
  status,
  onChange,
}: TypedBlankInputProps) {
  const multiline = slot.multiline === true;

  // An authored width is a floor. The blank still grows with its value, but
  // never wider than the larger of the historical cap and the authored floor.
  const minChars = slot.width_chars ?? DEFAULT_MIN_CHARS;
  const size = Math.min(
    Math.max(value.length + 1, minChars),
    Math.max(DEFAULT_MAX_CHARS, minChars),
  );

  const stateClass = status ? ` ${status}` : "";

  return (
    <span
      className={`typed-blank${multiline ? " typed-blank--multiline" : ""}${stateClass}`}
    >
      {multiline ? (
        <textarea
          className="typed-blank-input typed-blank-textarea"
          rows={slot.rows ?? DEFAULT_ROWS}
          cols={slot.width_chars ?? DEFAULT_MULTILINE_COLS}
          value={value}
          disabled={disabled}
          placeholder={slot.placeholder || "Type…"}
          aria-label={slot.label}
          aria-invalid={status === "incorrect" ? true : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type="text"
          className="typed-blank-input"
          size={size}
          value={value}
          disabled={disabled}
          placeholder={slot.placeholder || "Type…"}
          aria-label={slot.label}
          aria-invalid={status === "incorrect" ? true : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {status ? (
        <span className="typed-blank-status" aria-hidden="true">
          {status === "correct" ? "✓" : "✕"}
        </span>
      ) : null}
      {status ? (
        <span className="sr-only">{`${slot.label} is ${status}`}</span>
      ) : null}
    </span>
  );
}
