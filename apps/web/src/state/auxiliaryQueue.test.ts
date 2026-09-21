import { beforeEach, describe, expect, it } from "vitest";

import {
  enqueueAuxiliaryEvent,
  enqueueDiscovery,
  loadPendingAuxiliary,
  loadPendingDiscovery,
  markAuxiliarySynced,
  markDiscoverySent,
  MAX_PENDING_AUXILIARY_EVENTS,
  PENDING_AUXILIARY_KEY,
  PENDING_DISCOVERY_KEY,
} from "./auxiliaryQueue";

beforeEach(() => {
  window.localStorage.clear();
});

describe("auxiliaryQueue", () => {
  it("merges repeated discovery enqueues into one deduplicated entry", () => {
    enqueueDiscovery({
      trackVersion: "v1",
      contentVersion: "c1",
      domains: [
        {
          domain_id: "d1",
          revealed_prompt_ids: { n1: ["p1", "p1"] },
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
          revealed_element_ids: { n1: { p1: ["annotation:a1"] } },
        },
      ],
    });

    const pending = loadPendingDiscovery();
    expect(pending).toHaveLength(1);
    expect(pending[0].domains).toHaveLength(1);
    expect(pending[0].domains[0].revealed_prompt_ids).toEqual({
      n1: ["p1", "p2"],
    });
    expect(pending[0].domains[0].revealed_element_ids).toEqual({
      n1: { p1: ["annotation:a1"] },
    });
  });

  it("keeps one pending entry per track version", () => {
    enqueueDiscovery({
      trackVersion: "v1",
      contentVersion: "c1",
      domains: [{ domain_id: "d1", revealed_prompt_ids: {}, revealed_element_ids: {} }],
    });
    enqueueDiscovery({
      trackVersion: "v2",
      contentVersion: "c1",
      domains: [{ domain_id: "d1", revealed_prompt_ids: {}, revealed_element_ids: {} }],
    });
    expect(loadPendingDiscovery()).toHaveLength(2);
  });

  it("removes only the sent reveals and keeps a track's other work", () => {
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
      trackVersion: "v2",
      contentVersion: "c1",
      domains: [
        {
          domain_id: "d1",
          revealed_prompt_ids: { n1: ["p1"] },
          revealed_element_ids: {},
        },
      ],
    });

    markDiscoverySent([
      {
        trackVersion: "v1",
        contentVersion: "c1",
        domains: [
          {
            domain_id: "d1",
            revealed_prompt_ids: { n1: ["p1"] },
            revealed_element_ids: {},
          },
        ],
      },
    ]);
    expect(loadPendingDiscovery().map((entry) => entry.trackVersion)).toEqual(["v2"]);
  });

  it("keeps a reveal added while a sync was in flight", () => {
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
    // Snapshot exactly what would be sent.
    const sent = loadPendingDiscovery();

    // A reveal lands after the snapshot but before the response is applied.
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

    markDiscoverySent(sent);

    const remaining = loadPendingDiscovery();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].domains[0].revealed_prompt_ids).toEqual({ n1: ["p2"] });
  });

  it("deduplicates telemetry by recommendation, event, and target", () => {
    const base = {
      trackId: "track",
      recommendationId: "rec-1",
      event: "shown" as const,
      action: null,
      domainId: null,
      nodeId: "n1",
      questionId: null,
    };
    expect(enqueueAuxiliaryEvent(base)).toBe(true);
    expect(enqueueAuxiliaryEvent(base)).toBe(true);
    expect(loadPendingAuxiliary()).toHaveLength(1);

    // A distinct event on the same recommendation is a distinct entry.
    enqueueAuxiliaryEvent({ ...base, event: "clicked" });
    expect(loadPendingAuxiliary()).toHaveLength(2);
  });

  it("removes only synced telemetry ids", () => {
    enqueueAuxiliaryEvent({
      trackId: "track",
      recommendationId: "rec-1",
      event: "shown",
      action: null,
      domainId: null,
      nodeId: "n1",
      questionId: null,
    });
    enqueueAuxiliaryEvent({
      trackId: "track",
      recommendationId: "rec-1",
      event: "clicked",
      action: null,
      domainId: null,
      nodeId: "n1",
      questionId: null,
    });
    const [first] = loadPendingAuxiliary();
    markAuxiliarySynced([first.id]);
    expect(loadPendingAuxiliary()).toHaveLength(1);
    expect(loadPendingAuxiliary()[0].event).toBe("clicked");
  });

  it("ignores malformed stored values", () => {
    window.localStorage.setItem(PENDING_DISCOVERY_KEY, "{not json");
    window.localStorage.setItem(PENDING_AUXILIARY_KEY, JSON.stringify([{ bad: true }]));
    expect(loadPendingDiscovery()).toEqual([]);
    expect(loadPendingAuxiliary()).toEqual([]);
  });

  it("bounds the pending telemetry queue by dropping the oldest", () => {
    for (let index = 0; index < MAX_PENDING_AUXILIARY_EVENTS + 10; index += 1) {
      enqueueAuxiliaryEvent({
        trackId: "track",
        recommendationId: `rec-${index}`,
        event: "shown",
        action: null,
        domainId: null,
        nodeId: `n-${index}`,
        questionId: null,
      });
    }

    const pending = loadPendingAuxiliary();
    expect(pending).toHaveLength(MAX_PENDING_AUXILIARY_EVENTS);
    expect(pending.some((event) => event.recommendationId === "rec-0")).toBe(false);
    expect(
      pending.some(
        (event) =>
          event.recommendationId === `rec-${MAX_PENDING_AUXILIARY_EVENTS + 9}`,
      ),
    ).toBe(true);
  });
});
