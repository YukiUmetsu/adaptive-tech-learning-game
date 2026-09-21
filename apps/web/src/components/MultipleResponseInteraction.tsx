import { useState } from "react";

import type { Choice } from "../api/types";
import InlineText from "./InlineText";

interface MultipleResponseInteractionProps {
  choices: Choice[];
  /** Number of options the learner must select. */
  requiredSelections: number;
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/**
 * Choose an exact set of options.
 *
 * Real checkboxes give keyboard and screen-reader semantics for free. The
 * learner may select fewer than required (they may return later), but cannot
 * select more: attempting to over-select is blocked with a clear, announced
 * message rather than silently accepting an impossible answer.
 */
export default function MultipleResponseInteraction({
  choices,
  requiredSelections,
  value,
  disabled = false,
  onChange,
}: MultipleResponseInteractionProps) {
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const selected = new Set(value);
  const atLimit = value.length >= requiredSelections;

  const toggle = (id: string) => {
    if (selected.has(id)) {
      setLimitMessage(null);
      onChange(value.filter((entry) => entry !== id));
      return;
    }
    if (atLimit) {
      setLimitMessage(
        `You can select up to ${requiredSelections}. Deselect an answer first.`,
      );
      return;
    }
    setLimitMessage(null);
    onChange([...value, id]);
  };

  return (
    <fieldset className="choice-group" disabled={disabled}>
      {/* The requirement is announced for assistive tech and authored visibly
          as the question instruction; it is not shown as extra chrome. */}
      <legend className="sr-only">Choose {requiredSelections} answers</legend>
      <ul className="item-list choice-list">
        {choices.map((choice) => {
          const isSelected = selected.has(choice.id);
          return (
            <li key={choice.id}>
              <label
                className={`choice-option${isSelected ? " choice-option--selected" : ""}${
                  !isSelected && atLimit ? " choice-option--blocked" : ""
                }`}
              >
                <input
                  className="choice-input"
                  type="checkbox"
                  value={choice.id}
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggle(choice.id)}
                />
                <span className="choice-marker" aria-hidden="true" />
                <span className="choice-label">
                  <InlineText text={choice.label} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Only surfaces if the learner tries to select more than allowed. */}
      {limitMessage ? (
        <p className="choice-limit-message" role="status">
          {limitMessage}
        </p>
      ) : null}
    </fieldset>
  );
}
