import { afterEach, describe, expect, it, vi } from "vitest";

import {
  equipCosmetic,
  getCyberProfile,
  purchaseTowerUpgrade,
  resetCyberProfile,
  setCyberProfile,
  startOperation,
  type CyberProfile,
} from "./cyberProfile";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubProfile(theme: string | null): CyberProfile {
  return {
    adversaries: [],
    bits_balance: 0,
    campaign: [],
    career: {
      level: 1,
      next_level_xp: 100,
      rank: "Analyst",
      xp: 0,
      xp_for_next_level: 100,
      xp_into_level: 0,
    },
    heroes: [],
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 1,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 1,
    tower_upgrades: [],
    unlocked_threat_level: 1,
    operations_unlocked: false,
    confrontation_available: false,
    available_adversaries: [],
    cosmetics: [],
    equipped_theme: theme,
  };
}

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

  it("applies an equipped theme to the shared profile", async () => {
    setCyberProfile(stubProfile(null));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/cosmetics/equipped")) {
          return Promise.resolve(
            jsonResponse({
              bits_balance: 0,
              cosmetics: [],
              equipped_theme: "violet-grid",
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({ ...stubProfile("violet-grid") }),
        );
      }),
    );

    const result = await equipCosmetic("violet-grid");

    expect(result.ok).toBe(true);
    expect(getCyberProfile()?.equipped_theme).toBe("violet-grid");
    resetCyberProfile();
  });
});
