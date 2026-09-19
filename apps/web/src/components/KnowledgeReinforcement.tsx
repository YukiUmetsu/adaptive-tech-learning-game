import { useState, type CSSProperties } from "react";

import type { KnowledgeGroup } from "../state/knowledge";

interface KnowledgeReinforcementProps {
  groups: KnowledgeGroup[];
  heading?: string;
}

const PREVIEW_COUNT = 6;

/**
 * "Knowledge reinforced" cards.
 *
 * Shows friendly service/topic names only (never raw concept ids), reveals a
 * handful at a time, and supports expand/collapse for long runs.
 */
export default function KnowledgeReinforcement({
  groups,
  heading = "Knowledge reinforced",
}: KnowledgeReinforcementProps) {
  const [expanded, setExpanded] = useState(false);

  if (groups.length === 0) {
    return (
      <section className="knowledge" aria-labelledby="knowledge-heading">
        <h2 id="knowledge-heading">{heading}</h2>
        <p className="muted">No topics recorded for this run.</p>
      </section>
    );
  }

  const visible = expanded ? groups : groups.slice(0, PREVIEW_COUNT);
  const hiddenCount = groups.length - PREVIEW_COUNT;

  return (
    <section className="knowledge" aria-labelledby="knowledge-heading">
      <h2 id="knowledge-heading">{heading}</h2>
      <ul className="knowledge-grid">
        {visible.map((group, index) => (
          <li
            key={group.id}
            className="knowledge-card"
            style={{ "--stagger": `${index * 90}ms` } as CSSProperties}
          >
            <span className="knowledge-check" aria-hidden="true">
              ✓
            </span>
            <div className="knowledge-body">
              <p className="knowledge-name">{group.name}</p>
              {group.topics.length > 0 ? (
                <p className="knowledge-topics">{group.topics.join(" · ")}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <button
          type="button"
          className="knowledge-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      ) : null}
    </section>
  );
}
