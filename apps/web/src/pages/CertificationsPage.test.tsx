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
      versions: [],
    },
    {
      id: "aws-soa-c03-demo",
      vendor: "AWS",
      name: "AWS SOA-C03 Interaction Demo",
      exam_code: "SOA-C03",
      official_source_url: "https://docs.aws.amazon.com/",
      last_reviewed: "2026-09-18",
      versions: [],
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
  it("groups cards by category and links available certifications", async () => {
    render(
      <MemoryRouter>
        <CertificationsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("link", {
          name: /AWS Certified CloudOps Engineer - Associate/,
        }),
      ).toBeInTheDocument(),
    );

    // Grouped by category header.
    expect(screen.getByRole("heading", { name: "AWS" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Microsoft Azure" }),
    ).toBeInTheDocument();

    // Available certification navigates to the dashboard, not the task page.
    expect(
      screen.getByRole("link", {
        name: /AWS Certified CloudOps Engineer - Associate/,
      }),
    ).toHaveAttribute("href", "/certifications/aws-soa-c03");

    // Planned certifications render as disabled WIP cards.
    expect(screen.getAllByText("WIP").length).toBeGreaterThan(0);
    expect(
      screen.getByText("AWS Certified Solutions Architect - Associate"),
    ).toBeInTheDocument();
  });

  it("excludes demo content from the production catalog", async () => {
    render(
      <MemoryRouter>
        <CertificationsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("link", {
          name: /AWS Certified CloudOps Engineer - Associate/,
        }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.queryByText("AWS SOA-C03 Interaction Demo"),
    ).not.toBeInTheDocument();
  });
});
