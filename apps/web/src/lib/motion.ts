import { prefersReducedMotionPreference } from "../state/preferences";

/**
 * Motion preference helpers.
 *
 * Celebration animations are decorative, so the app must degrade to a static,
 * equally informative version when the learner asks for reduced motion. The
 * OS `prefers-reduced-motion` setting is always honoured; an explicit Personal
 * Settings choice can reduce motion further, but can never force full motion
 * when the OS asks for reduced motion.
 *
 * The checks are defensive because `matchMedia` is unavailable in some
 * test/SSR environments.
 */
function osPrefersReducedMotion(): boolean {
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

export function prefersReducedMotion(): boolean {
  if (osPrefersReducedMotion()) {
    return true;
  }
  return prefersReducedMotionPreference();
}
