import { describe, expect, it } from "vitest";

import type { CatalogResponse } from "../api/types";
import { missionDomainName } from "./mission";

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
