import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueAuxiliaryEvent,
  enqueueDiscovery,
  loadPendingAuxiliary,
  loadPendingDiscovery,
} from "./auxiliaryQueue";
import { flushAuxiliary, loadServerDiscovery } from "./syncAuxiliary";

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let requests: RecordedRequest[] = [];

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = (request?.method ?? init?.method ?? "GET").toUpperCase();
      let body: unknown = null;
      if (request) {
        try {
          body = JSON.parse(await request.clone().text());
        } catch {
          body = null;
        }
      }
      requests.push({ url, method, body });
      return handler(url);
    }),
  );
}

function syncBody(index = 0): Record<string, unknown> {
  return requests[index].body as Record<string, unknown>;
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedQueue() {
  enqueueDiscovery({
    trackVersion: "v1",
    contentVersion: "c1",
    domains: [
      {
        domain_id: "d1",
        revealed_prompt_ids: { n1: ["p1"] },
        revealed_element_ids: {},
      },
    ],
  });
  enqueueDiscovery({
    trackVersion: "v1",
    contentVersion: "c1",
    domains: [
      {
        domain_id: "d1",
        revealed_prompt_ids: { n1: ["p2"] },
        revealed_element_ids: {},
      },
    ],
  });
  enqueueAuxiliaryEvent({
    trackId: "track",
    recommendationId: "rec-1",
    event: "shown",
    action: "learn_node",
    domainId: "d1",
    nodeId: "n1",
    questionId: null,
  });
  enqueueAuxiliaryEvent({
    trackId: "track",
    recommendationId: "rec-1",
    event: "clicked",
    action: "learn_node",
    domainId: "d1",
    nodeId: "n1",
    questionId: null,
  });
}

describe("flushAuxiliary", () => {
  it("batches multiple reveals and telemetry into one request", async () => {
    seedQueue();
    stubFetch(() =>
      jsonResponse({
        results: [],
        bits_balance: 0,
        discovery: { accepted: true },
        auxiliary: { accepted: true },
      }),
    );

    await flushAuxiliary();

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/v1/sync");
    expect(requests[0].method).toBe("POST");
    const body = syncBody();
    expect(body.events).toEqual([]);
    expect(body.discovery_updates).toHaveLength(1);
    expect(
      (body.discovery_updates as Array<{ domains: unknown[] }>)[0].domains,
    ).toHaveLength(1);
    expect(body.auxiliary_events).toHaveLength(2);

    expect(loadPendingDiscovery()).toEqual([]);
    expect(loadPendingAuxiliary()).toEqual([]);
  });

  it("makes no request when nothing is queued", async () => {
    stubFetch(() => jsonResponse({}));
    await flushAuxiliary();
    expect(requests).toHaveLength(0);
  });

  it("retains only the failed auxiliary section", async () => {
    seedQueue();
    stubFetch(() =>
      jsonResponse({
        results: [],
        bits_balance: 0,
        discovery: { accepted: false },
        auxiliary: { accepted: true },
      }),
    );

    await flushAuxiliary();

    expect(loadPendingDiscovery()).toHaveLength(1);
    expect(loadPendingAuxiliary()).toEqual([]);
  });

  it("keeps the queue when the request fails", async () => {
    seedQueue();
    stubFetch(() => {
      throw new Error("network down");
    });

    await flushAuxiliary();

    expect(loadPendingDiscovery()).toHaveLength(1);
    expect(loadPendingAuxiliary()).toHaveLength(2);
  });

  it("treats a missing section result as not accepted", async () => {
    seedQueue();
    stubFetch(() => jsonResponse({ results: [], bits_balance: 0 }));

    await flushAuxiliary();

    expect(loadPendingDiscovery()).toHaveLength(1);
    expect(loadPendingAuxiliary()).toHaveLength(2);
  });
});

describe("loadServerDiscovery", () => {
  it("returns persisted domains", async () => {
    stubFetch(() =>
      jsonResponse({
        track_version: "v1",
        domains: [
          {
            domain_id: "d1",
            revealed_prompt_ids: { n1: ["p1"] },
            revealed_element_ids: {},
          },
        ],
      }),
    );

    const domains = await loadServerDiscovery("track");
    expect(domains).toHaveLength(1);
    expect(domains?.[0].domain_id).toBe("d1");
  });

  it("returns null on failure so callers keep local progress", async () => {
    stubFetch(() => jsonResponse({ error: { code: "internal" } }, 500));
    expect(await loadServerDiscovery("track")).toBeNull();

    stubFetch(() => {
      throw new Error("offline");
    });
    expect(await loadServerDiscovery("track")).toBeNull();
  });
});
