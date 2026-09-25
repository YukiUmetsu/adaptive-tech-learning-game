import { useId } from "react";

import type { Choice } from "../api/types";
import InlineText from "./InlineText";

interface MultipleChoiceInteractionProps {
  choices: Choice[];
  value: string | null;
  disabled?: boolean;
  onChange: (next: string) => void;
}

/**
 * Choose exactly one option.
 *
 * A real radio group gives keyboard and screen-reader semantics for free.
 * Selection is communicated by the radio state and a check marker, never by
 * color alone.
 */
export default function MultipleChoiceInteraction({
  choices,
  value,
  disabled = false,
  onChange,
}: MultipleChoiceInteractionProps) {
  const name = useId();

  return (
    <fieldset className="choice-group" disabled={disabled}>
      <legend className="sr-only">Choose one answer</legend>
      <ul className="item-list choice-list">
        {choices.map((choice) => {
          const selected = choice.id === value;
          return (
            <li key={choice.id}>
              <label
                className={`choice-option${selected ? " choice-option--selected" : ""}`}
              >
                <input
                  className="choice-input"
                  type="radio"
                  name={name}
                  value={choice.id}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(choice.id)}
                />
                <span className="choice-marker" aria-hidden="true" />
                <span className="choice-label">
                  <InlineText text={choice.label} terms={[]} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
