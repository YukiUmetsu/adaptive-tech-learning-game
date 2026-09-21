import { memo } from "react";

import { stripInlineCode } from "../lib/inlineCode";
import { describeNodeVisual, type NodeVisual } from "../state/knowledgeSignal";
import InlineText from "./InlineText";

interface KnowledgeNodeGlyphProps {
  nodeId: string;
  title: string;
  visual: NodeVisual;
  selected: boolean;
  reducedMotion: boolean;
  onSelect: (nodeId: string) => void;
}

/**
 * One Knowledge Signal node on the track map.
 *
 * The three signal dimensions are conveyed with CSS only — discovery as the
 * center, evidence as fill intensity, freshness as the outer ring — plus small
 * mode pips. No color-only meaning: the accessible label always describes the
 * state in words, and a legend is rendered alongside the map.
 *
 * Memoized so a selection change does not rerender every node on the map.
 */
function KnowledgeNodeGlyph({
  nodeId,
  title,
  visual,
  selected,
  reducedMotion,
  onSelect,
}: KnowledgeNodeGlyphProps) {
  const modePips = visual.modes.slice(0, 4);

  return (
    <button
      type="button"
      className={[
        "signal-node",
        `signal-node--${visual.discovery}`,
        `signal-node--evidence-${visual.evidence}`,
        `signal-node--fresh-${visual.freshness}`,
        visual.recommended ? "signal-node--recommended" : "",
        selected ? "signal-node--selected" : "",
        reducedMotion ? "signal-node--reduced" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={describeNodeVisual(stripInlineCode(title), visual)}
      aria-pressed={selected}
      onClick={() => onSelect(nodeId)}
    >
      <span className="signal-node-orbit" aria-hidden="true" />
      <span className="signal-node-ring" aria-hidden="true" />
      <span className="signal-node-core" aria-hidden="true" />
      {visual.recommended ? (
        <>
          <span className="signal-node-spark" aria-hidden="true">
            ✦
          </span>
          <span className="signal-node-next" aria-hidden="true">
            Next
          </span>
        </>
      ) : null}
      {modePips.length > 0 ? (
        <span className="signal-node-modes" aria-hidden="true">
          {modePips.map((mode) => (
            <i
              key={mode.assessment_mode}
              className={`signal-pip signal-pip--${mode.evidence_level}`}
            />
          ))}
        </span>
      ) : null}
      <span className="signal-node-label">
        <InlineText text={title} />
      </span>
    </button>
  );
}

export default memo(KnowledgeNodeGlyph);
