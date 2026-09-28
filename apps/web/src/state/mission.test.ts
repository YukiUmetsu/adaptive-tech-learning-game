import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogResponse, MissionResponse } from "../api/types";
import { loadMission } from "./persistence";
import { missionDomainName, startChallenge } from "./mission";

/**
 * Domain ids are only unique within a track, so the same id can appear in several
 * tracks. This guards the regression where a mission showed another track's
 * domain name (for example a Python Data Stack domain on an AWS mission).
 */
const catalog: CatalogResponse = {
  certifications: [
    {
      id: "python-data-stack",
      vendor: "AI",
      name: "Python Data Stack",
      exam_code: "PY-DATA-STACK",
      official_source_url: "https://example.com",
      last_reviewed: "2026-09-18",
      versions: [
        {
          id: "python-data-stack-v1",
          exam_code: "PY-DATA-STACK",
          effective_date: "2026-06-01",
          content_version: "v1",
          concepts: [],
          domains: [
            {
              id: "domain-3",
              name: "Matplotlib: Plot Selection & Object-Oriented Plotting",
              weight: 0.25,
              learning_available: true,
              tasks: [],
            },
          ],
        },
      ],
    },
    {
      id: "aws-soa-c03",
      vendor: "AWS",
      name: "AWS Certified CloudOps Engineer",
      exam_code: "SOA-C03",
      official_source_url: "https://example.com",
      last_reviewed: "2026-09-18",
      versions: [
        {
          id: "soa-c03",
          exam_code: "SOA-C03",
          effective_date: "2026-06-01",
          content_version: "soa-c03-content-v1",
          concepts: [],
          domains: [
            {
              id: "domain-3",
              name: "Deployment, Provisioning, and Automation",
              weight: 0.22,
              learning_available: true,
              tasks: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("missionDomainName", () => {
  it("scopes the domain name to the mission's own certification", () => {
    expect(
      missionDomainName(
        {
          certification_id: "aws-soa-c03",
          certification_version: "soa-c03",
          domain_id: "domain-3",
        },
        catalog,
      ),
    ).toBe("Deployment, Provisioning, and Automation");

    expect(
      missionDomainName(
        {
          certification_id: "python-data-stack",
          certification_version: "python-data-stack-v1",
          domain_id: "domain-3",
        },
        catalog,
      ),
    ).toBe("Matplotlib: Plot Selection & Object-Oriented Plotting");
  });

  it("returns undefined for an unknown or missing domain", () => {
    expect(
      missionDomainName(
        {
          certification_id: "aws-soa-c03",
          certification_version: "soa-c03",
          domain_id: "domain-99",
        },
        catalog,
      ),
    ).toBeUndefined();
    expect(
      missionDomainName(
        {
          certification_id: "aws-soa-c03",
          certification_version: "soa-c03",
          domain_id: null,
        },
        catalog,
      ),
    ).toBeUndefined();
  });
});

describe("startChallenge", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the challenge endpoint and persists stage progress", async () => {
    const issued = {
      id: "44444444-4444-4444-8444-444444444444",
      mode: "challenge",
      challenge: { id: "ch-1", title: "Journey", stages: [] },
      questions: [],
    } as unknown as MissionResponse;
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify(issued), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await startChallenge({
      certificationId: "ai-python-fluency",
      challengeId: "ch-1",
    });

    expect(result.id).toBe(issued.id);
    const input = fetchMock.mock.calls[0]?.[0];
    const request = input instanceof Request ? input : null;
    const url = String(request ? request.url : input);
    expect(url).toContain(
      "/v1/tracks/ai-python-fluency/challenges/ch-1/start",
    );
    const body = JSON.parse((await request?.clone().text()) ?? "{}");
    expect(body).not.toHaveProperty("question_ids");
    expect(body.discovery).toEqual([]);

    const progress = loadMission();
    expect(progress?.mission.id).toBe(issued.id);
    expect(progress?.stageIndex).toBe(0);
    expect(progress?.finished).toBe(false);
  });
});
