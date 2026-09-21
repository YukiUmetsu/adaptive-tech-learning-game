import { useMemo } from "react";

import type { NodeProgressDto, TrackMapResponse } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import { deriveNodeVisual, type NodeVisual } from "../state/knowledgeSignal";
import type { DerivedLearningState } from "../state/learningProgress";
import InlineText from "./InlineText";
import KnowledgeNodeGlyph from "./KnowledgeNodeGlyph";

interface TrackKnowledgeMapProps {
  map: TrackMapResponse;
  /** Domain currently shown. Falls back to the first domain. */
  activeDomainId: string | null;
  signals: Map<string, NodeProgressDto>;
  /** Local discovery-derived state per domain id. */
  derivedByDomain: Record<string, DerivedLearningState>;
  selectedNodeId: string | null;
  recommendedNodeId: string | null;
  reducedMotion: boolean;
  onSelectNode: (nodeId: string, domainId: string) => void;
}

/**
 * One domain's Knowledge Map: a constellation of nodes grouped by module and
 * connected in authored order.
 *
 * Only the active domain is rendered so the map stays readable and never
 * becomes an overwhelming wall of nodes. Discovery comes from local progress
 * (always current), while evidence and freshness come from the optional
 * aggregate signal. When the signal is missing the map still renders as a plain
 * discovery map.
 *
 * Node visuals are precomputed so a selection change does not rebuild every
 * node's visual and memoized glyphs only rerender when their own state changes.
 */
export default function TrackKnowledgeMap({
  map,
  activeDomainId,
  signals,
  derivedByDomain,
  selectedNodeId,
  recommendedNodeId,
  reducedMotion,
  onSelectNode,
}: TrackKnowledgeMapProps) {
  const domain =
    map.domains.find((candidate) => candidate.domain.id === activeDomainId) ??
    map.domains[0];

  const visuals = useMemo(() => {
    const result = new Map<string, NodeVisual>();
    if (!domain) {
      return result;
    }
    const derived = derivedByDomain[domain.domain.id];
    for (const module of domain.modules) {
      for (const node of module.nodes) {
        result.set(
          node.id,
          deriveNodeVisual(
            node.id,
            derived?.nodeState[node.id] ?? "ready",
            signals.get(node.id),
            recommendedNodeId,
          ),
        );
      }
    }
    return result;
  }, [domain, signals, derivedByDomain, recommendedNodeId]);

  if (!domain) {
    return null;
  }

  return (
    <div
      className="track-map"
      aria-label={`${stripInlineCode(domain.domain.name)} Knowledge Map`}
    >
      {domain.modules.map((module) => {
        const ordered = [...module.nodes].sort(
          (a, b) =>
            a.map_position.y - b.map_position.y ||
            a.map_position.x - b.map_position.x,
        );
        return (
          <div key={module.id} className="track-map-module">
            <p className="track-map-module-title">
              <InlineText text={module.title} />
            </p>
            <ol className="track-map-nodes" role="list">
              {ordered.map((node, index) => {
                const visual = visuals.get(node.id);
                if (!visual) {
                  return null;
                }
                const previous = index > 0 ? visuals.get(ordered[index - 1].id) : null;
                const connectorLit =
                  previous !== undefined &&
                  previous !== null &&
                  (previous.discovery !== "unexplored" ||
                    previous.evidence !== "none");

                return (
                  <li key={node.id} className="track-map-node">
                    {index > 0 ? (
                      <span
                        className={`track-map-connector${
                          connectorLit ? " track-map-connector--lit" : ""
                        }`}
                        aria-hidden="true"
                      />
                    ) : null}
                    <KnowledgeNodeGlyph
                      nodeId={node.id}
                      title={node.title}
                      visual={visual}
                      selected={selectedNodeId === node.id}
                      reducedMotion={reducedMotion}
                      onSelect={(nodeId) => onSelectNode(nodeId, domain.domain.id)}
                    />
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
