import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
import { clearCatalogCache } from "../hooks/useCatalog";
import { clearStreakCache } from "../state/streak";
import { clearTrackMapCache } from "../state/trackMap";
import { clearTrackProgressCache } from "../state/trackProgress";
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

function node(id: string, title: string, x: number) {
  return {
    id,
    title,
    concept_ids: [`concept.${id}`],
    prerequisite_node_ids: [],
    map_position: { x, y: 0 },
    prompts: [],
    source_refs: [],
  };
}

const trackMap = {
  track_id: "aws-soa-c03",
  track_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  domains: [
    {
      schema_version: "1.0.0",
      content_version: "soa-c03-content-v1",
      certification_id: "aws-soa-c03",
      certification_version: "soa-c03",
      exam_guide_revision: null,
      domain: { id: "domain-1", name: "Monitoring and Observability", weight: 0.22 },
      learning_design: {
        progress_label: "Discovery Progress",
        unlock_rule: "Unlock",
        mastery_note: "Explore first.",
      },
      source_refs: [],
      modules: [
        {
          id: "module-1",
          title: "Signals",
          order: 1,
          task_ids: [],
          skill_ids: [],
          prerequisite_module_ids: [],
          nodes: [node("n1", "Metrics", 0), node("n2", "Logs", 1)],
        },
      ],
    },
    {
      schema_version: "1.0.0",
      content_version: "soa-c03-content-v1",
      certification_id: "aws-soa-c03",
      certification_version: "soa-c03",
      exam_guide_revision: null,
      domain: { id: "domain-2", name: "Networking", weight: 0.22 },
      learning_design: {
        progress_label: "Discovery Progress",
        unlock_rule: "Unlock",
        mastery_note: "Explore first.",
      },
      source_refs: [],
      modules: [
        {
          id: "module-2",
          title: "Routes",
          order: 1,
          task_ids: [],
          skill_ids: [],
          prerequisite_module_ids: [],
          nodes: [node("n3", "Route Tables", 0)],
        },
      ],
    },
  ],
};

const progress = {
  track_id: "aws-soa-c03",
  track_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  domains: [
    {
      domain_id: "domain-1",
      nodes: [
        {
          node_id: "n1",
          discovery_state: "unexplored",
          evidence_level: "developing",
          freshness_state: "due",
          mode_signals: [
            { assessment_mode: "recall", evidence_level: "developing", freshness_state: "due" },
          ],
        },
      ],
    },
  ],
};

const streak = {
  current: 12,
  longest: 20,
  active_today: true,
  last_active_day: "2026-09-20",
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

interface MockOptions {
  map?: boolean;
  progress?: boolean;
  streak?: boolean;
  recommendation?: boolean;
  dailyMission?: boolean;
}

function stubHub(options: MockOptions = {}) {
  const {
    map = true,
    progress: withProgress = true,
    streak: withStreak = true,
    recommendation = false,
    dailyMission = false,
  } = options;

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
      if (url.includes("/v1/tracks/aws-soa-c03/map")) {
        return map
          ? jsonResponse(trackMap)
          : jsonResponse({ error: { code: "internal" } }, 500);
      }
      if (url.includes("/v1/tracks/aws-soa-c03/progress")) {
        return withProgress
          ? jsonResponse(progress)
          : jsonResponse({ error: { code: "internal" } }, 500);
      }
      if (url.includes("/v1/me")) {
        return withStreak
          ? jsonResponse({
              id: "user-1",
              email: "learner@example.com",
              authenticated: true,
              streak,
              settings: { unlock_all_materials: false },
            })
          : jsonResponse({ error: { code: "internal" } }, 500);
      }
      if (url.includes("/recommendation")) {
        if (!recommendation) {
          return jsonResponse({ error: { code: "not_found" } }, 404);
        }
        return jsonResponse({
          recommendation_id: "11111111-1111-4111-8111-111111111111",
          recommendation: {
            action: "learn_node",
            reason: "cold_start",
            track_id: "aws-soa-c03",
            domain_id: "domain-1",
            domain_name: "Monitoring and Observability",
            node_id: "n2",
            node_title: "Logs",
            question_id: null,
            assessment_mode: null,
            concept_ids: [],
            title: "Learn Logs",
          },
        });
      }
      if (url.includes("/daily-mission")) {
        if (!dailyMission) {
          return jsonResponse({ error: { code: "not_found" } }, 404);
        }
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
          items: [],
        });
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
}

function renderHub(authenticated = true) {
  const auth: AuthContextValue = {
    status: authenticated ? "authenticated" : "anonymous",
    user: authenticated ? { id: "user-1", email: "learner@example.com" } : null,
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => (authenticated ? "token" : null)),
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
          <Route
            path="/tracks/:certificationId/domains/:domainId/learn"
            element={<p>Domain learning page</p>}
          />
          <Route path="/login" element={<p>Sign in page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("heading", {
        name: /AWS Certified CloudOps Engineer/,
      }),
    ).toBeInTheDocument(),
  );
}

