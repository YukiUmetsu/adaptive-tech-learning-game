import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { GraphNode } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import InlineText from "./InlineText";
import {
  boundaryOffset as boundaryOffsetFor,
  edgeGeometry as lineGeometry,
  type NodeSize,
} from "../lib/connection";

interface NodeConnectionInteractionProps {
  nodes: GraphNode[];
  value: string[][];
  disabled?: boolean;
  onChange: (next: string[][]) => void;
}

const SNAP_PX = 64;

/**
 * Connect nodes with directed relationships.
 *
 * Primary flow is tactile: pointer down stretches a preview line and a nearby
 * target snaps. The accessible flow is select source, then select target.
 */
export default function NodeConnectionInteraction({
  nodes,
  value,
  disabled = false,
  onChange,
}: NodeConnectionInteractionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeElements = useRef(new Map<string, HTMLButtonElement>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [nodeSizes, setNodeSizes] = useState<Record<string, NodeSize>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const moved = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Measure rendered node sizes so edges can stop at the node boundary instead
  // of hiding the arrowhead underneath a wide pill.
  useEffect(() => {
    const measured: Record<string, NodeSize> = {};
    nodeElements.current.forEach((element, id) => {
      measured[id] = {
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    });

    setNodeSizes((current) => {
      const nextIds = Object.keys(measured);
      const currentIds = Object.keys(current);
      const unchanged =
        nextIds.length === currentIds.length &&
        nextIds.every(
          (id) =>
            current[id]?.width === measured[id].width &&
            current[id]?.height === measured[id].height,
        );
      return unchanged ? current : measured;
    });
  }, [nodes, size.width, size.height]);

  const positionOf = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node) {
      return null;
    }
    return { x: node.x * size.width, y: node.y * size.height };
  };

  const boundaryOffset = (nodeId: string, ux: number, uy: number) =>
    boundaryOffsetFor(nodeSizes[nodeId], ux, uy);

  const hasEdge = (from: string, to: string) =>
    value.some((edge) => edge[0] === from && edge[1] === to);

  const toggleEdge = (from: string, to: string) => {
    if (from === to) {
      return;
    }
    if (hasEdge(from, to)) {
      onChange(value.filter((edge) => !(edge[0] === from && edge[1] === to)));
    } else {
      onChange([...value, [from, to]]);
    }
  };

  const relativePoint = (
    event: ReactPointerEvent,
  ): { x: number; y: number } | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const nearestNode = (point: { x: number; y: number }, exclude: string) => {
    let best: string | null = null;
    let bestDistance = SNAP_PX;
    for (const node of nodes) {
      if (node.id === exclude) {
        continue;
      }
      const dx = node.x * size.width - point.x;
      const dy = node.y * size.height - point.y;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node.id;
      }
    }
    return best;
  };

  const edgeGeometry = (from: string, to: string) => {
    const start = positionOf(from);
    const end = positionOf(to);
    if (!start || !end) {
      return null;
    }
    return lineGeometry(start, end, nodeSizes[from], nodeSizes[to]);
  };

  const previewGeometry = (from: string, point: { x: number; y: number }) => {
    const start = positionOf(from);
    if (!start) {
      return null;
    }
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    const offset = Math.min(boundaryOffset(from, ux, uy), distance / 2);
    return {
      x1: start.x + ux * offset,
      y1: start.y + uy * offset,
      x2: point.x,
      y2: point.y,
    };
  };

  return (
    <div className="connection">
      <p className="muted">
        Select a source node, then a target node — or drag from one node to
        another. Connections are directed (source → target).
      </p>

      <div className="graph" ref={containerRef}>
        <svg
          className="graph-edges"
          width={size.width}
          height={size.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="connection-arrow"
              markerWidth="14"
              markerHeight="14"
              refX="11"
              refY="7"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L14,7 L0,14 z" className="arrow-head" />
            </marker>
          </defs>

          {value.map(([from, to]) => {
            const geometry = edgeGeometry(from, to);
            if (!geometry) {
              return null;
            }
            return (
              <g key={`${from}->${to}`}>
                <line
                  {...geometry}
                  className="edge-hit"
                  onClick={() => {
                    if (!disabled) {
                      toggleEdge(from, to);
                    }
                  }}
                />
                <line
                  {...geometry}
                  className="edge-line"
                  markerEnd="url(#connection-arrow)"
                />
              </g>
            );
          })}

          {dragFrom && pointer
            ? (() => {
                const geometry = previewGeometry(dragFrom, pointer);
                return geometry ? (
                  <line
                    {...geometry}
                    className="edge-preview"
                    markerEnd="url(#connection-arrow)"
                  />
                ) : null;
              })()
            : null}
        </svg>

        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            ref={(element) => {
              if (element) {
                nodeElements.current.set(node.id, element);
              } else {
                nodeElements.current.delete(node.id);
              }
            }}
            className={[
              "graph-node",
              selected === node.id ? "selected" : "",
              hover === node.id ? "snap" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
            aria-pressed={selected === node.id}
            disabled={disabled}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if (selected === null) {
                setSelected(node.id);
              } else if (selected === node.id) {
                setSelected(null);
              } else {
                toggleEdge(selected, node.id);
                setSelected(null);
              }
            }}
            onPointerDown={(event) => {
              if (disabled) {
                return;
              }
              if (typeof event.currentTarget.setPointerCapture === "function") {
                event.currentTarget.setPointerCapture(event.pointerId);
              }
              suppressClick.current = false;
              setDragFrom(node.id);
              moved.current = false;
              dragStart.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              if (!dragFrom) {
                return;
              }
              if (
                dragStart.current &&
                Math.hypot(
                  event.clientX - dragStart.current.x,
                  event.clientY - dragStart.current.y,
                ) > 6
              ) {
                moved.current = true;
              }
              const point = relativePoint(event);
              if (point) {
                setPointer(point);
                setHover(nearestNode(point, dragFrom));
              }
            }}
            onPointerUp={() => {
              if (!dragFrom) {
                return;
              }
              if (moved.current && hover && hover !== dragFrom) {
                toggleEdge(dragFrom, hover);
                suppressClick.current = true;
              }
              setDragFrom(null);
              setPointer(null);
              setHover(null);
              dragStart.current = null;
            }}
            onPointerCancel={() => {
              setDragFrom(null);
              setPointer(null);
              setHover(null);
              dragStart.current = null;
            }}
          >
            <InlineText text={node.label} />
          </button>
        ))}
      </div>

      <ul className="connection-list" aria-label="Connections">
        {value.length === 0 ? (
          <li className="muted">No connections yet.</li>
        ) : (
          value.map(([from, to]) => (
            <li key={`${from}->${to}`}>
              <span>
                <span className="edge-chip">
                  <InlineText text={nodeById.get(from)?.label ?? from} />
                </span>
                <span aria-hidden="true" className="edge-arrow">
                  →
                </span>
                <span className="edge-chip">
                  <InlineText text={nodeById.get(to)?.label ?? to} />
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove connection ${stripInlineCode(
                  nodeById.get(from)?.label ?? from,
                )} to ${stripInlineCode(nodeById.get(to)?.label ?? to)}`}
                onClick={() => toggleEdge(from, to)}
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
