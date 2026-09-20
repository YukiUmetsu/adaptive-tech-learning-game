import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearStreakCache, loadStreak, peekStreak } from "./streak";
import { clearTrackMapCache, loadTrackMap } from "./trackMap";
import {
  clearTrackProgressCache,
  loadTrackProgress,
  signalIndex,
} from "./trackProgress";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let requests = 0;

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests += 1;
      const url = input instanceof Request ? input.url : String(input);
      return handler(url);
    }),
  );
}

beforeEach(() => {
  requests = 0;
  clearStreakCache();
  clearTrackMapCache();
  clearTrackProgressCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackProgress", () => {
  const progress = {
    track_id: "t",
    track_version: "v1",
    content_version: "c1",
    domains: [
      {
        domain_id: "d1",
        nodes: [
          {
            node_id: "n1",
            discovery_state: "explored",
            evidence_level: "early",
            freshness_state: "fresh",
            mode_signals: [],
          },
        ],
      },
    ],
  };

  it("flattens the aggregate response into a node index", () => {
    const index = signalIndex(progress as never);
    expect(index.get("n1")?.evidence_level).toBe("early");
    expect(signalIndex(null).size).toBe(0);
  });

  it("caches and deduplicates, and returns null on failure", async () => {
    stubFetch(() => jsonResponse(progress));
    const first = await loadTrackProgress("t");
    const second = await loadTrackProgress("t");
    expect(first).toBe(second);
    expect(requests).toBe(1);

    clearTrackProgressCache();
    stubFetch(() => jsonResponse({ error: { code: "internal" } }, 500));
    expect(await loadTrackProgress("t")).toBeNull();
  });
});

describe("trackMap", () => {
  const map = {
    track_id: "t",
    track_version: "v1",
    content_version: "c1",
    domains: [],
  };

  it("caches and returns null on failure", async () => {
    stubFetch(() => jsonResponse(map));
    expect(await loadTrackMap("t")).toEqual(map);
    await loadTrackMap("t");
    expect(requests).toBe(1);

    clearTrackMapCache();
    stubFetch(() => jsonResponse({ error: { code: "not_found" } }, 404));
    expect(await loadTrackMap("t")).toBeNull();
  });
});

describe("streak", () => {
  const me = {
    id: "u1",
    email: null,
    authenticated: true,
    streak: {
      current: 3,
      longest: 5,
      active_today: true,
      last_active_day: "2026-09-20",
    },
  };

  it("maps the account streak and caches it", async () => {
    stubFetch(() => jsonResponse(me));
    const streak = await loadStreak();
    expect(streak).toEqual({
      current: 3,
      longest: 5,
      activeToday: true,
      lastActiveDay: "2026-09-20",
    });
    expect(peekStreak()).toEqual(streak);
    await loadStreak();
    expect(requests).toBe(1);
  });

  it("returns null and leaves no cache on failure", async () => {
    stubFetch(() => jsonResponse({ error: { code: "internal" } }, 500));
    expect(await loadStreak()).toBeNull();
    expect(peekStreak()).toBeNull();
  });
});
