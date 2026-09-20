/**
 * WorkOS AuthKit session persistence helpers.
 *
 * `@workos-inc/authkit-js` restores a session on load from either:
 *
 * - a refresh token in `localStorage` (only when the SDK runs in `devMode`), or
 * - a first-party `workos-has-session` cookie (only available with a custom
 *   authentication domain under the app's own domain).
 *
 * With the default `api.workos.com` and no custom auth domain, the httpOnly
 * session cookie is third-party and unreadable, so none of these are present
 * and a reload signs the learner out. The app therefore enables `devMode` when
 * no first-party auth domain is configured.
 */

/** The SDK's refresh-token storage key for a client. */
export function workosRefreshTokenKey(clientId: string): string {
  return `workos:refresh-token:${clientId}`;
}

/**
 * Whether this browser has persisted WorkOS session material the SDK can
 * restore from on the next load.
 */
export function hasPersistedWorkosSession(clientId: string): boolean {
  try {
    if (window.localStorage.getItem(workosRefreshTokenKey(clientId))) {
      return true;
    }
  } catch {
    // Storage can be unavailable; fall through to the cookie check.
  }
  try {
    return /(?:^|;\s*)workos-has-session=/.test(document.cookie);
  } catch {
    return false;
  }
}
