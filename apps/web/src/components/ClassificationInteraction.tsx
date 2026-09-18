import { useMemo, useState } from "react";

import type { Choice } from "../api/types";

interface ClassificationInteractionProps {
  items: Choice[];
  categories: Choice[];
  value: Record<string, string>;
  disabled?: boolean;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Classify items into categories.
 *
 * Supports both drag-and-drop and an accessible select-then-place flow:
 * activate an item, then activate a category's place button.
 */
export default function ClassificationInteraction({
  items,
  categories,
  value,
  disabled = false,
  onChange,
}: ClassificationInteractionProps) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const place = (itemId: string, categoryId: string) => {
    onChange({ ...value, [itemId]: categoryId });
    setSelectedItem(null);
  };

  const unplaced = items.filter((item) => !value[item.id]);

  return (
    <div className="classification">
      <div className="classification-pool" role="group" aria-label="Unplaced items">
        <h3>Unplaced</h3>
        {unplaced.length === 0 ? (
          <p className="muted">Every item is placed.</p>
        ) : (
          <ul className="item-list">
            {unplaced.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="item-chip"
                  aria-pressed={selectedItem === item.id}
                  disabled={disabled}
                  draggable={!disabled}
                  onClick={() =>
                    setSelectedItem(selectedItem === item.id ? null : item.id)
                  }
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="classification-categories">
        {categories.map((category) => {
          const placed = items.filter(
            (item) => value[item.id] === category.id,
          );
          return (
            <section
              key={category.id}
              className="classification-category"
              role="group"
              aria-label={category.label}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const itemId = event.dataTransfer.getData("text/plain");
                if (itemId && itemById.has(itemId)) {
                  place(itemId, category.id);
                }
              }}
            >
              <h3>{category.label}</h3>
              <button
                type="button"
                className="place-button"
                disabled={disabled || selectedItem === null}
                onClick={() => {
                  if (selectedItem) {
                    place(selectedItem, category.id);
                  }
                }}
              >
                Place here
              </button>
              <ul className="item-list">
                {placed.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="item-chip placed"
                      aria-pressed={selectedItem === item.id}
                      disabled={disabled}
                      onClick={() =>
                        setSelectedItem(
                          selectedItem === item.id ? null : item.id,
                        )
                      }
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
