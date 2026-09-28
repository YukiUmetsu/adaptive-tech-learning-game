import { afterEach, describe, expect, it } from "vitest";

import { readLastHeroId, writeLastHeroId } from "./heroSelection";

const HEROES = ["security_engineer", "sre"];

describe("hero selection memory", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(readLastHeroId(HEROES)).toBeNull();
  });

  it("remembers and restores a valid hero", () => {
    writeLastHeroId("sre");
    expect(readLastHeroId(HEROES)).toBe("sre");
  });

  it("falls back safely when the stored id is invalid", () => {
    writeLastHeroId("oracle");
    expect(readLastHeroId(HEROES)).toBeNull();
  });
});
