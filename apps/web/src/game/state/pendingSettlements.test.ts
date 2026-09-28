import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cyberProfile", () => ({
  completeOperation: vi.fn(),
  completeCampaign: vi.fn(),
}));

import { completeCampaign, completeOperation } from "./cyberProfile";
import {
  clearPendingSettlements,
  enqueuePendingSettlement,
  flushPendingSettlements,
  isRetryableFailure,
  pendingSettlementCount,
  readPendingSettlements,
} from "./pendingSettlements";

const operationMock = vi.mocked(completeOperation);
const campaignMock = vi.mocked(completeCampaign);

beforeEach(() => {
  window.localStorage.clear();
  operationMock.mockReset();
  campaignMock.mockReset();
});

afterEach(() => {
  clearPendingSettlements();
});

describe("pending settlement durability", () => {
  it("stores an operation completion before it is settled", () => {
    const record = enqueuePendingSettlement({
      kind: "operation",
      runId: "run-1",
      payload: { completed: true, stars: 2, health: 40, duration_ms: 120_000 },
    });

    expect(record.runId).toBe("run-1");
    const stored = readPendingSettlements();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "operation", runId: "run-1" });
  });

  it("survives a reload", () => {
    enqueuePendingSettlement({
      kind: "operation",
      runId: "run-1",
      payload: { completed: true, stars: 2, health: 40, duration_ms: 120_000 },
    });

    // A fresh read simulates a page reload from the same localStorage.
    expect(readPendingSettlements()).toHaveLength(1);
    expect(pendingSettlementCount()).toBe(1);
  });

  it("settles on success and clears the record", async () => {
    operationMock.mockResolvedValue({ ok: true, data: {} } as never);
    enqueuePendingSettlement({
      kind: "operation",
      runId: "run-1",
      payload: { completed: true, stars: 2, health: 40, duration_ms: 120_000 },
    });

    const settled = await flushPendingSettlements();

    expect(settled).toBe(1);
    expect(pendingSettlementCount()).toBe(0);
    expect(operationMock).toHaveBeenCalledWith("run-1", {
      completed: true,
      stars: 2,
      health: 40,
      duration_ms: 120_000,
    });
  });

  it("keeps the record on a network failure", async () => {
    operationMock.mockResolvedValue({
      ok: false,
      code: "network",
      message: "offline",
      activeRunId: null,
    });

    enqueuePendingSettlement({
      kind: "operation",
      runId: "run-1",
      payload: { completed: true, stars: 2, health: 40, duration_ms: 120_000 },
    });

    await flushPendingSettlements();
    expect(pendingSettlementCount()).toBe(1);
  });

  it("retries with the same run id and settles once", async () => {
    enqueuePendingSettlement({
      kind: "operation",
      runId: "run-42",
      payload: { completed: true, stars: 3, health: 80, duration_ms: 130_000 },
    });

    operationMock.mockResolvedValueOnce({
      ok: false,
      code: "network",
      message: "offline",
      activeRunId: null,
    });
    await flushPendingSettlements();

    operationMock.mockResolvedValueOnce({ ok: true, data: {} } as never);
    await flushPendingSettlements();

    expect(operationMock).toHaveBeenCalledTimes(2);
    expect(operationMock.mock.calls[0][0]).toBe("run-42");
    expect(operationMock.mock.calls[1][0]).toBe("run-42");
    expect(pendingSettlementCount()).toBe(0);
  });

  it("reuses the same campaign result_id across retries", async () => {
    const record = enqueuePendingSettlement({
      kind: "campaign",
      missionId: "ddos-basics",
      resultId: "fixed-result-id",
      payload: { stars: 3, health: 90, duration_ms: 90_000, hero_id: "sre" },
    });

    campaignMock.mockResolvedValueOnce({
      ok: false,
      code: "network",
      message: "offline",
      activeRunId: null,
    });
    await flushPendingSettlements();

    campaignMock.mockResolvedValueOnce({ ok: true, data: {} } as never);
    await flushPendingSettlements();

    expect(campaignMock).toHaveBeenCalledTimes(2);
    for (const call of campaignMock.mock.calls) {
      expect(call[0]).toBe("ddos-basics");
      expect(call[1].result_id).toBe(record.resultId);
    }
  });

  it("drops a permanently rejected settlement instead of retrying forever", async () => {
    operationMock.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "gone",
      activeRunId: null,
    });

    enqueuePendingSettlement({
      kind: "operation",
      runId: "run-1",
      payload: { completed: true, stars: 2, health: 40, duration_ms: 120_000 },
    });

    await flushPendingSettlements();
    expect(pendingSettlementCount()).toBe(0);
  });

  it("classifies retryable failures", () => {
    expect(isRetryableFailure({ ok: true, data: {} })).toBe(false);
    expect(
      isRetryableFailure({
        ok: false,
        code: "network",
        message: "",
        activeRunId: null,
      }),
    ).toBe(true);
    expect(
      isRetryableFailure({
        ok: false,
        code: "bad_request",
        message: "",
        activeRunId: null,
      }),
    ).toBe(false);
  });
});
