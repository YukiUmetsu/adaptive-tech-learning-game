import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCatalogCache } from "../hooks/useCatalog";
import CertificationsPage from "./CertificationsPage";

const catalog = {
  certifications: [
    {
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
          domains: [
            {
              id: "domain-1",
              name: "Monitoring",
              weight: 0.22,
              tasks: [
                { id: "1.1", name: "A", question_count: 20 },
                { id: "1.2", name: "B", question_count: 20 },
              ],
            },
            {
              id: "domain-2",
              name: "Reliability",
              weight: 0.22,
              tasks: [{ id: "2.1", name: "C", question_count: 9 }],
            },
          ],
        },
      ],
    },
    {
      id: "aws-soa-c03-demo",
      vendor: "AWS",
      name: "AWS SOA-C03 Interaction Demo",
      exam_code: "SOA-C03",
      official_source_url: "https://docs.aws.amazon.com/",
      last_reviewed: "2026-09-18",
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
                { id: "D2.1", name: "Demo task", question_count: 9 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearCatalogCache();
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(catalog)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CertificationsPage", () => {
  it("shows domain and certification question totals", async () => {
    render(
      <MemoryRouter>
        <CertificationsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "AWS Certified CloudOps Engineer - Associate",
        }),
      ).toBeInTheDocument(),
    );

    // Certification total: 20 + 20 + 9 = 49.
    expect(screen.getByText(/49 questions/)).toBeInTheDocument();
    // Per-domain totals.
    expect(screen.getByText(/· 40 questions/)).toBeInTheDocument();
    expect(screen.getByText(/· 9 questions/)).toBeInTheDocument();
  });

  it("does not list demo certifications", async () => {
    render(
      <MemoryRouter>
        <CertificationsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "AWS Certified CloudOps Engineer - Associate",
        }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.queryByText("AWS SOA-C03 Interaction Demo"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/D2\.1/)).not.toBeInTheDocument();
  });
});
