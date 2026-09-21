import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import type {
  Choice,
  FixedNode,
  ReconstructionAnswerPayload,
  ReconstructionLayout,
  ReconstructionSlot,
} from "../api/types";
import { edgeGeometry as lineGeometry, type NodeSize } from "../lib/connection";
import { stripInlineCode } from "../lib/inlineCode";
import { stableShuffle } from "../lib/shuffle";
import InlineText from "./InlineText";

interface ReconstructionInteractionProps {
  layout: ReconstructionLayout;
  fixedNodes: FixedNode[];
  pieces: Choice[];
  slots: ReconstructionSlot[];
  value: ReconstructionAnswerPayload;
  disabled?: boolean;
  onChange: (next: ReconstructionAnswerPayload) => void;
}

interface CanvasNode {
  /** Unique render key. */
  key: string;
  /** Edge endpoint id (fixed node id or placed piece id), or null when empty. */
  edgeId: string | null;
  label: string;
  kind: "fixed" | "slot";
  slotId: string | null;
  x: number;
  y: number;
  filled: boolean;
}

const PIECE_PREFIX = "piece:";
const NODE_PREFIX = "node:";
const MOVE_PREFIX = "move:";

/**
 * Vertical headroom kept above the first row of graph nodes so a node's ↗
 * relationship handle is never clipped by the map's overflow. Applied to both
 * node placement and edge geometry so arrows still land on the nodes.
 */
const GRAPH_TOP_HEADROOM_PX = 40;

/**
 * Rebuild a structure by placing candidate pieces into a scaffold's slots.
 *
 * Linear scaffolds encode relationships in slot order, so arrows are drawn for
 * the learner and no edges are required. Graph scaffolds place nodes at
 * authored positions: the learner drops pieces into slots and draws
 * relationships by dragging source → target (or tapping source then target).
 * Free-form x/y positioning is never graded.
 */
