import { describe, expect, it } from "vitest";

import {
  PYTHON_ALLOWED_PACKAGES,
  isAllowedPythonPackage,
  normalizePackages,
  type PythonPackage,
} from "./packages";

describe("python package allowlist", () => {
  it("allows only the pinned scientific packages", () => {
    expect([...PYTHON_ALLOWED_PACKAGES]).toEqual([
      "numpy",
      "pandas",
      "matplotlib",
    ]);
    for (const name of ["numpy", "pandas", "matplotlib"]) {
      expect(isAllowedPythonPackage(name)).toBe(true);
    }
  });

  it("rejects packages that are not shipped or not permitted", () => {
    // seaborn is intentionally absent from the pinned distribution.
    for (const name of [
      "seaborn",
      "micropip",
      "requests",
      "os",
      "",
      "numpy ",
      "Numpy",
    ]) {
      expect(isAllowedPythonPackage(name)).toBe(false);
    }
    expect(isAllowedPythonPackage(42)).toBe(false);
    expect(isAllowedPythonPackage({ name: "numpy" })).toBe(false);
  });

  it("normalizes, de-duplicates, and caps untrusted lists", () => {
    expect(normalizePackages(["numpy", "seaborn", "numpy", "pandas"])).toEqual([
      "numpy",
      "pandas",
    ]);
    expect(normalizePackages("numpy")).toEqual([]);
    expect(normalizePackages(null)).toEqual([]);
    expect(normalizePackages([1, {}, "matplotlib"])).toEqual(["matplotlib"]);

    const many: PythonPackage[] = [];
    for (let index = 0; index < 50; index += 1) {
      many.push(index % 2 === 0 ? "numpy" : "pandas");
    }
    expect(normalizePackages(many)).toEqual(["numpy", "pandas"]);
  });
});
