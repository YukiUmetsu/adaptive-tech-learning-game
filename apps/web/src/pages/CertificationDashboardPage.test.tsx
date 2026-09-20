import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
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
              learning_available: true,
              tasks: [{ id: "1.1", name: "A", question_count: 20 }],
            },
            {
              id: "domain-2",
              name: "Reliability and Business Continuity",
              weight: 0.22,
              learning_available: false,
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
  const auth: AuthContextValue = {
    status: "authenticated",
    user: { id: "user-1", email: "learner@example.com" },
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => "token"),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/tracks/aws-soa-c03"]}>
        <Routes>
          <Route
            path="/tracks/:certificationId"
            element={<CertificationDashboardPage />}
          />
          <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
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

  it("offers Explore Domain only where learning content exists", async () => {
    renderDashboard();
    await ready();

    const explore = screen.getByRole("link", {
      name: /Explore Domain: Monitoring and Observability/,
    });
    expect(explore).toHaveAttribute(
      "href",
      "/tracks/aws-soa-c03/domains/domain-1/learn",
    );

    expect(
      screen.queryByRole("link", {
        name: /Explore Domain: Reliability and Business Continuity/,
      }),
    ).not.toBeInTheDocument();
  });

  it("sends anonymous learners to sign in before starting a scored quiz", async () => {
    // No auth provider: the default context is anonymous.
    render(
      <MemoryRouter initialEntries={["/tracks/aws-soa-c03"]}>
        <Routes>
          <Route
            path="/tracks/:certificationId"
            element={<CertificationDashboardPage />}
          />
          <Route path="/login" element={<p>Sign in page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await ready();

    await userEvent.click(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Sign in page")).toBeInTheDocument(),
    );
    expect(posted).toHaveLength(0);
  });

  it("shows the optional recommendation when one is available", async () => {
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
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation: {
              action: "learn_node",
              reason: "cold_start",
              track_id: "aws-soa-c03",
              domain_id: "domain-1",
              domain_name: "Monitoring and Observability",
              node_id: "n1",
              node_title: "Metrics",
              question_id: null,
              assessment_mode: null,
              concept_ids: [],
              title: "Learn Metrics",
            },
          });
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderDashboard();
    await ready();

    expect(await screen.findByText("Learn Metrics")).toBeInTheDocument();
    expect(screen.getByText("Recommended next")).toBeInTheDocument();
  });

  it("stays usable when the recommendation request fails", async () => {
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
        if (url.includes("/recommendation")) {
          throw new Error("recommendation service unavailable");
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderDashboard();
    await ready();

    // The core dashboard is unaffected by the optional feature failing.
    expect(
      screen.getByRole("heading", { name: /Quick Quiz/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Domain Quiz/ })).toBeInTheDocument();
    expect(
      screen.queryByText("Recommended next"),
    ).not.toBeInTheDocument();
  });

  it("hides the Daily Mission section when it cannot be loaded", async () => {
    // Default mock returns 404 for the daily-mission endpoint.
    renderDashboard();
    await ready();

    expect(screen.queryByText("Daily Mission")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    ).toBeInTheDocument();
  });

  it("shows today's Daily Mission with progress and a continue entry point", async () => {
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
        if (url.includes("/daily-mission")) {
          return jsonResponse({
            id: "33333333-3333-4333-8333-333333333333",
            track_id: "aws-soa-c03",
            track_version: "soa-c03",
            day_key: "2026-09-20",
            plan_type: "adaptive",
            status: "active",
            reward_bits: 25,
            reward_granted: false,
            completed_items: 1,
            total_items: 2,
            created_at: "2026-09-20T08:00:00Z",
            completed_at: null,
            items: [
              {
                position: 0,
                kind: "review_node",
                domain_id: "domain-1",
                domain_name: "Monitoring and Observability",
                node_id: "n1",
                title: "Operational signals",
                estimated_minutes: 4,
                status: "completed",
                question_count: 0,
                completed_at: "2026-09-20T08:10:00Z",
              },
              {
                position: 1,
                kind: "practice",
                domain_id: "domain-1",
                domain_name: "Monitoring and Observability",
                node_id: null,
                title: "Retrieval practice",
                estimated_minutes: 6,
                status: "pending",
                question_count: 3,
                completed_at: null,
              },
            ],
          });
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderDashboard();
    await ready();

    expect(await screen.findByText("Daily Mission")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 complete")).toBeInTheDocument();
    expect(screen.getByText("Operational signals")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue Daily Mission" }),
    ).toHaveAttribute("href", "/tracks/aws-soa-c03/daily");
  });

  it("stays usable when both Daily Mission and recommendation requests fail", async () => {
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
        if (url.includes("/recommendation") || url.includes("/daily-mission")) {
          throw new Error("adaptive services unavailable");
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderDashboard();
    await ready();

    expect(screen.queryByText("Daily Mission")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Full Practice" }),
    ).toBeInTheDocument();
  });
});