export default function ReconstructionInteraction({
  layout,
  fixedNodes,
  pieces,
  slots,
  value,
  disabled = false,
  onChange,
}: ReconstructionInteractionProps) {
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [nodeSizes, setNodeSizes] = useState<Record<string, NodeSize>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggedRef = useRef(false);

  const placements = value.placements;
  const edges = value.edges ?? [];

  const labelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const node of fixedNodes) {
      labels.set(node.id, node.label);
    }
    for (const piece of pieces) {
      labels.set(piece.id, piece.label);
    }
    return labels;
  }, [fixedNodes, pieces]);

  const labelFor = (id: string) => labelById.get(id) ?? id;

  const fixedIds = useMemo(
    () => new Set(fixedNodes.map((node) => node.id)),
    [fixedNodes],
  );

  const seed = [...fixedNodes.map((node) => node.id), ...slots.map((slot) => slot.id)].join(
    ",",
  );

  // Pieces are shuffled deterministically so the palette order is stable across
  // renders but is not the authored (answer-revealing) order. Placed pieces
  // disappear from the palette.
  const palette = useMemo(() => {
    const used = new Set(Object.values(placements));
    return stableShuffle(
      pieces.filter((piece) => !used.has(piece.id)),
      seed,
    );
  }, [pieces, seed, placements]);

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
  }, [layout]);

  useEffect(() => {
    const measured: Record<string, NodeSize> = {};
    nodeRefs.current.forEach((element, key) => {
      measured[key] = {
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    });
    setNodeSizes((current) => {
      const nextKeys = Object.keys(measured);
      const currentKeys = Object.keys(current);
      const unchanged =
        nextKeys.length === currentKeys.length &&
        nextKeys.every(
          (key) =>
            current[key]?.width === measured[key].width &&
            current[key]?.height === measured[key].height,
        );
      return unchanged ? current : measured;
    });
  }, [layout, size.width, size.height, placements]);

  const canvasNodes = useMemo<CanvasNode[]>(() => {
    const fixed = fixedNodes.map((node) => ({
      key: `fixed:${node.id}`,
      edgeId: node.id,
      label: node.label,
      kind: "fixed" as const,
      slotId: null,
      x: node.x ?? 0.5,
      y: node.y ?? 0.15,
      filled: true,
    }));
    const slotNodes = slots.map((slot) => {
      const pieceId = placements[slot.id];
      return {
        key: `slot:${slot.id}`,
        edgeId: pieceId ?? null,
        label: pieceId
          ? (labelById.get(pieceId) ?? pieceId)
          : "Drop component",
        kind: "slot" as const,
        slotId: slot.id,
        x: slot.x ?? 0.5,
        y: slot.y ?? 0.5,
        filled: Boolean(pieceId),
      };
    });
    return [...fixed, ...slotNodes];
  }, [fixedNodes, slots, placements, labelById]);

  const replace = (
    nextPlacements: Record<string, string>,
    nextEdges: string[][],
  ) => {
    const present = new Set([...fixedIds, ...Object.values(nextPlacements)]);
    onChange({
      placements: nextPlacements,
      edges: nextEdges.filter(
        (edge) =>
          edge.length === 2 &&
          present.has(edge[0]) &&
          present.has(edge[1]),
      ),
    });
  };

  const place = (slotId: string, pieceId: string) => {
    if (!pieces.some((piece) => piece.id === pieceId)) {
      return;
    }
    const next = { ...placements };
    for (const [existingSlot, placed] of Object.entries(next)) {
      if (placed === pieceId) {
        delete next[existingSlot];
      }
    }
    next[slotId] = pieceId;
    replace(next, edges);
    setSelectedPiece(null);
  };

  const remove = (slotId: string) => {
    const next = { ...placements };
    delete next[slotId];
    replace(next, edges);
  };

  const toggleEdge = (from: string, to: string) => {
    if (from === to) {
      return;
    }
    const exists = edges.some((edge) => edge[0] === from && edge[1] === to);
    const next = exists
      ? edges.filter((edge) => !(edge[0] === from && edge[1] === to))
      : [...edges, [from, to]];
    replace(placements, next);
  };

  const paletteSection = (available: Choice[]) => (
    <div
      className="classification-pool"
      role="group"
      aria-label="Candidate components"
    >
      <h3>Components</h3>
      {available.length === 0 ? (
        <p className="muted">All components are placed.</p>
      ) : (
        <ul className="item-list">
          {available.map((piece) => (
            <li key={piece.id}>
              <button
                type="button"
                className="item-chip"
                aria-pressed={selectedPiece === piece.id}
                disabled={disabled}
                draggable={!disabled}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "text/plain",
                    `${PIECE_PREFIX}${piece.id}`,
                  )
                }
                onClick={() =>
                  setSelectedPiece(selectedPiece === piece.id ? null : piece.id)
                }
              >
                <InlineText text={piece.label} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const nodeDrop = (event: DragEvent, node: CanvasNode) => {
    event.preventDefault();
    setDropTarget(null);
    const data = event.dataTransfer.getData("text/plain");
    if (
      (data.startsWith(PIECE_PREFIX) || data.startsWith(MOVE_PREFIX)) &&
      node.kind === "slot" &&
      node.slotId
    ) {
      const pieceId = data.startsWith(PIECE_PREFIX)
        ? data.slice(PIECE_PREFIX.length)
        : data.slice(MOVE_PREFIX.length);
      place(node.slotId, pieceId);
      return;
    }
    if (data.startsWith(NODE_PREFIX) && node.edgeId) {
      toggleEdge(data.slice(NODE_PREFIX.length), node.edgeId);
    }
  };

  const bodyActivate = (node: CanvasNode) => {
    // Only slots can hold pieces; provided nodes are read-only context.
    if (node.kind !== "slot" || !node.slotId) {
      return;
    }
    if (selectedPiece) {
      place(node.slotId, selectedPiece);
      return;
    }
    if (node.filled) {
      remove(node.slotId);
    }
  };

  const handleActivate = (node: CanvasNode) => {
    if (!node.edgeId) {
      return;
    }
    setSelectedPiece(null);
    if (connectFrom === null) {
      setConnectFrom(node.edgeId);
      return;
    }
    if (connectFrom === node.edgeId) {
      setConnectFrom(null);
      return;
    }
    toggleEdge(connectFrom, node.edgeId);
    setConnectFrom(null);
  };

  if (layout === "graph") {
    // Clamp authored y positions into a band that leaves room for the handle,
    // so a node at the top of the map is never clipped.
    const verticalInset =
      size.height > GRAPH_TOP_HEADROOM_PX * 2
        ? GRAPH_TOP_HEADROOM_PX / size.height
        : 0.14;
    const topFraction = (y: number) => verticalInset + y * (1 - 2 * verticalInset);
    const positionOf = (node: CanvasNode) => ({
      x: node.x * size.width,
      y: topFraction(node.y) * size.height,
    });
    const nodeByEdgeId = new Map<string, CanvasNode>();
    for (const node of canvasNodes) {
      if (node.edgeId) {
        nodeByEdgeId.set(node.edgeId, node);
      }
    }
    const edgeLines = edges.flatMap((edge) => {
      if (edge.length !== 2) {
        return [];
      }
      const [from, to] = edge;
      const a = nodeByEdgeId.get(from);
      const b = nodeByEdgeId.get(to);
      if (!a || !b || a.key === b.key) {
        return [];
      }
      return [
        {
          key: `${from}->${to}`,
          from,
          to,
          geometry: lineGeometry(
            positionOf(a),
            positionOf(b),
            nodeSizes[a.key],
            nodeSizes[b.key],
          ),
        },
      ];
    });

    return (
      <div className="reconstruction reconstruction-graph">
        {paletteSection(palette)}

        <div className="reconstruction-canvas">
          <p className="muted">
            Drag a placed component onto another slot to move it, or click it to
            remove it. Drag a component&apos;s ↗ handle onto another component to
            create a relationship, or tap one handle then another.
          </p>
          <div className="reconstruction-map" ref={containerRef}>
            <svg
              className="graph-edges"
              width={size.width}
              height={size.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="reconstruction-arrow"
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
              {edgeLines.map((line) => (
                <g key={line.key}>
                  <line
                    {...line.geometry}
                    className="edge-hit"
                    onClick={() => {
                      if (!disabled) {
                        toggleEdge(line.from, line.to);
                      }
                    }}
                  />
                  <line
                    {...line.geometry}
                    className="edge-line"
                    markerEnd="url(#reconstruction-arrow)"
                  />
                </g>
              ))}
            </svg>

            {canvasNodes.map((node) => {
              const selected = Boolean(node.edgeId) && connectFrom === node.edgeId;
              const movable =
                node.kind === "slot" && node.filled && Boolean(node.edgeId);
              return (
                <div
                  key={node.key}
                  className="reconstruction-graph-node"
                  style={{ left: `${node.x * 100}%`, top: `${topFraction(node.y) * 100}%` }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragEnter={() => setDropTarget(node.key)}
                  onDragLeave={() =>
                    setDropTarget((current) =>
                      current === node.key ? null : current,
                    )
                  }
                  onDrop={(event) => nodeDrop(event, node)}
                >
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) {
                        nodeRefs.current.set(node.key, element);
                      } else {
                        nodeRefs.current.delete(node.key);
                      }
                    }}
                    className={[
                      "reconstruction-node-button",
                      node.kind === "fixed" ? "fixed" : "",
                      node.filled ? "filled" : "empty",
                      dropTarget === node.key ? "drop-target" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={
                      node.kind === "fixed"
                        ? `Provided component ${stripInlineCode(node.label)}`
                        : node.filled
                          ? `Placed component ${stripInlineCode(node.label)}; click to remove, drag to move`
                          : "Empty slot; drop a component here"
                    }
                    disabled={disabled}
                    draggable={!disabled && movable}
                    onDragStart={(event) => {
                      if (!movable || !node.edgeId) {
                        return;
                      }
                      draggedRef.current = true;
                      event.dataTransfer.setData(
                        "text/plain",
                        `${MOVE_PREFIX}${node.edgeId}`,
                      );
                    }}
                    onDragEnd={() => {
                      draggedRef.current = false;
                    }}
                    onClick={() => {
                      if (draggedRef.current) {
                        draggedRef.current = false;
                        return;
                      }
                      bodyActivate(node);
                    }}
                  >
                    <InlineText text={node.label} />
                  </button>

                  {node.edgeId ? (
                    <button
                      type="button"
                      className="reconstruction-handle"
                      aria-label={`Relationship from ${stripInlineCode(node.label)}`}
                      aria-pressed={selected}
                      disabled={disabled}
                      draggable={!disabled}
                      onDragStart={(event) => {
                        draggedRef.current = true;
                        event.dataTransfer.setData(
                          "text/plain",
                          `${NODE_PREFIX}${node.edgeId}`,
                        );
                      }}
                      onDragEnd={() => {
                        draggedRef.current = false;
                      }}
                      onClick={() => {
                        if (draggedRef.current) {
                          draggedRef.current = false;
                          return;
                        }
                        handleActivate(node);
                      }}
                    >
                      ↗
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {edges.length > 0 ? (
          <ul className="connection-list" aria-label="Relationships">
            {edges.map(([from, to]) => (
              <li key={`${from}->${to}`}>
                <span>
                  <span className="edge-chip">{labelFor(from)}</span>
                  <span aria-hidden="true" className="edge-arrow">
                    →
                  </span>
                  <span className="edge-chip">{labelFor(to)}</span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove relationship ${labelFor(from)} to ${labelFor(to)}`}
                  onClick={() => toggleEdge(from, to)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const slotButton = (slot: ReconstructionSlot, index: number) => {
    const placedPiece = placements[slot.id];
    const filled = Boolean(placedPiece);
    return (
      <button
        key={slot.id}
        type="button"
        className={
          filled ? "reconstruction-slot filled" : "reconstruction-slot empty"
        }
        aria-label={`Slot ${index + 1}: ${filled ? labelFor(placedPiece) : "empty"}`}
        disabled={disabled}
        draggable={!disabled && filled}
        onDragStart={(event) => {
          if (filled) {
            draggedRef.current = true;
            event.dataTransfer.setData(
              "text/plain",
              `${MOVE_PREFIX}${placedPiece}`,
            );
          }
        }}
        onDragEnd={() => {
          draggedRef.current = false;
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const data = event.dataTransfer.getData("text/plain");
          if (data.startsWith(PIECE_PREFIX)) {
            place(slot.id, data.slice(PIECE_PREFIX.length));
          } else if (data.startsWith(MOVE_PREFIX)) {
            place(slot.id, data.slice(MOVE_PREFIX.length));
          }
        }}
        onClick={() => {
          if (selectedPiece) {
            place(slot.id, selectedPiece);
          } else if (filled) {
            remove(slot.id);
          }
        }}
      >
        {filled ? labelFor(placedPiece) : "Drop component"}
      </button>
    );
  };

  const startNodes = fixedNodes.filter((node) => node.position === "start");
  const endNodes = fixedNodes.filter((node) => node.position === "end");

  return (
    <div className="reconstruction reconstruction-linear">
      <ol className="reconstruction-scaffold" aria-label="Reconstruction slots">
        {startNodes.map((node) => (
          <li key={node.id} className="reconstruction-step">
            <span className="reconstruction-node fixed">
              <InlineText text={node.label} />
            </span>
            <span className="reconstruction-arrow" aria-hidden="true">
              ↓
            </span>
          </li>
        ))}

        {slots.map((slot, index) => (
          <li key={slot.id} className="reconstruction-step">
            {slotButton(slot, index)}
            {placements[slot.id] ? (
              <button
                type="button"
                className="reconstruction-remove"
                aria-label={`Remove ${labelFor(placements[slot.id])} from slot ${index + 1}`}
                disabled={disabled}
                onClick={() => remove(slot.id)}
              >
                Remove
              </button>
            ) : null}
            {index < slots.length - 1 || endNodes.length > 0 ? (
              <span className="reconstruction-arrow" aria-hidden="true">
                ↓
              </span>
            ) : null}
          </li>
        ))}

        {endNodes.map((node) => (
          <li key={node.id} className="reconstruction-step">
            <span className="reconstruction-node fixed">
              <InlineText text={node.label} />
            </span>
          </li>
        ))}
      </ol>

      {paletteSection(palette)}
      <p className="muted">
        Select a component, then tap its slot — or drag it into place. Unused
        components are fine.
      </p>
    </div>
  );
}
