import type { Choice } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import InlineText from "./InlineText";

interface OrderingInteractionProps {
  items: Choice[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/**
 * Arrange items in order.
 *
 * Move up/down buttons provide the keyboard-accessible path; drag-and-drop is
 * an optional enhancement.
 */
export default function OrderingInteraction({
  items,
  value,
  disabled = false,
  onChange,
}: OrderingInteractionProps) {
  const itemById = new Map(items.map((item) => [item.id, item]));

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) {
      return;
    }
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const drop = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    const next = [...value];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  return (
    <ol className="ordering" aria-label="Ordered steps">
      {value.map((id, index) => {
        const item = itemById.get(id);
        const label = item?.label ?? id;
        return (
          <li
            key={id}
            className="ordering-row"
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const from = Number(event.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from)) {
                drop(from, index);
              }
            }}
          >
            <span className="ordering-label">
              <InlineText text={label} />
            </span>
            <span className="ordering-controls">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`Move ${stripInlineCode(label)} up`}
                onClick={() => move(index, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                disabled={disabled || index === value.length - 1}
                aria-label={`Move ${stripInlineCode(label)} down`}
                onClick={() => move(index, 1)}
              >
                Move down
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
