import type { LearningReveal } from "../api/types";
import { comparisonGridClass } from "../lib/comparison";
import { isProgressiveTable } from "../lib/learningElements";
import CodeFile, { type CodeFileInteraction } from "./CodeFile";
import InlineText from "./InlineText";
import LearningTable from "./LearningTable";
import ProgressiveLearningTable, {
  type ProgressiveTableInteraction,
} from "./ProgressiveLearningTable";

interface RevealContentProps {
  reveal: LearningReveal;
  /**
   * Discovery state for a `code_file` reveal. Static reveals ignore it; an
   * interaction-free code file renders read-only with no clickable regions.
   */
  codeInteraction?: CodeFileInteraction;
  /**
   * Discovery state for a progressive `table` reveal. A table without
   * `progressive_reveal` ignores it and uses the static whole-table reveal.
   */
  tableInteraction?: ProgressiveTableInteraction;
}

/**
 * Renders one authored reveal.
 *
 * Each reveal type gets a purpose-built layout instead of being flattened to
 * prose: sequences show arrows, comparisons are side-by-side (stacked on
 * mobile), keywords become clue chips, tables use real table semantics, and
 * code files render as a read-only highlighted editor.
 */
export default function RevealContent({
  reveal,
  codeInteraction,
  tableInteraction,
}: RevealContentProps) {
  switch (reveal.type) {
    case "text":
      return (
        <p className="reveal reveal-text">
          <InlineText text={reveal.text} />
        </p>
      );
    case "sequence":
      return (
        <ol className="reveal reveal-sequence">
          {reveal.items.map((item, index) => (
            <li key={`${index}-${item}`} className="reveal-sequence-item">
              <span>
                <InlineText text={item} />
              </span>
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
            <li key={`${index}-${item}`}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "keywords":
      return (
        <ul className="reveal reveal-keywords" aria-label="Clues">
          {reveal.items.map((item, index) => (
            <li key={`${index}-${item}`} className="reveal-chip">
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "comparison":
      return (
        <div
          className={`reveal reveal-comparison comparison-grid ${comparisonGridClass(
            reveal.columns.length,
          )}`}
          data-columns={reveal.columns.length}
        >
          {reveal.columns.map((column) => (
            <section key={column.title} className="reveal-comparison-column">
              <h4>
                <InlineText text={column.title} />
              </h4>
              <ul>
                {column.items.map((item, index) => (
                  <li key={`${index}-${item}`}>
                    <InlineText text={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="reveal reveal-table">
          {isProgressiveTable(reveal) ? (
            <ProgressiveLearningTable
              reveal={reveal}
              interaction={tableInteraction}
            />
          ) : (
            <LearningTable {...reveal} />
          )}
        </div>
      );
    case "code_file":
      return (
        <div className="reveal reveal-code-file">
          <CodeFile reveal={reveal} interaction={codeInteraction} />
        </div>
      );
    default:
      return null;
  }
}
