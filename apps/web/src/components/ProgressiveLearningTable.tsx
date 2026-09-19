import { useMemo, type ReactNode } from "react";

import type { LearningTableReveal } from "../lib/learningElements";
import {
  deriveProgressiveTable,
  elementId,
  type TableCellState,
} from "../lib/learningElements";

/** Discovery state and callbacks for one progressive table. */
export interface ProgressiveTableInteraction {
  /** Namespaced element ids the learner has already revealed. */
  revealedElementIds: readonly string[];
  /** Reveals one row, column, or cell element. Never scored. */
  onRevealElement: (elementId: string) => void;
  /** Disables interaction while the node is locked or busy. */
  disabled?: boolean;
}

interface ProgressiveLearningTableProps {
  reveal: LearningTableReveal;
  interaction?: ProgressiveTableInteraction;
}

/**
 * Renders a progressively revealed table.
 *
 * The table is visible immediately. Which cells the learner must reveal depends
 * on the mode (row, column, or cell) and on the authored initial visibility;
 * anything already visible is never an interactive control. Hidden values are
 * only rendered after reveal, so they never reach the accessibility tree early.
 *
 * Each row has a single reveal control (in its first hidden cell) in row mode,
 * each revealable column has one control in its header in column mode, and each
 * hidden cell is its own control in cell mode. The row header is the first
 * column, matching the authored identity column in discovery tables.
 */
export default function ProgressiveLearningTable({
  reveal,
  interaction,
}: ProgressiveLearningTableProps) {
  const state = useMemo(() => deriveProgressiveTable(reveal), [reveal]);
  const revealed = useMemo(
    () => new Set(interaction?.revealedElementIds ?? []),
    [interaction?.revealedElementIds],
  );
  const disabled = interaction?.disabled ?? false;
  const identityColumn = reveal.columns[0];

  const cellState = (
    rowId: string | undefined,
    columnId: string,
  ): TableCellState => {
    if (state.isCellInitiallyVisible(rowId, columnId)) {
      return "given";
    }
    if (rowId !== undefined && revealed.has(state.unitForHiddenCell(rowId, columnId))) {
      return "revealed";
    }
    return "hidden";
  };

  /** A learner-facing row label that never leaks a hidden identity cell. */
  const rowLabel = (
    rowId: string | undefined,
    cells: Record<string, string>,
  ): string => {
    if (rowId === undefined) {
      return "row";
    }
    if (
      identityColumn !== undefined &&
      state.isCellInitiallyVisible(rowId, identityColumn.id)
    ) {
      return cells[identityColumn.id] ?? rowId;
    }
    return rowId;
  };

  const hiddenPlaceholder = () => (
    <span className="learning-table-hidden" aria-hidden="true" />
  );

  const renderCell = (
    row: LearningTableReveal["rows"][number],
    rowIndex: number,
    column: LearningTableReveal["columns"][number],
    columnIndex: number,
    rowControlColumnId: string | undefined,
  ) => {
    const rowId = row.id ?? undefined;
    const status = cellState(rowId, column.id);
    const className = `learning-table-cell learning-table-cell--${status}`;
    let inner: ReactNode;

    if (status === "hidden") {
      const unit =
        rowId !== undefined ? state.unitForHiddenCell(rowId, column.id) : null;
      if (state.mode === "cell" && unit !== null) {
        inner = (
          <button
            type="button"
            className="learning-table-reveal"
            aria-label={`Reveal ${column.label} for ${rowLabel(rowId, row.cells)}`}
            disabled={disabled}
            onClick={() => interaction?.onRevealElement(unit)}
          >
            <span className="learning-table-reveal-label">Reveal</span>
          </button>
        );
      } else if (
        state.mode === "row" &&
        unit !== null &&
        column.id === rowControlColumnId
      ) {
        inner = (
          <button
            type="button"
            className="learning-table-reveal"
            aria-label={`Reveal row ${rowLabel(rowId, row.cells)}`}
            disabled={disabled}
            onClick={() => interaction?.onRevealElement(unit)}
          >
            <span className="learning-table-reveal-label">Reveal row</span>
          </button>
        );
      } else {
        // Row-mode siblings and column-mode cells stay inert: the whole unit is
        // revealed from one control.
        inner = hiddenPlaceholder();
      }
    } else {
      inner = row.cells[column.id] ?? "";
    }

    const key = `${row.id ?? rowIndex}-${column.id}`;
    return columnIndex === 0 ? (
      <th key={key} scope="row" className={className}>
        {inner}
      </th>
    ) : (
      <td key={key} className={className}>
        {inner}
      </td>
    );
  };

  return (
    <div className="learning-table-wrap">
      <table className="learning-table learning-table--progressive">
        <thead>
          <tr>
            {reveal.columns.map((column) => {
              const unit = elementId.column(column.id);
              const isUnit =
                state.mode === "column" && state.requiredUnits.includes(unit);
              const isRevealed = revealed.has(unit);
              if (isUnit && !isRevealed) {
                return (
                  <th key={column.id} scope="col">
                    <button
                      type="button"
                      className="learning-table-reveal learning-table-reveal--column"
                      aria-label={`Reveal column ${column.label}`}
                      disabled={disabled}
                      onClick={() => interaction?.onRevealElement(unit)}
                    >
                      <span className="learning-table-reveal-column-label">
                        {column.label}
                      </span>
                      <span
                        className="learning-table-reveal-column-hint"
                        aria-hidden="true"
                      >
                        Reveal column
                      </span>
                    </button>
                  </th>
                );
              }
              return (
                <th
                  key={column.id}
                  scope="col"
                  className={isUnit ? "learning-table-th--revealed" : undefined}
                >
                  {column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {reveal.rows.map((row, rowIndex) => {
            const rowId = row.id ?? undefined;
            const firstHiddenColumnId =
              state.mode === "row"
                ? reveal.columns.find(
                    (column) => cellState(rowId, column.id) === "hidden",
                  )?.id
                : undefined;
            return (
              <tr key={row.id ?? rowIndex}>
                {reveal.columns.map((column, columnIndex) =>
                  renderCell(row, rowIndex, column, columnIndex, firstHiddenColumnId),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
