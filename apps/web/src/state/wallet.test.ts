import { beforeEach, describe, expect, it } from "vitest";

import {
  getDisplayBits,
  getSettledBits,
  previewBits,
  reconcileBits,
} from "./wallet";

beforeEach(() => {
  window.localStorage.clear();
  reconcileBits(0);
});

describe("wallet store", () => {
  it("adds previews on top of the settled balance", () => {
    reconcileBits(100);
    previewBits(12);

    expect(getSettledBits()).toBe(100);
    expect(getDisplayBits()).toBe(112);
  });

  it("reconciles to the authoritative server balance and clears previews", () => {
    reconcileBits(50);
    previewBits(5);
    reconcileBits(62);

    expect(getSettledBits()).toBe(62);
    expect(getDisplayBits()).toBe(62);
  });

  it("ignores non-positive previews", () => {
    reconcileBits(10);
    previewBits(0);
    previewBits(-3);

    expect(getDisplayBits()).toBe(10);
  });

  it("never reports a negative settled balance", () => {
    reconcileBits(-50);
    expect(getSettledBits()).toBe(0);
  });
});
