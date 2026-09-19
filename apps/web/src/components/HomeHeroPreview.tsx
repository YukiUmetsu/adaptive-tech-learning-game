interface PreviewNode {
  id: string;
  x: number;
  y: number;
  label: string;
  locked?: boolean;
}

const NODES: PreviewNode[] = [
  { id: "fundamentals", x: 150, y: 26, label: "Fundamentals" },
  { id: "compute", x: 86, y: 76, label: "Compute" },
  { id: "storage", x: 214, y: 76, label: "Storage" },
  { id: "networking", x: 252, y: 132, label: "Networking" },
  { id: "security", x: 54, y: 132, label: "Security" },
  { id: "monitoring", x: 132, y: 132, label: "Monitoring" },
  { id: "automation", x: 186, y: 132, label: "Automation", locked: true },
];

/**
 * Decorative preview of the learning experience shown in the homepage hero.
 *
 * It is purely presentational (no data, no interaction) and marked
 * `aria-hidden`, so screen readers get the real copy instead of a mock UI.
 */
export default function HomeHeroPreview() {
  return (
    <div className="hero-preview" aria-hidden="true">
      <div className="hero-preview-window">
        <div className="hero-preview-window-bar">
          <span className="hero-preview-window-brand">▲ Adaptive Learning</span>
        </div>
        <div className="hero-preview-map">
          <p className="hero-preview-kicker">Knowledge Map</p>
          <svg viewBox="0 0 300 178" className="hero-preview-graph">
            <g className="hero-preview-edges">
              <path d="M150 26 L86 76 M150 26 L214 76 M86 76 L54 132 M86 76 L132 132 M214 76 L186 132 M214 76 L252 132" />
            </g>
            {NODES.map((node) => (
              <g
                key={node.id}
                className={`hero-preview-node${node.locked ? " is-locked" : ""}`}
                transform={`translate(${node.x} ${node.y})`}
              >
                <circle r="14" />
                <text className="hero-preview-glyph" textAnchor="middle" dy="4">
                  {node.locked ? "🔒" : "✓"}
                </text>
                <text className="hero-preview-label" textAnchor="middle" y="29">
                  {node.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="hero-preview-quiz">
        <div className="hero-preview-quiz-head">
          <p className="hero-preview-kicker">Quiz</p>
          <span className="hero-preview-quiz-step">Question 3 of 10</span>
        </div>
        <p className="hero-preview-question">
          Which service provides scalable object storage in the cloud?
        </p>
        <ul className="hero-preview-options">
          <li>Compute Engine</li>
          <li>Block Storage</li>
          <li className="is-correct">Object Storage</li>
          <li>File Gateway</li>
        </ul>
        <p className="hero-preview-feedback">
          <span className="hero-preview-feedback-check">✓</span> Correct!
          <span className="hero-preview-bits">+10 Bits</span>
        </p>
      </div>
    </div>
  );
}
