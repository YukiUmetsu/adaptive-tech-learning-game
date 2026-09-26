/**
 * Approved Python packages the sandbox may load.
 *
 * Packages are loaded from the pinned, self-hosted Pyodide distribution using
 * Pyodide's own package loader. No package index, PyPI, `micropip`, or
 * `loadPackagesFromImports()` is ever involved: learner code cannot request a
 * package, and only names on this list are ever passed to the loader.
 *
 * `seaborn` is intentionally absent: the pinned Pyodide build (see
 * `PYODIDE_VERSION`) does not ship it. Adding it would require `micropip` to
 * fetch a wheel from PyPI, which would widen the sandbox's network policy and
 * reintroduce arbitrary package installation. Prefer a Pyodide release that
 * ships it, or a separately reviewed vendored wheel.
 *
 * The Apache Airflow study shim (`src/pythonSandbox/airflowShim.ts`) is a
 * sandbox built-in, not a package: it is never listed here and never loaded
 * from PyPI. Content imports `airflow` without declaring it.
 */
export const PYTHON_ALLOWED_PACKAGES = ["numpy", "pandas", "matplotlib"] as const;

/** A package name the sandbox is allowed to load. */
export type PythonPackage = (typeof PYTHON_ALLOWED_PACKAGES)[number];

const ALLOWED = new Set<string>(PYTHON_ALLOWED_PACKAGES);

/** Largest number of packages one question may declare. */
export const MAX_DECLARED_PACKAGES = 8;

/** Whether a value is an approved package name. */
export function isAllowedPythonPackage(value: unknown): value is PythonPackage {
  return typeof value === "string" && ALLOWED.has(value);
}

/**
 * Filters an untrusted package list down to approved, de-duplicated names.
 *
 * Used on the client before sending and again in the worker before loading, so
 * a malformed or hostile message can never widen the runtime's capabilities.
 */
export function normalizePackages(value: unknown): PythonPackage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: PythonPackage[] = [];
  for (const entry of value) {
    if (isAllowedPythonPackage(entry) && !result.includes(entry)) {
      result.push(entry);
    }
    if (result.length >= MAX_DECLARED_PACKAGES) {
      break;
    }
  }
  return result;
}
