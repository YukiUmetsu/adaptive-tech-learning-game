import { useEffect, useState } from "react";

/** The breakpoint below which the app uses the mobile navigation shell. */
export const MOBILE_NAV_QUERY = "(max-width: 640px)";

function queryMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * Subscribes to a CSS media query.
 *
 * Defaults to `false` when `matchMedia` is unavailable (SSR, jsdom) so the
 * desktop layout is always the safe default and tests do not need to stub it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => queryMatches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }

    const onChange = () => setMatches(mql.matches);
    onChange();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Legacy Safari only exposes the deprecated listener API.
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, [query]);

  return matches;
}
