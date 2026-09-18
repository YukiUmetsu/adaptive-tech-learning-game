import { describe, expect, it } from "vitest";

import type { CertificationDto } from "../api/types";
import { CATALOG, buildCatalog } from "./catalogMeta";

function certification(id: string, name: string): CertificationDto {
  return {
    id,
    vendor: "AWS",
    name,
    exam_code: "SOA-C03",
    official_source_url: "https://docs.aws.amazon.com/",
    last_reviewed: "2026-09-18",
    versions: [],
  };
}

describe("buildCatalog", () => {
  it("marks a metadata entry available when the API has matching content", () => {
    const sections = buildCatalog(CATALOG, [
      certification("aws-soa-c03", "AWS Certified CloudOps Engineer - Associate"),
    ]);
    const aws = sections.find((section) => section.id === "aws");
    expect(aws).toBeDefined();

    const soa = aws?.cards.find((card) => card.id === "aws-soa-c03");
    expect(soa?.available).toBe(true);
    expect(soa?.name).toBe("AWS Certified CloudOps Engineer - Associate");

    const wip = aws?.cards.find((card) => card.id === "aws-saa-c03");
    expect(wip?.available).toBe(false);
  });

  it("keeps planned certifications disabled when there is no content", () => {
    const sections = buildCatalog(CATALOG, []);
    const cards = sections.flatMap((section) => section.cards);
    expect(cards.every((card) => !card.available)).toBe(true);
  });

  it("does not include demo certifications", () => {
    const sections = buildCatalog(CATALOG, [
      certification("aws-soa-c03-demo", "AWS SOA-C03 Interaction Demo"),
    ]);
    const ids = sections.flatMap((section) =>
      section.cards.map((card) => card.id),
    );
    expect(ids).not.toContain("aws-soa-c03-demo");
  });

  it("exposes multiple categories so the layout scales past one certification", () => {
    const sections = buildCatalog(CATALOG, []);
    expect(sections.length).toBeGreaterThan(3);
  });
});
