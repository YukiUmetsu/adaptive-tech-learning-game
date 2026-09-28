import { useState } from "react";

import type { StructureComparisonDto } from "../api/types";

interface StructureComparisonCardProps {
  comparison: StructureComparisonDto;
  /** Coarse learner-facing label for the surrounding family, when available. */
  heading?: string;
}

/**
 * "Same Skeleton" structural comparison (Phase 5).
 *
 * Shows that two (or more) problems the learner has already seen share one deep
 * structure despite different surface stories. The content is revealed
 * progressively so the learner reasons before the abstraction is dumped:
 *
 * 1. the seen examples and a "what seems similar?" prompt;
 * 2. the shared recognition signals;
 * 3. the family summary and core rule;
 * 4. the optional reusable skeleton.
 *
 * It is instructional only: it never scores, never awards Bits, and never
 * changes concept state. It renders authored labels only, never raw machine ids,
 * and every control is a native button so keyboard navigation works.
 */
export default function StructureComparisonCard({
  comparison,
  heading = "Same Skeleton",
}: StructureComparisonCardProps) {
  const hasSignals = comparison.recognition_signals.length > 0;
  const hasRule =
    comparison.core_rules.length > 0 || comparison.summary.trim().length > 0;
  const hasSteps = comparison.structural_steps.length > 0;

  const [showSignals, setShowSignals] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  return (
    <section
      className="structure-comparison"
      aria-label={`${heading}: ${comparison.title}`}
    >
      <h3 className="structure-comparison-title">{heading}</h3>
      <p className="structure-comparison-prompt">
        Here are problems you already met. What seems similar?
      </p>

      <ul className="structure-example-list">
        {comparison.examples.map((example, index) => (
          <li key={`${example.context_label}-${index}`}>
            <span className="structure-example-label">
              {example.context_label}
            </span>
            <span className="structure-example-link" aria-hidden="true">
              ↓
            </span>
            <span className="structure-example-structure">
              {comparison.summary}
            </span>
          </li>
        ))}
      </ul>

      {hasSignals ? (
        showSignals ? (
          <div className="structure-reveal">
            <p className="structure-reveal-heading">What stays the same?</p>
            <ul className="structure-signal-list">
              {comparison.recognition_signals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            type="button"
            className="structure-reveal-btn"
            aria-expanded={false}
            onClick={() => setShowSignals(true)}
          >
            Reveal the shared structure
          </button>
        )
      ) : null}

      {hasRule && showSignals ? (
        showRule ? (
          <div className="structure-reveal">
            <p className="structure-reveal-heading">
              Why these are the same
            </p>
            <p>{comparison.summary}</p>
            {comparison.core_rules.map((rule) => (
              <p key={rule} className="structure-core-rule">
                {rule}
              </p>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="structure-reveal-btn"
            aria-expanded={false}
            onClick={() => setShowRule(true)}
          >
            Reveal the core rule
          </button>
        )
      ) : null}

      {hasSteps && showRule ? (
        showSteps ? (
          <div className="structure-reveal">
            <p className="structure-reveal-heading">The reusable steps</p>
            <ol className="structure-step-list">
              {comparison.structural_steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <button
            type="button"
            className="structure-reveal-btn"
            aria-expanded={false}
            onClick={() => setShowSteps(true)}
          >
            Show the reusable steps
          </button>
        )
      ) : null}
    </section>
  );
}
