import createClient from "openapi-fetch";

import { getAccessTokenForRequest } from "../auth/token";
import { getDeviceId } from "../state/persistence";
import type { paths } from "./schema";

/**
 * Base URL for API requests.
 *
 * Development always uses the current origin so requests go through the Vite
 * dev/preview proxy (see `vite.config.ts`) and never hit CORS — even if a stray
 * `VITE_API_BASE_URL` is present in `.env.local`. Production uses
 * `VITE_API_BASE_URL` when set (API on another origin) and otherwise the
 * current origin.
 */
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const apiBaseUrl =
  !import.meta.env.DEV && configuredBaseUrl && configuredBaseUrl.length > 0
    ? configuredBaseUrl
    : window.location.origin;

/**
 * Typed API client generated from the Rust OpenAPI document.
 *
 * `fetch` is resolved at call time so tests and runtime instrumentation can
 * replace the global without rebuilding the client.
 *
 * Regenerate the schema with `pnpm generate:api` after changing API types.
 */
export const api = createClient<paths>({
  baseUrl: apiBaseUrl,
  fetch: (request) => globalThis.fetch(request),
});

/**
 * Centralized auth injection.
 *
 * Every request gets the current bearer token (when a session exists) and the
 * device/install context header. Components never set these themselves, and
 * tokens are never placed in query strings or persisted by the client.
 */
api.use({
  async onRequest({ request }) {
    const token = await getAccessTokenForRequest();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    try {
      request.headers.set("X-Device-Id", getDeviceId());
    } catch {
      // Storage unavailable; device context is optional.
    }
    return request;
  },
});
