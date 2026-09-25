import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushBitSpends } from "./bitSpends";
import {
  getSettledBits,
  reconcileBits,
  resetWallet,
  spendBits,
  type PendingBitSpend,
} from "./wallet";

interface RecordedRequest {
  url: string;
  method: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let requests: RecordedRequest[] = [];

function stubFetch(
  handler: (url: string, method: string) => Response | Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : "GET";
      requests.push({ url, method });
      return handler(url, method);
    }),
  );
}

function spend(eventId: string, amount: number): PendingBitSpend {
  return {
    eventId,
    runId: "run-1",
    defenseId: "traffic_blocker",
    fromLevel: 1,
    amount,
  };
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
  resetWallet();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("flushBitSpends", () => {
  it("makes no request when nothing is queued", async () => {
    stubFetch(() => jsonResponse({}));
    expect(await flushBitSpends()).toBe("empty");
    expect(requests).toHaveLength(0);
  });

  it("settles a queued spend and adopts the server balance", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));
    stubFetch((url) => {
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ user_id: "u", bits_balance: 85 });
      }
      return jsonResponse({
        bits_balance: 85,
        spent: 15,
        newly_settled: true,
      });
    });

    expect(await flushBitSpends()).toBe("settled");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/v1/cyber-defense/upgrades");
    expect(requests[0].method).toBe("POST");
    expect(getSettledBits()).toBe(85);
  });

  it("drops an unaffordable spend and refetches the authoritative balance", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));
    stubFetch((url) => {
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ user_id: "u", bits_balance: 3 });
      }
      return jsonResponse(
        { error: { code: "insufficient_bits", message: "insufficient Bits" } },
        409,
      );
    });

    expect(await flushBitSpends()).toBe("insufficient");
    expect(getSettledBits()).toBe(3);
    expect(requests.some((request) => request.url.includes("/v1/wallet"))).toBe(
      true,
    );
  });

  it("drops a spend when no account is attached", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));
    stubFetch(() =>
      jsonResponse({ error: { code: "unauthorized", message: "unauthorized" } }, 401),
    );

    expect(await flushBitSpends()).toBe("unauthorized");
    // The optimistic debit is undone; the cached balance remains authoritative.
    expect(getSettledBits()).toBe(100);
  });

  it("keeps the queue when the request fails", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));
    stubFetch(() => {
      throw new Error("network down");
    });

    expect(await flushBitSpends()).toBe("offline");
    // Still reserved, so the display does not refund an unconfirmed spend.
    expect(getSettledBits()).toBe(85);
  });

  it("leaves other queued spends intact after a transient failure", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));
    spendBits(spend("b", 15));
    stubFetch(() => {
      throw new Error("network down");
    });

    await flushBitSpends();
    // Both remain reserved for the next flush.
    expect(getSettledBits()).toBe(70);
  });

  it("drains a spend queued while a flush is already in flight", async () => {
    reconcileBits(100);
    spendBits(spend("a", 15));

    let enqueued = false;
    stubFetch(async () => {
      if (!enqueued) {
        enqueued = true;
        // A second upgrade bought while the first request is in flight.
        spendBits(spend("b", 15));
      }
      return jsonResponse({ bits_balance: 85, spent: 15, newly_settled: true });
    });

    expect(await flushBitSpends()).toBe("settled");
    const upgrades = requests.filter((request) =>
      request.url.includes("/v1/cyber-defense/upgrades"),
    );
    expect(upgrades).toHaveLength(2);
    expect(getSettledBits()).toBe(85);
  });
});
