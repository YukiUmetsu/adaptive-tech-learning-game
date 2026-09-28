/**
 * How an equipped Tower theme is expressed on the Cyber Defense root.
 *
 * Kept out of the component module so the component file only exports a
 * component (React Fast Refresh) and the mapping is directly testable. Purely
 * cosmetic: it never changes simulation values.
 */
export function cyberThemeAttribute(
  equippedTheme: string | null | undefined,
): string | undefined {
  return equippedTheme ?? undefined;
}
