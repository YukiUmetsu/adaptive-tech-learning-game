import type { EvidenceLevel, FreshnessState, KnowledgeNode } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import { assessmentModeLabel, type NodeVisual } from "../state/knowledgeSignal";
import { ANSWER_REWARD_RANGE, DAILY_MISSION_BONUS_BITS } from "../state/rewards";
import InlineText from "./InlineText";

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
 * Compact, motivating node detail.
 *
 * Leads with the node's signal, then a reward hook, then one clear action.
 * Assessment modes are only described here. No percentages or negative labels.
 */
export default function NodeSignalPanel({
  node,
  domainName,
  moduleTitle,
  visual,
  onExplore,
  onClose,
}: NodeSignalPanelProps) {
  const hasData = visual.modes.length > 0 || visual.evidence !== "none";

  return (
    <aside
      className="node-panel"
      aria-label={`${stripInlineCode(node.title)} details`}
    >
      <button
        type="button"
        className="node-panel-close"
        onClick={onClose}
        aria-label="Close details"
      >
        ×
      </button>

      <div className="node-panel-hero">
        <span
          className={[
            "node-panel-badge",
            `signal-node--${visual.discovery}`,
            `signal-node--evidence-${visual.evidence}`,
            `signal-node--fresh-${visual.freshness}`,
          ].join(" ")}
          aria-hidden="true"
        >
          <span className="node-panel-badge-ring" />
          <span className="node-panel-badge-core" />
          {visual.recommended ? (
            <span className="node-panel-badge-spark">✦</span>
          ) : null}
        </span>

        <div className="node-panel-hero-text">
          <p className="node-panel-domain">
            <InlineText text={domainName} />
          </p>
          <h3>
            <InlineText text={node.title} />
          </h3>
          <p className="node-panel-module">
            <InlineText text={moduleTitle} />
          </p>
        </div>
      </div>

      {visual.recommended ? (
        <p className="node-panel-next">✦ Recommended next</p>
      ) : null}

      {hasData ? (
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
        <p className="node-panel-empty">
          ✨ A brand-new topic. Light it up and start your collection.
        </p>
      )}

      {hasData ? (
        <div className="node-panel-stats">
          <span className="node-panel-stat">
            <span className="node-panel-stat-label">Evidence</span>
            <span className="node-panel-stat-value">
              {evidenceLabel(visual.evidence)}
            </span>
          </span>
          <span className="node-panel-stat">
            <span className="node-panel-stat-label">Review</span>
            <span className="node-panel-stat-value">
              {freshnessLabel(visual.freshness)}
            </span>
          </span>
        </div>
      ) : null}

      <div className="node-panel-rewards">
        <span className="node-panel-reward">
          <span aria-hidden="true">💰</span> {ANSWER_REWARD_RANGE} Bits / correct
        </span>
        <span className="node-panel-reward node-panel-reward--daily">
          <span aria-hidden="true">🔥</span> +{DAILY_MISSION_BONUS_BITS} daily bonus
        </span>
      </div>

      <button type="button" className="primary node-panel-explore" onClick={onExplore}>
        <span aria-hidden="true">✨</span> Explore this topic
      </button>
    </aside>
  );
}
