import { useEffect, useMemo, useState } from "react";

import type { FamilyInsightDto } from "../api/types";
import { recordFamilyInsightEvent } from "../state/familyInsightTelemetry";
import FamilyInsightCard from "./FamilyInsightCard";

interface FamilyInsightToolbeltProps {
  trackId: string;
  insights: FamilyInsightDto[];
  /**
   * Learner-facing heading. Neutral by default; a track presentation layer may
   * pass a track-specific label (for example "Pattern Toolbelt") without the
   * core component hard-coding any subject.
   */
  heading?: string;
}

function coverageLabel(contexts: number): string {
  if (contexts <= 0) {
    return "Seen";
  }
  return contexts === 1 ? "Seen in 1 context" : `Seen in ${contexts} contexts`;
}

/**
 * Compact browser for the reusable patterns a learner has already met.
 *
 * This is the Track Hub "Toolbelt" view. It lists only families the learner has
 * already encountered (the server never returns an unexposed family), shows a
 * coarse coverage label instead of any mastery percentage, and reveals one
 * family's guide at a time. It is instructional only: viewing never scores,
 * never awards Bits, and never changes concept state.
 */
export default function FamilyInsightToolbelt({
  trackId,
  insights,
  heading = "Reusable Patterns",
}: FamilyInsightToolbeltProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => insights.find((insight) => insight.family_id === selectedId) ?? null,
    [insights, selectedId],
  );

  // Keep a valid selection as insights refresh.
  useEffect(() => {
    if (insights.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!insights.some((insight) => insight.family_id === selectedId)) {
      setSelectedId(insights[0].family_id);
    }
  }, [insights, selectedId]);

  // Non-authoritative telemetry, recorded once per family per pending batch.
  useEffect(() => {
    for (const insight of insights) {
      recordFamilyInsightEvent({
        event: "family_insight_shown",
        trackId,
        familyId: insight.family_id,
      });
    }
  }, [insights, trackId]);

  if (insights.length === 0) {
    return (
      <section className="family-toolbelt" aria-label={heading}>
        <h2>{heading}</h2>
        <p className="muted">
          Patterns you meet while practicing will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="family-toolbelt" aria-label={heading}>
      <div className="family-toolbelt-head">
        <h2>{heading}</h2>
        <p className="muted">
          Same structure, different stories. These are patterns you have
          already met.
        </p>
      </div>

      <ul className="family-toolbelt-list">
        {insights.map((insight) => {
          const active = insight.family_id === selectedId;
          return (
            <li key={insight.family_id}>
              <button
                type="button"
                className={`family-toolbelt-item${active ? " family-toolbelt-item--active" : ""}`}
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  setSelectedId(insight.family_id);
                  recordFamilyInsightEvent({
                    event: "family_insight_opened",
                    trackId,
                    familyId: insight.family_id,
                  });
                }}
              >
                <span className="family-toolbelt-title">{insight.title}</span>
                <span className="family-toolbelt-summary muted">
                  {insight.summary}
                </span>
                <span className="family-toolbelt-coverage muted">
                  {coverageLabel(insight.seen_context_count)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <FamilyInsightCard
          insight={selected}
          onAcknowledgeComparison={() =>
            recordFamilyInsightEvent({
              event: "structure_comparison_completed",
              trackId,
              familyId: selected.family_id,
            })
          }
        />
      ) : null}
    </section>
  );
}
