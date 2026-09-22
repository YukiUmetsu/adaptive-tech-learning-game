import type {
  LearningReveal,
  TableProgressiveReveal,
  TableRevealMode,
  TextProgressiveReveal,
  TextRevealSpan,
} from "../api/types";

/** The `table` arm of the shared reveal union. */
export type LearningTableReveal = Extract<LearningReveal, { type: "table" }>;

/** A progressive table: the table arm with reveal configuration present. */
export type ProgressiveTableReveal = LearningTableReveal & {
  progressive_reveal: TableProgressiveReveal;
};

/** The `text` arm of the shared reveal union. */
export type LearningTextReveal = Extract<LearningReveal, { type: "text" }>;

/** A progressive text reveal: the text arm with span configuration present. */
export type ProgressiveTextReveal = LearningTextReveal & {
  progressive_reveal: TextProgressiveReveal;
};

/**
 * Namespaced discovery element ids.
 *
 * Learning progress stores one flat list of discovered elements per prompt.
 * Namespacing keeps code annotations, table rows, columns, cells, and
 * progressive-text spans in the same structure without separate maps, and keeps
 * ids stable across content revisions.
 */
export const elementId = {
  annotation: (annotationId: string) => `annotation:${annotationId}`,
  row: (rowId: string) => `row:${rowId}`,
  column: (columnId: string) => `column:${columnId}`,
  cell: (rowId: string, columnId: string) => `cell:${rowId}:${columnId}`,
  span: (spanId: string) => `span:${spanId}`,
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

/** Whether a text reveal is configured for progressive span discovery. */
export function isProgressiveText(
  reveal: LearningReveal,
): reveal is ProgressiveTextReveal {
  return reveal.type === "text" && reveal.progressive_reveal != null;
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

/** One ordered piece of a progressive `text` reveal. */
export interface ProgressiveTextSegment {
  /** Whether this piece is visible prose or a hidden span control. */
  kind: "text" | "span";
  /** Literal prose for `text`; the authored phrase for `span`. */
  text: string;
  /** Present only on `span` pieces: the stable authored span id. */
  spanId?: string;
  /** Present only on `span` pieces: whether it blocks completion. */
  required?: boolean;
}

/** Returns the zero-based index of the `occurrence`-th match, or `-1`. */
function occurrenceOffset(
  haystack: string,
  needle: string,
  occurrence: number,
): number {
  if (needle.length === 0 || occurrence < 1) {
    return -1;
  }
  let seen = 0;
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) {
      break;
    }
    seen += 1;
    if (seen === occurrence) {
      return index;
    }
    from = index + needle.length;
  }
  return -1;
}

/**
 * Splits a progressive `text` reveal into ordered prose and hidden-span pieces.
 *
 * Spans are located by exact text plus the authored occurrence, so repeated
 * wording resolves deterministically rather than revealing the wrong phrase.
 * Content validation already rejects spans that cannot be located or that
 * overlap; a span that cannot be located here is rendered as plain prose instead
 * of being lost.
 */
export function deriveProgressiveText(
  reveal: LearningTextReveal,
): ProgressiveTextSegment[] {
  const spans: TextRevealSpan[] = reveal.progressive_reveal?.spans ?? [];
  const located = spans
    .map((span) => {
      const start = occurrenceOffset(reveal.text, span.text, span.occurrence ?? 1);
      return start < 0
        ? null
        : { span, start, end: start + span.text.length };
    })
    .filter(
      (
        entry,
      ): entry is { span: TextRevealSpan; start: number; end: number } =>
        entry !== null,
    )
    .sort((a, b) => a.start - b.start);

  const segments: ProgressiveTextSegment[] = [];
  let cursor = 0;
  for (const { span, start, end } of located) {
    if (start < cursor) {
      // Defensive only: content validation rejects overlaps, so this never
      // happens with authored content.
      continue;
    }
    if (start > cursor) {
      segments.push({ kind: "text", text: reveal.text.slice(cursor, start) });
    }
    segments.push({
      kind: "span",
      text: span.text,
      spanId: span.id,
      required: span.required !== false,
    });
    cursor = end;
  }
  if (cursor < reveal.text.length) {
    segments.push({ kind: "text", text: reveal.text.slice(cursor) });
  }
  return segments;
}
