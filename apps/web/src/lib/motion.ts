/**
 * Motion preference helpers.
 *
 * Celebration animations are decorative, so the app must degrade to a static,
 * equally informative version when the learner asks for reduced motion. The
 * check is defensive because `matchMedia` is unavailable in some test/SSR
 * environments.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
