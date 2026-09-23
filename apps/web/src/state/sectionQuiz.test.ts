import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSectionQuizProgress,
  isSectionQuizComplete,
  loadSectionQuizModules,
  markSectionQuizComplete,
} from "./sectionQuiz";

describe("section quiz progress", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("records completed sections and scopes them to a track version/domain", () => {
    expect(loadSectionQuizModules("v1", "domain-1").size).toBe(0);

    markSectionQuizComplete("v1", "domain-1", "m1");

    expect(isSectionQuizComplete("v1", "domain-1", "m1")).toBe(true);
    expect(isSectionQuizComplete("v1", "domain-1", "m2")).toBe(false);
    // Different version and different domain are independent scopes.
    expect(isSectionQuizComplete("v2", "domain-1", "m1")).toBe(false);
    expect(isSectionQuizComplete("v1", "domain-2", "m1")).toBe(false);
  });

  it("is idempotent and ignores empty identifiers", () => {
    markSectionQuizComplete("v1", "domain-1", "m1");
    markSectionQuizComplete("v1", "domain-1", "m1");
    expect(loadSectionQuizModules("v1", "domain-1")).toEqual(new Set(["m1"]));

    markSectionQuizComplete("", "domain-1", "m1");
    markSectionQuizComplete("v1", "", "m1");
    markSectionQuizComplete("v1", "domain-1", "");
    expect(loadSectionQuizModules("v1", "domain-1")).toEqual(new Set(["m1"]));
  });

  it("clears a domain's completed sections", () => {
    markSectionQuizComplete("v1", "domain-1", "m1");
    clearSectionQuizProgress("v1", "domain-1");
    expect(loadSectionQuizModules("v1", "domain-1").size).toBe(0);
  });

  it("treats malformed stored data as empty", () => {
    window.localStorage.setItem("adaptive-learn.section-quiz.v1", "{not json");
    expect(loadSectionQuizModules("v1", "domain-1").size).toBe(0);
  });
});
