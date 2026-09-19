import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCatalogCache } from "../hooks/useCatalog";
import CertificationDashboardPage from "./CertificationDashboardPage";

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
              name: "Monitoring and Observability",
              weight: 0.22,
              tasks: [{ id: "1.1", name: "A", question_count: 20 }],
            },
            {
              id: "domain-2",
              name: "Reliability and Business Continuity",
              weight: 0.22,
              tasks: [{ id: "2.1", name: "B", question_count: 9 }],
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
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

let posted: unknown[] = [];

beforeEach(() => {
  clearCatalogCache();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/v1/certifications")) {
        return jsonResponse(catalog);
      }
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ device_id: "device", bits_balance: 1240 });
      }
      if (url.includes("/v1/missions/issue")) {
        if (input instanceof Request) {
          posted.push(JSON.parse(await input.clone().text()));
        }
        return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/certifications/aws-soa-c03"]}>
      <Routes>
        <Route
          path="/certifications/:certificationId"
          element={<CertificationDashboardPage />}
        />
        <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: /Quiz modes/ }),
    ).toBeInTheDocument(),
  );
}

describe("CertificationDashboardPage", () => {
  it("shows exactly the three learner-facing modes and the Bits HUD", async () => {
    renderDashboard();
    await ready();

    expect(
      screen.getByRole("heading", { name: /Quick Quiz/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Domain Quiz/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Full Practice/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Task Practice/ }),
    ).not.toBeInTheDocument();

    // Bits balance from the API.
    await waitFor(() =>
      expect(screen.getByLabelText("1,240 Bits")).toBeInTheDocument(),
    );

    // Domain metadata from the API content.
    expect(
      screen.getAllByText(/22% · 20 questions/).length,
    ).toBeGreaterThan(0);
  });

  it("starts a quick adaptive quiz", async () => {
    renderDashboard();
    await ready();

    await userEvent.click(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      certification_id: "aws-soa-c03",
      mode: "quick_adaptive",
      domain_id: null,
      task_id: null,
    });
  });

  it("opens the domain selector and starts a domain quiz", async () => {
    renderDashboard();
    await ready();

    await userEvent.click(screen.getByRole("button", { name: "Choose Domain" }));
    expect(
      screen.getByRole("heading", { name: "Choose a domain" }),
    ).toBeInTheDocument();

    const domainButtons = screen.getAllByRole("button", {
      name: /Domain 1/,
    });
    await userEvent.click(domainButtons[0]);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      mode: "domain_quiz",
      domain_id: "domain-1",
      task_id: null,
    });
  });

  it("starts a full practice quiz", async () => {
    renderDashboard();
    await ready();

    await userEvent.click(
      screen.getByRole("button", { name: "Start Full Practice" }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      mode: "full_practice",
      domain_id: null,
    });
  });
});
