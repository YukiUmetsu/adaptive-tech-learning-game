import { useState } from "react";

import type { Choice, FillSlot } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import InlineText from "./InlineText";

interface FillSlotsInteractionProps {
  slots: FillSlot[];
  options: Choice[];
  value: Record<string, string>;
  disabled?: boolean;
  onChange: (next: Record<string, string>) => void;
  /** Heading for the option pool. Defaults to "Values". */
  optionsLabel?: string;
  /** Heading for the slot list. Defaults to "Blanks to fill". */
  slotsLabel?: string;
}

/**
 * Fill constrained blanks by choosing from a fixed option set.
 *
 * Drag an option onto a blank, or select an option and then activate a blank.
 * Blanks can be cleared. No free-form text is graded, and the flow works by tap,
 * click, drag, or keyboard. The same primitive is reused for
 * `configuration_builder` and `command_assembly`.
 */
export default function FillSlotsInteraction({
  slots,
  options,
  value,
  disabled = false,
  onChange,
  optionsLabel = "Values",
  slotsLabel = "Blanks to fill",
}: FillSlotsInteractionProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const optionById = new Map(options.map((option) => [option.id, option]));

  const placeOption = (slotId: string, optionId: string | null) => {
    if (!optionId || !optionById.has(optionId)) {
      return;
    }
    onChange({ ...value, [slotId]: optionId });
    setSelectedOption(null);
  };

  const clear = (slotId: string) => {
    const next = { ...value };
    delete next[slotId];
    onChange(next);
  };

  return (
    <div className="fill-slots">
      <div className="classification-pool" role="group" aria-label="Available values">
        <h3>{optionsLabel}</h3>
        <ul className="item-list">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="item-chip"
                aria-pressed={selectedOption === option.id}
                disabled={disabled}
                draggable={!disabled}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/plain", option.id)
                }
                onClick={() =>
                  setSelectedOption(
                    selectedOption === option.id ? null : option.id,
                  )
                }
              >
                <InlineText text={option.label} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ol className="fill-slot-list" aria-label={slotsLabel}>
        {slots.map((slot) => {
          const chosen = value[slot.id];
          const chosenLabel = chosen
            ? (optionById.get(chosen)?.label ?? chosen)
            : "Empty";
          return (
            <li
              key={slot.id}
              className={
                dropSlot === slot.id
                  ? "fill-slot-row drop-target"
                  : "fill-slot-row"
              }
              data-slot-id={slot.id}
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={() => setDropSlot(slot.id)}
              onDragLeave={() =>
                setDropSlot((current) => (current === slot.id ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                setDropSlot(null);
                placeOption(slot.id, event.dataTransfer.getData("text/plain"));
              }}
            >
              <span className="fill-slot-label">
                <InlineText text={slot.label} />
              </span>
              <button
                type="button"
                className="fill-slot-value"
                aria-label={`${stripInlineCode(slot.label)}: ${stripInlineCode(chosenLabel)}`}
                disabled={disabled || selectedOption === null}
                onClick={() => placeOption(slot.id, selectedOption)}
              >
                <InlineText text={chosenLabel} />
              </button>
              <button
                type="button"
                className="fill-slot-clear"
                aria-label={`Clear ${stripInlineCode(slot.label)}`}
                disabled={disabled || !chosen}
                onClick={() => clear(slot.id)}
              >
                Clear
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
