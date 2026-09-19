/**
 * Open-redirect protection for post-login navigation.
 *
 * WorkOS `state` round-trips through the OAuth redirect and is not integrity
 * protected, so a `returnTo` value is untrusted input. Only same-origin,
 * path-style destinations are accepted; anything else is dropped and the caller
 * falls back to the app root.
 */
export function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Only internal paths: must start with a single "/" and never "//" or "/\\".
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return null;
  }
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }
    // Use the parsed absolute URL rather than the raw string so encoded
    // off-site targets cannot slip through.
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
