import type { LearningTableReveal } from "../lib/learningElements";
import InlineText from "./InlineText";

/**
 * Renders a real table reveal with accessible HTML table semantics.
 *
 * Headers use `<th scope="col">` and rows read column-by-column, so a screen
 * reader announces each cell with its column. The wrapper scrolls horizontally
 * on narrow screens instead of squeezing the columns.
 *
 * This is the static, whole-table reveal. Progressive tables render through
 * `ProgressiveLearningTable`.
 */
export default function LearningTable({ columns, rows }: LearningTableReveal) {
  return (
    <div className="learning-table-wrap">
      <table className="learning-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                <InlineText text={column.label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.id}>
                  <InlineText text={row.cells[column.id] ?? ""} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
