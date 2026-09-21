import { describe, expect, it, vi } from "vitest";

import {
  BITS_EARNED_EVENT,
  BITS_TARGET_ATTR,
  bitsTargetCenter,
  emitBitsEarned,
  type BitsEarnedDetail,
} from "./bitsFly";

describe("bitsFly", () => {
  it("dispatches a bits-earned event with an amount and coordinates", () => {
    const listener = vi.fn();
    window.addEventListener(BITS_EARNED_EVENT, listener);

    emitBitsEarned(12);

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (
      listener.mock.calls[0][0] as CustomEvent<BitsEarnedDetail>
    ).detail;
    expect(detail.amount).toBe(12);
    expect(typeof detail.x).toBe("number");
    expect(typeof detail.y).toBe("number");

    window.removeEventListener(BITS_EARNED_EVENT, listener);
  });

  it("ignores non-positive or invalid amounts", () => {
    const listener = vi.fn();
    window.addEventListener(BITS_EARNED_EVENT, listener);

    emitBitsEarned(0);
    emitBitsEarned(-5);
    emitBitsEarned(Number.NaN);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(BITS_EARNED_EVENT, listener);
  });

  it("locates the wallet target and returns null when absent", () => {
    const target = document.createElement("span");
    target.setAttribute(BITS_TARGET_ATTR, "true");
    document.body.appendChild(target);

    expect(bitsTargetCenter()).not.toBeNull();

    target.remove();
    expect(bitsTargetCenter()).toBeNull();
  });
});
