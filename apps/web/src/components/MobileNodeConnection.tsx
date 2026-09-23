import { useEffect, useMemo, useState } from "react";

import type { GraphNode } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import {
  addEdge,
  hasEdge,
  nodeLabelMap,
  removeEdge,
  wellFormedEdges,
} from "../lib/nodeConnection";
import InlineText from "./InlineText";

export interface MobileNodeConnectionProps {
  nodes: GraphNode[];
  value: string[][];
  disabled?: boolean;
  onChange: (next: string[][]) => void;
  /**
   * Optional starting source, chosen by the question for this phone flow.
   *
   * This is a deliberate mobile-only scaffold: it seeds the first "Connect FROM"
   * choice so the learner does not have to re-scan every node before making the
   * first decision. It is only ever a source node id — never a target or an
   * edge — so the rest of the relationship stays unstated. The learner can
   * change the source at any time.
   */
  startNodeId?: string;
}

interface AddedEdge {
  from: string;
  to: string;
}

/**
 * Decorative trash glyph for the mobile remove control.
 *
 * The button keeps an explicit `aria-label`, so the icon itself is hidden from
 * assistive technology. Styling is inherited from `currentColor`.
 */
function TrashIcon() {
  return (
    <svg
      className="connection-remove-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * Narrow-screen `node_connection` renderer.
 *
 * The desktop graph needs the learner to hold every node and crossing line in
 * mind at once. On a phone that is unreadable, so this replaces it with a
 * one-decision-at-a-time builder: pick a source, pick a destination, review the
 * compact list, repeat. There are no SVG/canvas lines here.
 *
 * It writes the same `string[][]` `[from, to]` answer state as the desktop
 * graph; only the presentation differs. Adding a connection only ever means
 * "connected"; correctness is decided later by the shared scorer.
 */
export default function MobileNodeConnection({
  nodes,
  value,
  disabled = false,
  onChange,
  startNodeId,
}: MobileNodeConnectionProps) {
  const nodeById = useMemo(() => nodeLabelMap(nodes), [nodes]);

  // The question's starting source, only when it names a real node.
  const resolvedStart = useMemo(
    () =>
      startNodeId && nodes.some((node) => node.id === startNodeId)
        ? startNodeId
        : null,
    [nodes, startNodeId],
  );

  const [selectedSource, setSelectedSource] = useState<string | null>(
    () => resolvedStart,
  );
  const [justAdded, setJustAdded] = useState<AddedEdge | null>(null);

  // A question change (or a re-authored node set) must not keep a stale source;
  // it resets to the new question's starting point, if any.
  const nodeKey = nodes.map((node) => node.id).join("|");
  useEffect(() => {
    setSelectedSource(resolvedStart);
    setJustAdded(null);
  }, [nodeKey, resolvedStart]);

  const source =
    selectedSource && nodeById.has(selectedSource) ? selectedSource : null;

  const destinations = useMemo(
    () => nodes.filter((node) => node.id !== source),
    [nodes, source],
  );

  const summary = useMemo(() => wellFormedEdges(value), [value]);

  const labelFor = (id: string) => nodeById.get(id) ?? id;

  const selectSource = (id: string) => {
    setSelectedSource(id);
    setJustAdded(null);
  };

  const chooseDifferentSource = () => {
    setSelectedSource(null);
    setJustAdded(null);
  };

  const addConnection = (from: string, to: string) => {
    const next = addEdge(value, from, to);
    if (next === value) {
      return;
    }
    onChange(next);
    setJustAdded({ from, to });
    // Reset the selection after each relationship so the learner starts the
    // next one from a clean "Connect FROM" list instead of carrying over the
    // previous source and destination.
    setSelectedSource(null);
  };

  const removeConnection = (from: string, to: string) => {
    onChange(removeEdge(value, from, to));
    if (justAdded && justAdded.from === from && justAdded.to === to) {
      setJustAdded(null);
    }
  };

  const status = justAdded
    ? `Connection added: ${stripInlineCode(labelFor(justAdded.from))} to ${stripInlineCode(labelFor(justAdded.to))}`
    : source
      ? `Connect from: ${stripInlineCode(labelFor(source))}. Choose a destination.`
      : "";

  // When the question supplies a starting source, say so plainly. Once the
  // learner has added or changed anything, fall back to the generic prompt.
  const showStartHint =
    source !== null &&
    source === resolvedStart &&
    summary.length === 0 &&
    justAdded === null;

  const hint = showStartHint
    ? `Select connection from ${stripInlineCode(labelFor(source))}.`
    : source
      ? "Choose where this connects."
      : "Choose where a connection starts.";

  return (
    <div className="connection connection-mobile">
      <p className="muted connection-hint">{hint}</p>

      <p className="connection-status" role="status" aria-live="polite">
        {status}
      </p>

      {source === null ? (
        <div className="connection-step">
          <h4 className="connection-step-label">Connect FROM</h4>
          <ul className="connection-choices" aria-label="Connect from">
            {nodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="connection-choice"
                  aria-pressed={source === node.id}
                  disabled={disabled}
                  onClick={() => selectSource(node.id)}
                >
                  <InlineText text={node.label} terms={[]} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="connection-step">
          <h4 className="connection-step-label">Connect FROM</h4>
          <div className="connection-source" aria-label="Selected source">
            <span className="connection-source-label">
              <InlineText text={labelFor(source)} terms={[]} />
            </span>
          </div>

          <h4 className="connection-step-label">Connect TO</h4>
          <ul className="connection-choices" aria-label="Connect to">
            {destinations.map((node) => {
              const connected = hasEdge(value, source, node.id);
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className={
                      connected
                        ? "connection-choice connected"
                        : "connection-choice"
                    }
                    aria-label={
                      connected
                        ? `${stripInlineCode(node.label)}, already connected`
                        : undefined
                    }
                    disabled={disabled || connected}
                    onClick={() => addConnection(source, node.id)}
                  >
                    <InlineText text={node.label} terms={[]} />
                    {connected ? (
                      <span className="connection-choice-state" aria-hidden="true">
                        ✓ Added
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="connection-add-another"
            disabled={disabled}
            onClick={chooseDifferentSource}
          >
            Choose different source
          </button>
        </div>
      )}

      {justAdded ? (
        <div className="connection-confirmation" role="presentation">
          <span className="connection-confirmation-title">✓ Connection added</span>
          <span className="connection-edge">
            <span className="edge-chip">
              <InlineText text={labelFor(justAdded.from)} terms={[]} />
            </span>
            <span aria-hidden="true" className="edge-arrow">
              →
            </span>
            <span className="edge-chip">
              <InlineText text={labelFor(justAdded.to)} terms={[]} />
            </span>
          </span>
        </div>
      ) : null}

      <div className="connection-review">
        <h4 className="connection-step-label">Your connections</h4>
        {summary.length === 0 ? (
          <p className="muted">No connections yet.</p>
        ) : (
          <ul className="connection-list" aria-label="Your connections">
            {summary.map(([from, to]) => (
              <li key={`${from}->${to}`}>
                <span className="connection-edge">
                  <span className="edge-chip">
                    <InlineText text={labelFor(from)} terms={[]} />
                  </span>
                  <span aria-hidden="true" className="edge-arrow">
                    →
                  </span>
                  <span className="edge-chip">
                    <InlineText text={labelFor(to)} terms={[]} />
                  </span>
                </span>
                <button
                  type="button"
                  className="connection-remove"
                  disabled={disabled}
                  aria-label={`Remove connection from ${stripInlineCode(
                    labelFor(from),
                  )} to ${stripInlineCode(labelFor(to))}`}
                  onClick={() => removeConnection(from, to)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
