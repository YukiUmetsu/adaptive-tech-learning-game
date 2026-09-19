import { useEffect, useState } from "react";

import { prefersReducedMotion } from "../lib/motion";

export interface CountUpOptions {
  /** When false (or reduced motion), the final value renders immediately. */
  enabled?: boolean;
  /** Animation length in milliseconds. */
  durationMs?: number;
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * Animates an integer from `0` to `target`.
 *
 * The visual count-up is decorative: reduced-motion users (and disabled
 * instances) see the final value with no movement. Re-renders do not restart
 * the animation because the effect only depends on the target.
 */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { enabled = true, durationMs = 900 } = options;
  const instant = !enabled || prefersReducedMotion() || target <= 0;

  const [value, setValue] = useState(() => (instant ? target : 0));

  useEffect(() => {
    if (instant) {
      setValue(target);
      return;
    }

    setValue(0);
    const start = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / durationMs);
      setValue(Math.round(target * easeOutCubic(progress)));
      if (progress >= 1) {
        clearInterval(timer);
      }
    }, 16);

    return () => clearInterval(timer);
  }, [target, instant, durationMs]);

  return value;
}
