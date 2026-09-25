/**
 * Deterministic shuffles.
 *
 * Ordering/reconstruction candidates are authored in a meaningful order, so the
 * frontend must not present them unchanged. A seeded shuffle keeps rendering
 * stable across renders and tests while still hiding the authored order.
 */

/** Deterministic Fisher–Yates shuffle seeded by `seed`. */
export function stableShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const swap = Math.abs(hash) % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * A deterministic permutation guaranteed not to equal the input order when
 * there is more than one item.
 *
 * Ordering items are authored in their correct order, so an identity shuffle
 * would pre-solve the puzzle. If the shuffle lands on the identity we swap the
 * first two items instead.
 */
export function shuffledOrder<T>(items: readonly T[], seed: string): T[] {
  if (items.length < 2) {
    return [...items];
  }
  const result = stableShuffle(items, seed);
  const isIdentity = result.every((value, index) => value === items[index]);
  if (!isIdentity) {
    return result;
  }
  const swapped = [...result];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  return swapped;
}

/**
 * A deterministic display order for answer options.
 *
 * Choice options are frequently authored with the correct answer listed first,
 * which lets a learner guess from position alone. Scoring is keyed by choice
 * id, so the display order is free to change: this shuffles the options for
 * presentation while keeping rendering stable across renders and tests.
 *
 * The authored first option is never shown first, so an authored pattern of
 * "correct answer first" cannot be read off the screen.
 */
export function shuffledChoices<T extends { id: string }>(
  choices: readonly T[],
  seed: string,
): T[] {
  if (choices.length < 2) {
    return [...choices];
  }
  const result = stableShuffle(choices, seed);
  if (result[0].id === choices[0].id) {
    [result[0], result[1]] = [result[1], result[0]];
  }
  return result;
}
