import createClient from "openapi-fetch";

import type { paths } from "./schema";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

/**
 * Typed API client generated from the Rust OpenAPI document.
 *
 * `fetch` is resolved at call time so tests and runtime instrumentation can
 * replace the global without rebuilding the client.
 *
 * Regenerate the schema with `pnpm generate:api` after changing API types.
 */
export const api = createClient<paths>({
  baseUrl,
  fetch: (request) => globalThis.fetch(request),
});