beforeEach(() => {
  clearCatalogCache();
  clearTrackMapCache();
  clearTrackProgressCache();
  clearStreakCache();
  posted = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CertificationDashboardPage (Track Hub)", () => {
  it("renders the Knowledge Map, streak, Bits, tabs, and practice controls", async () => {
    stubHub();
    renderHub();
    await ready();

    // Streak HUD from /v1/me.
    expect(
      await screen.findByLabelText(/12 day study streak, active today/),
    ).toBeInTheDocument();
    expect(screen.getByText("day streak")).toBeInTheDocument();

    // Bits balance.
    await waitFor(() =>
      expect(screen.getByLabelText("1,240 Bits")).toBeInTheDocument(),
    );

    // Tabs and practice controls.
    expect(
      screen.getByRole("button", { name: /Knowledge Map/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Daily Mission/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start Quick Quiz/ }),
    ).toBeInTheDocument();

    // The map renders its nodes with descriptive labels.
    expect(
      await screen.findByRole("button", { name: /Metrics/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Logs/ })).toBeInTheDocument();
  });

  it("renders the normal map when the progress endpoint fails", async () => {
    stubHub({ progress: false });
    renderHub();
    await ready();

    const metrics = await screen.findByRole("button", { name: /Metrics/ });
    // Discovery-only label: no evidence/freshness decoration.
    expect(metrics.getAttribute("aria-label")).toContain("not explored yet");
    expect(metrics.getAttribute("aria-label")).not.toContain("evidence");
    expect(
      screen.getByRole("button", { name: /Start Quick Quiz/ }),
    ).toBeInTheDocument();
  });

  it("renders without the streak HUD when the account request fails", async () => {
    stubHub({ streak: false });
    renderHub();
    await ready();

    await screen.findByRole("button", { name: /Metrics/ });
    expect(screen.queryByText("day streak")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1,240 Bits")).toBeInTheDocument();
  });

  it("falls back to the domain list when the map content request fails", async () => {
    stubHub({ map: false });
    renderHub();
    await ready();

    expect(
      await screen.findByRole("link", {
        name: /Explore Domain: Monitoring and Observability/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start Full Practice/ }),
    ).toBeInTheDocument();
  });

  it("marks the recommended node subtly and does not break on recommendation failure", async () => {
    stubHub({ recommendation: true });
    renderHub();
    await ready();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Logs.*recommended next/ }),
      ).toBeInTheDocument(),
    );
  });

  it("starts a quick adaptive quiz", async () => {
    stubHub();
    renderHub();
    await ready();

    await userEvent.click(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      certification_id: "aws-soa-c03",
      mode: "quick_adaptive",
      domain_id: null,
    });
  });

  it("opens the domain selector and starts a domain quiz", async () => {
    stubHub();
    renderHub();
    await ready();

    await userEvent.click(screen.getByRole("button", { name: "Choose Domain" }));
    const picker = await screen.findByRole("region", { name: "Choose a domain" });
    await userEvent.click(
      within(picker).getByRole("button", {
        name: /Monitoring and Observability/,
      }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      mode: "domain_quiz",
      domain_id: "domain-1",
    });
  });

  it("sends anonymous learners to sign in before starting a scored quiz", async () => {
    stubHub();
    renderHub(false);
    await ready();

    await userEvent.click(
      screen.getByRole("button", { name: "Start Quick Quiz" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Sign in page")).toBeInTheDocument(),
    );
    expect(posted).toHaveLength(0);
  });

  it("opens node details and links to the domain learning page", async () => {
    stubHub();
    renderHub();
    await ready();

    await userEvent.click(await screen.findByRole("button", { name: /Metrics/ }));

    const panel = await screen.findByLabelText("Metrics details");
    expect(within(panel).getByText(/A refresh would help/)).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Explore this topic" }),
    ).toBeInTheDocument();
  });

  it("opens the Daily Mission in the same page", async () => {
    stubHub({ dailyMission: true });
    renderHub();
    await ready();

    const cta = await screen.findByRole("button", {
      name: /Continue Daily Mission/,
    });
    await userEvent.click(cta);

    // The runner renders in-page rather than navigating away.
    expect(
      await screen.findByText(/Daily Mission complete/),
    ).toBeInTheDocument();
  });

  it("switches domains on the Knowledge Map", async () => {
    stubHub();
    renderHub();
    await ready();

    // Defaults to the first domain.
    expect(await screen.findByRole("button", { name: /Metrics/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Route Tables/ })).not.toBeInTheDocument();
    // The full authored domain name is shown above the map (not the short pill).
    expect(
      screen.getByRole("heading", { name: "Monitoring and Observability" }),
    ).toBeInTheDocument();

    // Switching domains shows only the other domain's nodes.
    await userEvent.click(screen.getByRole("button", { name: /Networking/ }));
    expect(await screen.findByRole("button", { name: /Route Tables/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Metrics/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Networking" }),
    ).toBeInTheDocument();
  });

  it("persists the unlock-all setting", async () => {
    let saved: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/v1/certifications")) return jsonResponse(catalog);
        if (url.includes("/v1/wallet"))
          return jsonResponse({ device_id: "device", bits_balance: 1240 });
        if (url.includes("/v1/tracks/aws-soa-c03/map"))
          return jsonResponse(trackMap);
        if (url.includes("/v1/tracks/aws-soa-c03/progress"))
          return jsonResponse(progress);
        if (url.includes("/v1/me/settings")) {
          if (input instanceof Request) {
            saved = JSON.parse(await input.clone().text());
          }
          return jsonResponse({ unlock_all_materials: true });
        }
        if (url.includes("/v1/me"))
          return jsonResponse({
            id: "user-1",
            email: "learner@example.com",
            authenticated: true,
            streak,
            settings: { unlock_all_materials: false },
          });
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderHub();
    await ready();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /Unlock all study materials/ }),
    );

    await waitFor(() =>
      expect(saved).toMatchObject({ unlock_all_materials: true }),
    );
  });

  it("applies reduced-motion classes when the user prefers reduced motion", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    stubHub();
    renderHub();
    await ready();

    const metrics = await screen.findByRole("button", { name: /Metrics/ });
    expect(metrics.className).toContain("signal-node--reduced");

    window.matchMedia = original;
  });
});
