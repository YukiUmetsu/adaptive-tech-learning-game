import { useState } from "react";

import type { FamilyInsightDto } from "../api/types";
import StructureComparisonCard from "./StructureComparisonCard";

interface FamilyInsightCardProps {
  insight: FamilyInsightDto;
  onAcknowledgeComparison?: () => void;
}

/** Coarse, non-judgmental coverage wording; never a percentage or mastery. */
function coverageLabel(contexts: number): string {
  if (contexts <= 0) {
    return "Seen";
  }
  if (contexts === 1) {
    return "Seen in 1 context";
  }
  return `Seen in ${contexts} contexts`;
}

/**
 * A compact family guide card (Phase 5).
 *
 * It shows the reusable structure, the recognition signals, the core rule, and
 * this family's authored near-neighbor distinctions. It deliberately shows no
 * mastery, percentage, or score: seeing an example is not understanding it.
 */
export default function FamilyInsightCard({
  insight,
  onAcknowledgeComparison,
}: FamilyInsightCardProps) {
  const [showSteps, setShowSteps] = useState(false);

  return (
    <article className="family-insight" aria-labelledby={`family-${insight.family_id}`}>
      <header className="family-insight-head">
        <h3 id={`family-${insight.family_id}`}>{insight.title}</h3>
        <span className="family-insight-coverage muted">
          {coverageLabel(insight.seen_context_count)}
        </span>
      </header>

      <p className="family-insight-summary">{insight.summary}</p>

      {insight.recognition_signals.length > 0 ? (
        <div className="family-insight-block">
          <p className="family-insight-block-title">Look for</p>
          <ul className="structure-signal-list">
            {insight.recognition_signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight.core_rules.length > 0 ? (
        <div className="family-insight-block">
          <p className="family-insight-block-title">Core rule</p>
          {insight.core_rules.map((rule) => (
            <p key={rule} className="structure-core-rule">
              {rule}
            </p>
          ))}
        </div>
      ) : null}

      {insight.structural_steps.length > 0 ? (
        <div className="family-insight-block">
          <button
            type="button"
            className="family-insight-toggle"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((value) => !value)}
          >
            {showSteps ? "Hide the reusable steps" : "Show the reusable steps"}
          </button>
          {showSteps ? (
            <ol className="structure-step-list">
              {insight.structural_steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {insight.common_confusions.length > 0 ? (
        <div className="family-insight-block">
          <p className="family-insight-block-title">Do not confuse it with</p>
          <ul className="family-confusion-list">
            {insight.common_confusions.map((confusion) => (
              <li key={confusion.other_family_id}>
                <span className="family-confusion-pair">
                  {insight.title} vs {confusion.other_family_title}
                </span>
                <span className="family-confusion-distinction">
                  {confusion.distinction}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight.comparison ? (
        <div className="family-insight-comparison">
          <StructureComparisonCard comparison={insight.comparison} />
          {onAcknowledgeComparison ? (
            <button
              type="button"
              className="family-insight-toggle"
              onClick={onAcknowledgeComparison}
            >
              Got it
            </button>
          ) : null}
        </div>
      ) : (
        <p className="muted family-insight-hint">
          Meet another example in a different context to see what they share.
        </p>
      )}

      {insight.example_contexts.length > 0 ? (
        <details className="family-insight-sources">
          <summary>Example contexts this pattern is authored for</summary>
          <ul>
            {insight.example_contexts.map((context) => (
              <li key={context.context_id}>{context.label}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {insight.source_refs.length > 0 ? (
        <details className="family-insight-sources">
          <summary>Sources</summary>
          <ul>
            {insight.source_refs.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
