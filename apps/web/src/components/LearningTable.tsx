import type { LearningReveal } from "../api/types";

/** The `table` arm of the shared reveal union. */
export type LearningTableReveal = Extract<LearningReveal, { type: "table" }>;

/**
 * Renders a real table reveal with accessible HTML table semantics.
 *
 * Headers use `<th scope="col">` and rows read column-by-column, so a screen
 * reader announces each cell with its column. The wrapper scrolls horizontally
 * on narrow screens instead of squeezing the columns.
 */
export default function LearningTable({ columns, rows }: LearningTableReveal) {
  return (
    <div className="learning-table-wrap">
      <table className="learning-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.id}>{row.cells[column.id] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
