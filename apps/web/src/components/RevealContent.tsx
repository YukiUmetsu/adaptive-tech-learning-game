import type { LearningReveal } from "../api/types";

interface RevealContentProps {
  reveal: LearningReveal;
}

/**
 * Renders one authored reveal.
 *
 * Each reveal type gets a purpose-built layout instead of being flattened to
 * prose: sequences show arrows, comparisons are side-by-side (stacked on
 * mobile), and keywords become clue chips.
 */
export default function RevealContent({ reveal }: RevealContentProps) {
  switch (reveal.type) {
    case "text":
      return <p className="reveal reveal-text">{reveal.text}</p>;
    case "sequence":
      return (
        <ol className="reveal reveal-sequence">
          {reveal.items.map((item, index) => (
            <li key={`${index}-${item}`} className="reveal-sequence-item">
              <span>{item}</span>
              {index < reveal.items.length - 1 ? (
                <span className="reveal-sequence-arrow" aria-hidden="true">
                  ↓
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      );
    case "bullets":
      return (
        <ul className="reveal reveal-bullets">
          {reveal.items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      );
    case "keywords":
      return (
        <ul className="reveal reveal-keywords" aria-label="Clues">
          {reveal.items.map((item, index) => (
            <li key={`${index}-${item}`} className="reveal-chip">
              {item}
            </li>
          ))}
        </ul>
      );
    case "comparison":
      return (
        <div className="reveal reveal-comparison">
          {reveal.columns.map((column) => (
            <section key={column.title} className="reveal-comparison-column">
              <h4>{column.title}</h4>
              <ul>
                {column.items.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    default:
      return null;
  }
}
