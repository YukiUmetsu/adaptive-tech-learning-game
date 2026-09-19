/**
 * Shared helpers for authored `comparison` reveals.
 *
 * Learning content uses a `comparison` reveal with 2-6 titled columns, and the
 * pre-reveal placeholder mirrors those columns with `|` separators. Both the
 * blank and the revealed content share one count-aware grid so they always line
 * up.
 */

/** Column-count-aware modifier for the shared comparison grid. */
export function comparisonGridClass(columnCount: number): string {
  return columnCount <= 3
    ? `comparison-grid--cols-${columnCount}`
    : "comparison-grid--cols-many";
}

/**
 * Splits an authored placeholder into column segments.
 *
 * Returns an empty array unless the placeholder is genuinely column-shaped, so
 * a plain placeholder is still rendered as ordinary text.
 */
export function comparisonPlaceholderColumns(placeholder: string): string[] {
  const segments = placeholder
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length > 1 ? segments : [];
}
