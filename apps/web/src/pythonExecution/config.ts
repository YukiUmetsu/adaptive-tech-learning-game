/**
 * Pinned Python/WebAssembly runtime configuration.
 *
 * The loader never uses an unversioned CDN URL. `PYODIDE_VERSION` names both
 * the Pyodide release and the self-hosted asset directory, so changing the
 * version changes every runtime URL and bypasses the immutable HTTP cache.
 *
 * This module is imported from both the main thread and the sandbox worker, so
 * it must not reach for `window`.
 */

/** Pinned Pyodide release. Bump deliberately; assets must be re-synced. */
export const PYODIDE_VERSION = "314.0.7";

/** Versioned, self-hosted runtime directory. */
export const PYODIDE_RUNTIME_PATH = `python-runtime/pyodide/${PYODIDE_VERSION}/`;

/** Sandbox page path. Built as a separate Vite entry, not the SPA shell. */
export const SANDBOX_PAGE_PATH = "python-sandbox/index.html";

function baseUrl(): string {
  return import.meta.env.BASE_URL ?? "/";
}

/** Absolute URL of the versioned Pyodide asset directory. */
export function pythonRuntimeBaseUrl(): string {
  return new URL(`${baseUrl()}${PYODIDE_RUNTIME_PATH}`, `${self.location.origin}/`).href;
}

/** The origin serving the application. */
export function appOrigin(): string {
  return self.location.origin;
}

/**
 * Parses a configured sandbox origin.
 *
 * Only absolute `http(s)` origins are accepted. Anything else (including
 * `javascript:`, `data:`, credentials, or a path) is rejected so a bad build
 * variable cannot point the iframe at an unexpected document.
 */
export function parseSandboxOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return null;
  }
  return url.origin;
}

/**
 * An optional dedicated sandbox origin.
 *
 * The sandbox works on the app origin because learner Python is given no JS
 * bridge and the worker platform already hides `document`/`localStorage`.
 * Setting a distinct origin is still supported as stronger, browser-enforced
 * isolation for deployments that want it.
 */
export function dedicatedSandboxOrigin(): string | null {
  return parseSandboxOrigin(import.meta.env.VITE_PYTHON_SANDBOX_ORIGIN);
}

/** Whether learner code is isolated on a browser-enforced distinct origin. */
export function hasDedicatedSandboxOrigin(): boolean {
  const origin = dedicatedSandboxOrigin();
  return origin !== null && origin !== self.location.origin;
}

/** Origin that hosts the sandbox page. Defaults to the app origin. */
export function sandboxOrigin(): string {
  return dedicatedSandboxOrigin() ?? self.location.origin;
}

/** Absolute URL of the sandbox page on the configured sandbox origin. */
export function sandboxPageUrl(): string {
  return new URL(`${baseUrl()}${SANDBOX_PAGE_PATH}`, `${sandboxOrigin()}/`).href;
}
