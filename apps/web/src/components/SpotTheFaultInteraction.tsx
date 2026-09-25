import type { Choice } from "../api/types";
import InlineText from "./InlineText";

interface SpotTheFaultInteractionProps {
  elements: Choice[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/**
 * Flag the faulty element(s) in an authored configuration.
 *
 * Each element is a toggle button so the interaction works with a tap, a click,
 * or the keyboard. The marker text (not only color) shows what is flagged.
 */
export default function SpotTheFaultInteraction({
  elements,
  value,
  disabled = false,
  onChange,
}: SpotTheFaultInteractionProps) {
  const selected = new Set(value);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(value.filter((entry) => entry !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div className="selection" role="group" aria-label="Configuration elements">
      <p className="muted">
        Inspect each element and flag every one that is faulty. Flagging a correct
        element lowers your score.
      </p>

      <ul className="item-list">
        {elements.map((element) => {
          const isSelected = selected.has(element.id);
          return (
            <li key={element.id}>
              <button
                type="button"
                className="item-chip selection-card fault-row"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => toggle(element.id)}
              >
                <span className="selection-marker" aria-hidden="true">
                  {isSelected ? "⚑" : "○"}
                </span>
                <span>
                  <InlineText text={element.label} terms={[]} />
                </span>
                <span className="sr-only">
                  {isSelected ? "flagged as faulty" : "not flagged"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted" aria-live="polite">
        {value.length} flagged
      </p>
    </div>
  );
}
