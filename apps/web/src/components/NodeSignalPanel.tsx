import type { EvidenceLevel, FreshnessState, KnowledgeNode } from "../api/types";
import { assessmentModeLabel, type NodeVisual } from "../state/knowledgeSignal";

interface NodeSignalPanelProps {
  node: KnowledgeNode;
  domainName: string;
  moduleTitle: string;
  visual: NodeVisual;
  onExplore: () => void;
  onClose: () => void;
}

/** Plain-language evidence label; never a percentage or mastery claim. */
function evidenceLabel(level: EvidenceLevel): string {
  switch (level) {
    case "none":
      return "No practice yet";
    case "early":
      return "Building";
    case "developing":
      return "Developing";
    case "substantial":
      return "Strong";
    default:
      return "No practice yet";
  }
}

/** Plain-language freshness label; never negative. */
function freshnessLabel(state: FreshnessState): string {
  switch (state) {
    case "fresh":
      return "Fresh";
    case "becoming_due":
      return "Coming up";
    case "due":
      return "A refresh would help";
    default:
      return "Not enough practice yet";
  }
}

/**
 * Compact node detail shown beside (desktop) or below (mobile) the map.
 *
 * Assessment modes are only described here, never as permanent labels on every
 * node. Numeric estimates are never shown.
 */
export default function NodeSignalPanel({
  node,
  domainName,
  moduleTitle,
  visual,
  onExplore,
  onClose,
}: NodeSignalPanelProps) {
  return (
    <aside className="node-panel" aria-label={`${node.title} details`}>
      <header className="node-panel-head">
        <div>
          <p className="node-panel-domain">{domainName}</p>
          <h3>{node.title}</h3>
          <p className="muted node-panel-module">{moduleTitle}</p>
        </div>
        <button
          type="button"
          className="node-panel-close"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </header>

      {visual.recommended ? (
        <p className="node-panel-next">✦ Recommended next</p>
      ) : null}

      {visual.modes.length > 0 ? (
        <ul className="node-panel-modes" aria-label="Assessment modes">
          {visual.modes.map((mode) => (
            <li key={mode.assessment_mode}>
              <span
                className={`node-mode-ring node-mode-ring--${mode.evidence_level} node-mode-ring--${mode.freshness_state}`}
                aria-hidden="true"
              />
              <span className="node-mode-label">
                {assessmentModeLabel(mode.assessment_mode)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted node-panel-empty">
          No practice yet. Explore this topic to get started.
        </p>
      )}

      <dl className="node-panel-meta">
        <div>
          <dt>Evidence</dt>
          <dd>{evidenceLabel(visual.evidence)}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{freshnessLabel(visual.freshness)}</dd>
        </div>
      </dl>

      <button type="button" className="primary node-panel-explore" onClick={onExplore}>
        Explore this topic
      </button>
    </aside>
  );
}
