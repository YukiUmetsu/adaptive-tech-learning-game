/**
 * Sanitizes the optional `VITE_WORKOS_API_HOSTNAME` value.
 *
 * The AuthKit SDK builds its authorization URL as
 * `https://<host>/user_management/authorize?...` and navigates the browser to
 * it. If that host is the app's own origin, a static host with an SPA fallback
 * serves `index.html` for the unknown path and the learner sees the homepage
 * instead of the hosted login page. A WorkOS API host can therefore never be
 * the app's own host.
 *
 * The value is expected to be a bare hostname, but a pasted URL
 * (`https://api.workos.com`) or one with a path is tolerated and reduced to its
 * host. Anything empty, unparseable, or equal to the app host is ignored so the
 * SDK falls back to its `api.workos.com` default.
 */
export function sanitizeWorkosApiHostname(
  raw: string | undefined,
  appHost: string,
): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  let host: string;
  try {
    host = value.includes("://")
      ? new URL(value).host
      : (value.split(/[/?#]/, 1)[0] ?? "");
  } catch {
    return undefined;
  }

  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === appHost.trim().toLowerCase()) {
    return undefined;
  }
  return normalized;
}

/**
 * Whether an auth host shares the app's registrable domain, so the WorkOS
 * session cookie is first-party and can be read by the app.
 *
 * Uses a last-two-labels comparison, which is correct for the domains this app
 * deploys to (`*.shidenlabs.com`, `*.pages.dev`, `api.workos.com`,
 * `*.authkit.app`). A false negative only means the SDK falls back to
 * `devMode` persistence, which still works.
 */
export function isFirstPartyAuthHost(
  apiHostname: string | undefined,
  appHost: string,
): boolean {
  if (!apiHostname) {
    return false;
  }
  const site = (host: string) =>
    host.toLowerCase().split(":")[0].split(".").slice(-2).join(".");
  const appSite = site(appHost);
  return appSite.length > 0 && appSite === site(apiHostname);
}

