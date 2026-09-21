import { useEffect } from "react";

import { prefersReducedMotion } from "../lib/motion";
import { useUserPreferences } from "../state/preferences";

/**
 * Mirrors Personal Settings onto the document root as data attributes.
 *
 * JavaScript-driven animations already read `prefersReducedMotion()`; these
 * attributes let CSS-only animations honour an explicit accessibility choice
 * and the Gamification animation switches, without threading props through
 * every component. The OS `prefers-reduced-motion` media query still applies
 * independently and is never overridden here.
 */
export default function PreferencesEffects() {
  const preferences = useUserPreferences();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion = prefersReducedMotion() ? "true" : "false";
    root.dataset.animationIntensity = preferences.accessibility.animationIntensity;
    root.dataset.rewardAnimations = preferences.gamification.rewardAnimations
      ? "on"
      : "off";
    root.dataset.bitsAnimations = preferences.gamification.bitsAnimations
      ? "on"
      : "off";
  }, [preferences]);

  return null;
}
