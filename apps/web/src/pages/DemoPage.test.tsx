import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCatalogCache } from "../hooks/useCatalog";
import DemoPage from "./DemoPage";

const realCertification = {
  id: "aws-soa-c03",
  vendor: "AWS",
  name: "AWS Certified CloudOps Engineer - Associate",
  exam_code: "SOA-C03",
  official_source_url: "https://docs.aws.amazon.com/",
  last_reviewed: "2026-09-18",
  versions: [],
};

const demoCertification = {
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
            {
              id: "D2.1",
              name: "Diagnose VPC routing and load balancer health.",
              question_count: 9,
            },
          ],
        },
      ],
    },
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

beforeEach(() => {
  clearCatalogCache();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoPage", () => {
  it("lists demo tasks and issues a mission when started", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/v1/certifications")) {
          return jsonResponse({
            certifications: [realCertification, demoCertification],
          });
        }
        if (url.includes("/v1/missions/issue")) {
          if (input instanceof Request) {
            posted.push(JSON.parse(await input.clone().text()));
          }
          return jsonResponse({
            id: "11111111-1111-1111-1111-111111111111",
          });
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    render(
      <MemoryRouter>
        <DemoPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start demo mission" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Task D2.1")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Start demo mission" }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      certification_id: "aws-soa-c03-demo",
      certification_version: "soa-c03-demo",
      task_id: "D2.1",
    });
    expect(
      window.localStorage.getItem("adaptive-learn.active-mission"),
    ).not.toBeNull();
  });

  it("shows a message when no demo content exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ certifications: [realCertification] }),
      ),
    );

    render(
      <MemoryRouter>
        <DemoPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Demo content is not available right now."),
      ).toBeInTheDocument(),
    );
  });
});
