import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Caps response time so background tabs cannot inflate study time. */
export const MAX_RESPONSE_MS = 30 * 60 * 1000;

/**
 * Tracks active time for one question.
 *
 * Time is only accumulated while the question is answerable and the document is
 * visible, so background/away time is excluded.
 */
export function useQuestionTimer(key: string, active: boolean) {
  const accumulated = useRef(0);
  const runningSince = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    accumulated.current = 0;
    runningSince.current = active && !document.hidden ? Date.now() : null;
  }, [key, active]);

  useEffect(() => {
    const update = () => setPaused(document.hidden);
    const onBlur = () => setPaused(true);
    const onFocus = () => setPaused(document.hidden);

    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    update();

    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const shouldRun = active && !paused;
    if (shouldRun && runningSince.current === null) {
      runningSince.current = Date.now();
    } else if (!shouldRun && runningSince.current !== null) {
      accumulated.current += Date.now() - runningSince.current;
      runningSince.current = null;
    }
  }, [active, paused]);

  const elapsedMs = useCallback(() => {
    let total = accumulated.current;
    if (runningSince.current !== null) {
      total += Date.now() - runningSince.current;
    }
    return Math.min(Math.max(total, 0), MAX_RESPONSE_MS);
  }, []);

  return useMemo(() => ({ elapsedMs }), [elapsedMs]);
}
