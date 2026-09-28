import { afterEach, describe, expect, it, vi } from "vitest";

import { purchaseTowerUpgrade, startOperation } from "./cyberProfile";

/**
 * Regression tests for the Cyber Defense action helpers.
 *
 * A rejected `fetch` (offline, timeout, aborted) must resolve to an `ok: false`
 * result. If it rejected instead, a caller's busy state would stay set — which
 * is exactly the "Upgrading…" hang this guards against.
 */
describe("cyberProfile action helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns a rejected purchase request into a retryable failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const result = await purchaseTowerUpgrade(
      "soc",
      "11111111-1111-1111-1111-111111111111",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("network");
      expect(result.message).toMatch(/could not reach the server/i);
    }
  });

  it("turns a rejected start request into a retryable failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const result = await startOperation({ requested_threat_level: 3 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("network");
      expect(result.activeRunId).toBeNull();
    }
  });
});
