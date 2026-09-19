import { describe, expect, it } from "vitest";

import type { CertificationDto } from "../api/types";
import {
  certificationQuestionCount,
  demoTasks,
  domainQuestionCount,
  findDemoCertification,
  isDemoCertification,
} from "./demo";

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
        concepts: [],
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
      concepts: [],
      domains: [
        {
          id: "domain-2",
          name: "Reliability and Networking",
          weight: 0.5,
          learning_available: false,
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
          learning_available: false,
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

describe("isDemoCertification", () => {
  it("detects a demo id", () => {
    expect(isDemoCertification(demo)).toBe(true);
  });

  it("detects a demo name", () => {
    expect(
      isDemoCertification(
        certification({ id: "sandbox", name: "Sandbox Demo Track" }),
      ),
    ).toBe(true);
  });

  it("rejects a normal certification", () => {
    expect(isDemoCertification(certification({}))).toBe(false);
  });
});

const authored = certification({
  versions: [
    {
      id: "soa-c03",
      exam_code: "SOA-C03",
      effective_date: "2026-06-01",
      content_version: "soa-c03-content-v1",
      concepts: [],
      domains: [
        {
          id: "domain-1",
          name: "Monitoring",
          weight: 0.5,
          learning_available: false,
          tasks: [
            { id: "1.1", name: "A", question_count: 20 },
            { id: "1.2", name: "B", question_count: 20 },
          ],
        },
        {
          id: "domain-2",
          name: "Reliability",
          weight: 0.5,
          learning_available: false,
          tasks: [{ id: "2.1", name: "C", question_count: 9 }],
        },
      ],
    },
  ],
});

describe("question counts", () => {
  it("counts the questions in one domain", () => {
    expect(domainQuestionCount(authored.versions[0].domains[0])).toBe(40);
    expect(domainQuestionCount(authored.versions[0].domains[1])).toBe(9);
  });

  it("counts every question in a certification", () => {
    expect(certificationQuestionCount(authored)).toBe(49);
    expect(certificationQuestionCount(demo)).toBe(9);
    expect(certificationQuestionCount(certification({}))).toBe(0);
  });
});
