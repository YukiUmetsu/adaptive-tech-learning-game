import type { Choice } from "../api/types";
import InlineText from "./InlineText";

interface EvidenceSelectionInteractionProps {
  evidence: Choice[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/**
 * Select the evidence sources relevant to an operational question.
 *
 * Multiple selections are allowed. Cards are toggle buttons so the interaction
 * works with a tap, a click, or the keyboard; selection is never communicated by
 * color alone.
 */
export default function EvidenceSelectionInteraction({
  evidence,
  value,
  disabled = false,
  onChange,
}: EvidenceSelectionInteractionProps) {
  const selected = new Set(value);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(value.filter((entry) => entry !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div className="selection" role="group" aria-label="Evidence sources">
      <p className="muted">
        Select every source that can help answer the question. Selecting an
        irrelevant source lowers your score.
      </p>

      <ul className="item-list selection-grid">
        {evidence.map((option) => {
          const isSelected = selected.has(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                className="item-chip selection-card"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => toggle(option.id)}
              >
                <span className="selection-marker" aria-hidden="true">
                  {isSelected ? "✓" : "○"}
                </span>
                <span>
                  <InlineText text={option.label} terms={[]} />
                </span>
                <span className="sr-only">
                  {isSelected ? "selected" : "not selected"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted" aria-live="polite">
        {value.length} selected
      </p>
    </div>
  );
}
