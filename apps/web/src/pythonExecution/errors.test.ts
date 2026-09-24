import { describe, expect, it } from "vitest";

import { friendlyPythonError } from "./errors";

describe("friendly Python errors", () => {
  it("explains a syntax error and keeps the Python message", () => {
    const friendly = friendlyPythonError({
      type: "SyntaxError",
      message: "expected ':'",
      line: 3,
      sourceLine: "if age >= 18",
    });
    expect(friendly.title).toContain("syntax error");
    expect(friendly.title).toContain("line 3");
    expect(friendly.detail).toBe("expected ':'");
    expect(friendly.hint).toContain(":");
  });

  it("keeps the original error name for common runtime errors", () => {
    const friendly = friendlyPythonError({
      type: "ZeroDivisionError",
      message: "division by zero",
      line: 6,
      sourceLine: "average = total / count",
    });
    expect(friendly.title.toLowerCase()).toContain("divide by zero");
    expect(friendly.detail).toBe("division by zero");
  });

  it("uses a supplied suggestion for a NameError", () => {
    const friendly = friendlyPythonError({
      type: "NameError",
      message: "name 'totl' is not defined",
      suggestion: "total",
    });
    expect(friendly.hint).toContain("total");
  });

  it("does not invent an explanation for an unknown error", () => {
    const friendly = friendlyPythonError({
      type: "WeirdError",
      message: "something odd",
    });
    expect(friendly.title).toContain("hit an error");
    expect(friendly.hint).toBeUndefined();
  });

  it("supports every common beginner error type", () => {
    for (const type of [
      "IndentationError",
      "NameError",
      "TypeError",
      "ValueError",
      "IndexError",
      "KeyError",
      "ZeroDivisionError",
      "AttributeError",
    ]) {
      const friendly = friendlyPythonError({ type, message: "x" });
      expect(friendly.title.length).toBeGreaterThan(0);
      expect(friendly.detail).toBe("x");
    }
  });
});
