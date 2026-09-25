import { beforeEach, describe, expect, it } from "vitest";

import {
  getDisplayBits,
  getPendingBitSpends,
  getSettledBits,
  previewBits,
  reconcileBits,
  refundBits,
  resetWallet,
  settleSpend,
  spendBits,
  type PendingBitSpend,
} from "./wallet";

beforeEach(() => {
  window.localStorage.clear();
  resetWallet();
});

function spend(eventId: string, amount: number): PendingBitSpend {
  return {
    eventId,
    runId: "run-1",
    defenseId: "traffic_blocker",
    fromLevel: 1,
    amount,
  };
}

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

  it("reserves a spend locally and survives an unrelated reconciliation", () => {
    reconcileBits(100);

    expect(spendBits(spend("a", 15))).toBe(true);
    expect(getSettledBits()).toBe(85);
    expect(getPendingBitSpends()).toHaveLength(1);

    // The server has not recorded the spend yet; reconciling must not refund it.
    reconcileBits(100);
    expect(getSettledBits()).toBe(85);
  });

  it("refuses a spend larger than the available balance", () => {
    reconcileBits(10);

    expect(spendBits(spend("a", 15))).toBe(false);
    expect(getSettledBits()).toBe(10);
    expect(getPendingBitSpends()).toHaveLength(0);
  });

  it("does not double-count a re-queued event", () => {
    reconcileBits(100);

    spendBits(spend("a", 15));
    spendBits(spend("a", 15));

    expect(getPendingBitSpends()).toHaveLength(1);
    expect(getSettledBits()).toBe(85);
  });

  it("adopts the settled balance and drops the confirmed spend", () => {
    reconcileBits(100);
    spendBits(spend("a", 15));

    settleSpend("a", 85);
    expect(getSettledBits()).toBe(85);
    expect(getPendingBitSpends()).toHaveLength(0);
  });

  it("restores the reserved amount when a spend is refunded", () => {
    reconcileBits(100);
    spendBits(spend("a", 15));

    refundBits("a");
    expect(getSettledBits()).toBe(100);
    expect(getPendingBitSpends()).toHaveLength(0);
  });

  it("clears queued spends on reset", () => {
    reconcileBits(100);
    spendBits(spend("a", 15));

    resetWallet();
    expect(getSettledBits()).toBe(0);
    expect(getPendingBitSpends()).toHaveLength(0);
  });
});
