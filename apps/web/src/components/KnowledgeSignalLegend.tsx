/**
 * Compact legend for the Knowledge Signal visual language.
 *
 * Uses words as well as shapes so meaning never depends on color alone, and
 * avoids mastery/percentage claims entirely.
 */
export default function KnowledgeSignalLegend() {
  return (
    <details className="signal-legend" open>
      <summary>Map signals</summary>
      <ul>
        <li>
          <span className="legend-node legend-node--unexplored" aria-hidden="true" />
          Not explored yet
        </li>
        <li>
          <span className="legend-node legend-node--explored" aria-hidden="true" />
          Explored
        </li>
        <li>
          <span className="legend-node legend-node--developing" aria-hidden="true" />
          Building evidence
        </li>
        <li>
          <span className="legend-node legend-node--strong" aria-hidden="true" />
          Strong evidence
        </li>
        <li>
          <span className="legend-node legend-node--due" aria-hidden="true" />
          Review coming up
        </li>
        <li>
          <span className="legend-node legend-node--recommended" aria-hidden="true">
            ✦
          </span>
          Recommended next
        </li>
      </ul>
      <p className="muted">Every step lights up your map. Keep going.</p>
    </details>
  );
}
