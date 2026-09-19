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

    const saa = aws?.cards.find((card) => card.id === "aws-saa-c03");
    expect(saa?.available).toBe(false);

    const azure = sections.find((section) => section.id === "azure");
    const wip = azure?.cards.find((card) => card.id === "azure-az-104");
    expect(wip?.available).toBe(false);
  });

  it("drops the DVA-C02 and MLA-C01 planned entries", () => {
    const ids = CATALOG.flatMap((section) =>
      section.certifications.map((entry) => entry.id),
    );
    expect(ids).not.toContain("aws-dva-c02");
    expect(ids).not.toContain("aws-mla-c01");
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

  it("offers the PyTorch Core certification under AI when content exists", () => {
    const entries = CATALOG.flatMap((section) => section.certifications);
    const entry = entries.find(
      (candidate) => candidate.id === "ai-pytorch-core",
    );
    expect(entry?.examCode).toBe("PYTORCH-CORE");
    expect(entry?.wip).toBe(false);

    const sections = buildCatalog(CATALOG, [
      certification(
        "ai-pytorch-core",
        "PyTorch Core: Practical ML & Neural Networks",
      ),
    ]);
    const cards = sections.flatMap((section) => section.cards);
    expect(cards.find((card) => card.id === "ai-pytorch-core")?.available).toBe(
      true,
    );
  });

  it("offers the Python Fluency certification under AI when content exists", () => {
    const entries = CATALOG.flatMap((section) => section.certifications);
    const entry = entries.find(
      (candidate) => candidate.id === "ai-python-fluency",
    );
    expect(entry?.examCode).toBe("PYTHON-FLUENCY");
    expect(entry?.wip).toBe(false);

    const sections = buildCatalog(CATALOG, [
      certification("ai-python-fluency", "Python Fluency"),
    ]);
    const cards = sections.flatMap((section) => section.cards);
    expect(cards.find((card) => card.id === "ai-python-fluency")?.available).toBe(
      true,
    );
  });

  it("offers the Python Data Stack certification under AI when content exists", () => {
    const entries = CATALOG.flatMap((section) => section.certifications);
    const entry = entries.find(
      (candidate) => candidate.id === "python-data-stack",
    );
    expect(entry?.examCode).toBe("PY-DATA-STACK");
    expect(entry?.wip).toBe(false);

    const sections = buildCatalog(CATALOG, [
      certification(
        "python-data-stack",
        "Python Data Stack: NumPy, pandas, Matplotlib & Seaborn",
      ),
    ]);
    const cards = sections.flatMap((section) => section.cards);
    expect(cards.find((card) => card.id === "python-data-stack")?.available).toBe(
      true,
    );
  });

  it("offers the AWS Generative AI Developer certification and drops Linux", () => {
    const entries = CATALOG.flatMap((section) => section.certifications);
    const entry = entries.find((candidate) => candidate.id === "aws-aip-c01");
    expect(entry?.examCode).toBe("AIP-C01");
    expect(entry?.wip).toBe(false);

    const sections = buildCatalog(CATALOG, [
      certification(
        "aws-aip-c01",
        "AWS Certified Generative AI Developer - Professional",
      ),
    ]);
    const cards = sections.flatMap((section) => section.cards);
    expect(cards.find((card) => card.id === "aws-aip-c01")?.available).toBe(true);

    expect(cards.map((card) => card.id)).not.toContain("lfcs");
  });
});
