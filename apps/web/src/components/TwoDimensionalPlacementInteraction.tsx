import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  Choice,
  PlacementAxis,
  PlacementPoint,
} from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import InlineText from "./InlineText";
import { clampPlacement } from "../lib/placement";

interface TwoDimensionalPlacementInteractionProps {
  xAxis: PlacementAxis;
  yAxis: PlacementAxis;
  items: Choice[];
  value: Record<string, PlacementPoint>;
  disabled?: boolean;
  onChange: (next: Record<string, PlacementPoint>) => void;
}

const ITEM_PREFIX = "placement-item:";
const CENTER: PlacementPoint = { x: 0.5, y: 0.5 };

/**
 * Place items on a two-axis conceptual map by dragging them onto it.
 *
 * Drag an item from the palette onto the map (or tap an item then tap the map),
 * and drag a placed marker to move it. Markers are clamped so they never cross
 * the map boundary. For keyboard use, focus a marker and nudge it with the arrow
 * keys (hold Shift for larger steps). Canonical answers are tolerant regions,
 * not exact pixels.
 */
export default function TwoDimensionalPlacementInteraction({
  xAxis,
  yAxis,
  items,
  value,
  disabled = false,
  onChange,
}: TwoDimensionalPlacementInteractionProps) {
  const planeRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggingRef = useRef<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const planeSize = () => {
    const rect = planeRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };

  const markerSize = (itemId: string) => {
    const marker = markerRefs.current.get(itemId);
    return {
      width: marker?.offsetWidth ?? 72,
      height: marker?.offsetHeight ?? 32,
    };
  };

  /** Clamps and commits a fractional position for an item. */
  const setPoint = (itemId: string, x: number, y: number) => {
    const plane = planeSize();
    const marker = markerSize(itemId);
    const clamped = clampPlacement(
      x,
      y,
      plane.width,
      plane.height,
      marker.width,
      marker.height,
    );
    onChange({ ...value, [itemId]: clamped });
  };

  /** Converts a pointer position to a clamped fractional position. */
  const pointFromClient = (
    itemId: string,
    clientX: number,
    clientY: number,
  ): PlacementPoint | null => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const marker = markerSize(itemId);
    return clampPlacement(
      (clientX - rect.left) / rect.width,
      1 - (clientY - rect.top) / rect.height,
      rect.width,
      rect.height,
      marker.width,
      marker.height,
    );
  };

  const onMarkerPointerDown =
    (itemId: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      draggingRef.current = itemId;
      setSelectedItem(itemId);
    };

  const onMarkerPointerMove =
    (itemId: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || draggingRef.current !== itemId) {
        return;
      }
      const point = pointFromClient(itemId, event.clientX, event.clientY);
      if (point) {
        onChange({ ...value, [itemId]: point });
      }
    };

  const onMarkerPointerUp = () => {
    draggingRef.current = null;
  };

  const onMarkerKeyDown =
    (itemId: string) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      let dx = 0;
      let dy = 0;
      switch (event.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = step;
          break;
        case "ArrowDown":
          dy = -step;
          break;
        default:
          return;
      }
      event.preventDefault();
      const current = value[itemId] ?? CENTER;
      setPoint(itemId, current.x + dx, current.y + dy);
    };

  return (
    <div className="placement">
      <div
        ref={planeRef}
        className={
          dropActive ? "placement-map drop-active" : "placement-map"
        }
        role="group"
        aria-label={`${stripInlineCode(xAxis.label)} and ${stripInlineCode(yAxis.label)} placement area`}
        onDragOver={(event) => {
          if (!disabled) {
            event.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropActive(false);
          if (disabled) {
            return;
          }
          const data = event.dataTransfer.getData("text/plain");
          if (!data.startsWith(ITEM_PREFIX)) {
            return;
          }
          const itemId = data.slice(ITEM_PREFIX.length);
          if (!items.some((item) => item.id === itemId)) {
            return;
          }
          const point = pointFromClient(itemId, event.clientX, event.clientY);
          if (point) {
            onChange({ ...value, [itemId]: point });
          }
          setSelectedItem(itemId);
        }}
        onClick={(event) => {
          if (disabled || event.target !== event.currentTarget || !selectedItem) {
            return;
          }
          const point = pointFromClient(selectedItem, event.clientX, event.clientY);
          if (point) {
            onChange({ ...value, [selectedItem]: point });
          }
        }}
      >
        <span className="placement-axis-label placement-axis-top">
          {yAxis.high_label}
        </span>
        <span className="placement-axis-label placement-axis-bottom">
          {yAxis.low_label}
        </span>
        <span className="placement-axis-label placement-axis-left">
          {xAxis.low_label}
        </span>
        <span className="placement-axis-label placement-axis-right">
          {xAxis.high_label}
        </span>

        {items.map((item) => {
          const point = value[item.id];
          if (!point) {
            return null;
          }
          return (
            <button
              key={item.id}
              type="button"
              ref={(element) => {
                if (element) {
                  markerRefs.current.set(item.id, element);
                } else {
                  markerRefs.current.delete(item.id);
                }
              }}
              className="placement-marker"
              style={{
                left: `${point.x * 100}%`,
                top: `${(1 - point.y) * 100}%`,
              }}
              aria-pressed={selectedItem === item.id}
              aria-label={`${stripInlineCode(item.label)} on ${stripInlineCode(xAxis.label)} and ${stripInlineCode(yAxis.label)}`}
              disabled={disabled}
              onPointerDown={onMarkerPointerDown(item.id)}
              onPointerMove={onMarkerPointerMove(item.id)}
              onPointerUp={onMarkerPointerUp}
              onPointerCancel={onMarkerPointerUp}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedItem(item.id);
              }}
              onKeyDown={onMarkerKeyDown(item.id)}
            >
              <InlineText text={item.label} />
            </button>
          );
        })}
      </div>
      <div>
        <h3>{items.some((item) => value[item.id]) ? "Items" : "Drag an item onto the map"}</h3>
        <ul className="item-list placement-palette" aria-label="Items to place">
          {items.map((item) => {
            const isPlaced = value[item.id] !== undefined;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="item-chip"
                  aria-pressed={selectedItem === item.id}
                  disabled={disabled}
                  draggable={!disabled}
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "text/plain",
                      `${ITEM_PREFIX}${item.id}`,
                    )
                  }
                  onClick={() => {
                    if (!isPlaced) {
                      setPoint(item.id, CENTER.x, CENTER.y);
                    }
                    setSelectedItem(item.id);
                  }}
                >
                  <InlineText text={item.label} />
                  {isPlaced ? (
                    <span className="muted"> · placed</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
