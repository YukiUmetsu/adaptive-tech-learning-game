import { describe, expect, it } from "vitest";

import type { CertificationDto } from "../api/types";
import { demoTasks, findDemoCertification } from "./demo";

function certification(overrides: Partial<CertificationDto>): CertificationDto {
  return {
    id: "aws-soa-c03",
    vendor: "AWS",
    name: "AWS Certified CloudOps Engineer - Associate",
    exam_code: "SOA-C03",
    official_source_url: "https://docs.aws.amazon.com/",
    last_reviewed: "2026-09-18",
    versions: [
      {
        id: "soa-c03",
        exam_code: "SOA-C03",
        effective_date: "2026-06-01",
        content_version: "soa-c03-content-v1",
        domains: [],
      },
    ],
    ...overrides,
  };
}

const demo = certification({
  id: "aws-soa-c03-demo",
  name: "AWS SOA-C03 Interaction Demo",
  versions: [
    {
      id: "soa-c03-demo",
      exam_code: "SOA-C03",
      effective_date: "2026-06-01",
      content_version: "soa-c03-demo-content-v1",
      domains: [
        {
          id: "domain-2",
          name: "Reliability and Networking",
          weight: 0.5,
          tasks: [
            {
              id: "D2.1",
              name: "Diagnose VPC routing and load balancer health.",
              question_count: 9,
            },
          ],
        },
        {
          id: "domain-empty",
          name: "No authored task",
          weight: 0.5,
          tasks: [{ id: "D9.9", name: "Empty", question_count: 0 }],
        },
      ],
    },
  ],
});

describe("findDemoCertification", () => {
  it("prefers a certification whose id ends in -demo", () => {
    expect(findDemoCertification([certification({}), demo])?.id).toBe(
      "aws-soa-c03-demo",
    );
  });

  it("falls back to a certification whose name mentions demo", () => {
    const named = certification({ id: "sandbox", name: "Sandbox Demo Track" });
    expect(findDemoCertification([certification({}), named])?.id).toBe(
      "sandbox",
    );
  });

  it("returns undefined when no demo content is present", () => {
    expect(findDemoCertification([certification({})])).toBeUndefined();
  });
});

describe("demoTasks", () => {
  it("flattens authored tasks and skips empty ones", () => {
    expect(demoTasks(demo)).toEqual([
      {
        versionId: "soa-c03-demo",
        domainName: "Reliability and Networking",
        taskId: "D2.1",
        taskName: "Diagnose VPC routing and load balancer health.",
        questionCount: 9,
      },
    ]);
  });
});
