import type {
  LearningReveal,
  TableProgressiveReveal,
  TableRevealMode,
} from "../api/types";

/** The `table` arm of the shared reveal union. */
export type LearningTableReveal = Extract<LearningReveal, { type: "table" }>;

/** A progressive table: the table arm with reveal configuration present. */
export type ProgressiveTableReveal = LearningTableReveal & {
  progressive_reveal: TableProgressiveReveal;
};

/**
 * Namespaced discovery element ids.
 *
 * Learning progress stores one flat list of discovered elements per prompt.
 * Namespacing keeps code annotations, table rows, columns, and cells in the
 * same structure without separate maps, and keeps ids stable across content
 * revisions.
 */
export const elementId = {
  annotation: (annotationId: string) => `annotation:${annotationId}`,
  row: (rowId: string) => `row:${rowId}`,
  column: (columnId: string) => `column:${columnId}`,
  cell: (rowId: string, columnId: string) => `cell:${rowId}:${columnId}`,
};

/** Derives the cell id authors never hand-write: `row_id:column_id`. */
export function tableCellId(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

/** Whether a table reveal is configured for progressive discovery. */
export function isProgressiveTable(
  reveal: LearningReveal,
): reveal is ProgressiveTableReveal {
  return reveal.type === "table" && reveal.progressive_reveal != null;
}

/** Visibility/discovery state of one progressive-table cell. */
export type TableCellState = "given" | "revealed" | "hidden";

/**
 * Per-column width reservations for a progressive table.
 *
 * The width of each column is derived from the longest authored text it can
 * show, including hidden values. Reserving that space up front keeps the table
 * from reflowing when a cell reveals. Widths are expressed in `ch` so they
 * scale with the learning font size, clamped to keep very short and very long
 * columns readable.
 */
export function tableColumnWidths(
  reveal: LearningTableReveal,
  min = 7,
  max = 40,
): string[] {
  const mode = reveal.progressive_reveal?.mode;
  const affordance =
    mode === "column" ? "Reveal column" : mode === "row" ? "Reveal row" : "Reveal";
  return reveal.columns.map((column) => {
    let longest = Math.max(column.label.length, affordance.length);
    for (const row of reveal.rows) {
      longest = Math.max(longest, (row.cells[column.id] ?? "").length);
    }
    return `${Math.min(Math.max(longest, min), max)}ch`;
  });
}

/** The derived reveal plan for one progressive table. */
export interface ProgressiveTableState {
  mode: TableRevealMode;
  /** Whether a cell is visible before any reveal. */
  isCellInitiallyVisible(rowId: string | undefined, columnId: string): boolean;
  /** Element id a hidden cell reveals, given this table's mode. */
  unitForHiddenCell(rowId: string, columnId: string): string;
  /** Element ids that must be revealed to complete the prompt. */
  requiredUnits: string[];
}

/**
 * Derives initial visibility and the required reveal units for a table.
 *
 * A cell is visible when its column, its row, or its derived cell id is listed
 * in `initially_visible`. The three lists combine. Reveal units are the rows,
 * columns, or cells that still contain hidden information:
 *
 * - row mode: rows with at least one hidden cell
 * - column mode: columns with at least one hidden cell
 * - cell mode: every hidden cell
 */
export function deriveProgressiveTable(
  reveal: LearningTableReveal,
): ProgressiveTableState {
  const progressive: TableProgressiveReveal = reveal.progressive_reveal ?? {
    mode: "cell",
    initially_visible: { column_ids: [], row_ids: [], cell_ids: [] },
  };
  const initially = progressive.initially_visible ?? {};
  const visibleColumns = new Set(initially.column_ids ?? []);
  const visibleRows = new Set(initially.row_ids ?? []);
  const visibleCells = new Set(initially.cell_ids ?? []);

  const isCellInitiallyVisible = (
    rowId: string | undefined,
    columnId: string,
  ): boolean => {
    if (visibleColumns.has(columnId)) {
      return true;
    }
    if (rowId === undefined) {
      return false;
    }
    return (
      visibleRows.has(rowId) ||
      visibleCells.has(tableCellId(rowId, columnId))
    );
  };

  const requiredUnits: string[] = [];
  if (progressive.mode === "row") {
    for (const row of reveal.rows) {
      const rowId = row.id ?? undefined;
      if (rowId === undefined) {
        continue;
      }
      const anyHidden = reveal.columns.some(
        (column) => !isCellInitiallyVisible(rowId, column.id),
      );
      if (anyHidden) {
        requiredUnits.push(elementId.row(rowId));
      }
    }
  } else if (progressive.mode === "column") {
    for (const column of reveal.columns) {
      const anyHidden = reveal.rows.some(
        (row) => !isCellInitiallyVisible(row.id ?? undefined, column.id),
      );
      if (anyHidden) {
        requiredUnits.push(elementId.column(column.id));
      }
    }
  } else {
    for (const row of reveal.rows) {
      const rowId = row.id ?? undefined;
      for (const column of reveal.columns) {
        if (!isCellInitiallyVisible(rowId, column.id)) {
          requiredUnits.push(elementId.cell(rowId ?? "", column.id));
        }
      }
    }
  }

  return {
    mode: progressive.mode,
    isCellInitiallyVisible,
    unitForHiddenCell: (rowId, columnId) => {
      if (progressive.mode === "row") {
        return elementId.row(rowId);
      }
      if (progressive.mode === "column") {
        return elementId.column(columnId);
      }
      return elementId.cell(rowId, columnId);
    },
    requiredUnits,
  };
}
