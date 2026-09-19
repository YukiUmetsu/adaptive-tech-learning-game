import type { TypedBlankSlot } from "../api/types";
import type { TypedBlankStatus } from "../lib/typedBlank";

interface TypedBlankInputProps {
  slot: TypedBlankSlot;
  value: string;
  disabled?: boolean;
  status?: TypedBlankStatus;
  onChange: (next: string) => void;
}

/**
 * A single inline blank.
 *
 * Shared by prose, code, and table presentations so the input, keyboard
 * behavior, accessible name, and correctness treatment stay identical. The
 * input grows with its value up to a cap so long answers never break layout.
 */
export default function TypedBlankInput({
  slot,
  value,
  disabled = false,
  status,
  onChange,
}: TypedBlankInputProps) {
  const size = Math.min(Math.max(value.length + 1, 6), 24);

  return (
    <span className={`typed-blank${status ? ` ${status}` : ""}`}>
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
