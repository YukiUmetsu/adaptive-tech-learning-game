import { describe, expect, it } from "vitest";

import { shortDomainName } from "./domainNames";

describe("shortDomainName", () => {
  it("maps the long observability name", () => {
    expect(
      shortDomainName(
        "Monitoring, Logging, Analysis, Remediation, and Performance Optimization",
      ),
    ).toBe("Observability");
  });

  it("keeps already-short names", () => {
    expect(shortDomainName("Networking")).toBe("Networking");
    expect(shortDomainName("Security and Compliance")).toBe("Security");
    expect(shortDomainName("Python 3.12")).toBe("Python 3.12");
  });

  it("falls back to the first comma segment", () => {
    expect(shortDomainName("Alpha, Beta, Gamma")).toBe("Alpha");
  });

  it("trims a long unknown name to a few words", () => {
    const short = shortDomainName("A very long unknown domain name that goes on");
    expect(short.length).toBeLessThanOrEqual(18);
    expect(short.startsWith("A")).toBe(true);
  });
});
