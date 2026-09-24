import { describe, expect, it } from "vitest";

import { mergeGlossaryTerms } from "./glossaryContext";

describe("mergeGlossaryTerms", () => {
  it("keeps domain terms and adds page terms", () => {
    const merged = mergeGlossaryTerms(
      [{ term: "IaC", definition: "Infrastructure as Code." }],
      [{ term: "stateful firewall", definition: "Remembers connection state." }],
    );

    expect(merged.map((term) => term.term)).toEqual([
      "stateful firewall",
      "IaC",
    ]);
  });

  it("lets a page term override a domain term with the same text", () => {
    const merged = mergeGlossaryTerms(
      [{ term: "IaC", definition: "Domain definition." }],
      [{ term: "iac", definition: "Page definition." }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].definition).toBe("Page definition.");
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    const merged = mergeGlossaryTerms(
      [{ term: "Warm Standby", definition: "Domain." }],
      [{ term: "  warm standby ", definition: "Page." }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].definition).toBe("Page.");
  });

  it("returns the domain glossary when the page has none", () => {
    const domain = [{ term: "IaC", definition: "Infrastructure as Code." }];
    expect(mergeGlossaryTerms(domain, [])).toEqual(domain);
  });

  it("returns the page glossary when the domain has none", () => {
    const page = [{ term: "IaC", definition: "Infrastructure as Code." }];
    expect(mergeGlossaryTerms([], page)).toEqual(page);
  });
});
