import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionResponse, QuestionView } from "../api/types";
import type { SyncState } from "../hooks/useMissionRunner";
import { clearCatalogCache } from "../hooks/useCatalog";
import { resetMissionCelebrations } from "../state/celebration";
import type { AttemptRecord } from "../state/persistence";
import { playMissionComplete } from "../state/sound";
import { reconcileBits } from "../state/wallet";
import { setReducedMotion, restoreMatchMedia } from "../test/matchMedia";
import QuizCompletionSummary from "./QuizCompletionSummary";

vi.mock("../state/sound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/sound")>();
  return { ...actual, playMissionComplete: vi.fn() };
});

const catalog = {
  certifications: [
    {
      id: "aws-soa-c03",
      vendor: "AWS",
      name: "AWS Certified CloudOps Engineer - Associate",
      exam_code: "SOA-C03",
      official_source_url: "https://example.com/blueprint",
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
              weight: 0.5,
              tasks: [
                {
                  id: "1.1",
                  name: "Metrics and alarms",
                  question_count: 1,
                },
              ],
            },
            {
              id: "domain-2",
              name: "Deployment and Automation",
              weight: 0.5,
              tasks: [
                {
                  id: "2.1",
                  name: "CloudFormation change management",
                  question_count: 2,
                },
              ],
            },
          ],
          concepts: [
            { id: "aws.cloudformation", name: "AWS CloudFormation" },
            {
              id: "aws.cloudformation.changesets",
              name: "CloudFormation change sets",
            },
            {
              id: "aws.cloudformation.drift",
              name: "CloudFormation drift detection",
            },
            {
              id: "aws.iam",
              name: "AWS Identity and Access Management",
            },
            { id: "aws.iam.policy_simulator", name: "IAM policy simulator" },
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

function question(
  id: string,
  domainId: string,
  taskId: string,
  conceptIds: string[],
): QuestionView {
  return {
    id,
    domain_id: domainId,
    task_id: taskId,
    prompt: `Prompt ${id}`,
    interaction_type: "classification",
    assessment_mode: "recognition",
    difficulty_prior: 0.5,
    concepts: conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      weight: 1,
    })),
    hints: [],
    interaction: { type: "classification", items: [], categories: [] },
  };
}

function makeMission(
  mode: MissionResponse["mode"],
  domainId: string | null,
  id: string,
): MissionResponse {
  return {
    id,
    device_id: "device",
    certification_id: "aws-soa-c03",
    certification_version: "soa-c03",
    content_version: "soa-c03-content-v1",
    mode,
    domain_id: domainId,
    task_id: null,
    issued_at: "2026-09-19T10:00:00Z",
    expires_at: "2026-09-19T11:00:00Z",
    questions: [
      question("q1", "domain-1", "1.1", [
        "aws.cloudformation",
        "aws.cloudformation.changesets",
      ]),
      question("q2", "domain-2", "2.1", [
        "aws.cloudformation.drift",
        "aws.iam.policy_simulator",
      ]),
      question("q3", "domain-2", "2.1", ["aws.iam"]),
    ],
  };
}

const attempts: AttemptRecord[] = [
  {
    eventId: "q1-1",
    questionId: "q1",
    attemptNumber: 1,
    correct: true,
    score: 1,
    errorCodes: [],
    hintCount: 0,
    responseMs: 1000,
    occurredAt: "2026-09-19T10:00:00Z",
    bits: 12,
  },
  {
    eventId: "q2-1",
    questionId: "q2",
    attemptNumber: 1,
    correct: false,
    score: 0,
    errorCodes: [],
    hintCount: 0,
    responseMs: 2000,
    occurredAt: "2026-09-19T10:01:00Z",
    bits: 0,
  },
  {
    eventId: "q2-2",
    questionId: "q2",
    attemptNumber: 2,
    correct: true,
    score: 1,
    errorCodes: [],
    hintCount: 0,
    responseMs: 2000,
    occurredAt: "2026-09-19T10:02:00Z",
    bits: 6,
  },
  {
    eventId: "q3-1",
    questionId: "q3",
    attemptNumber: 1,
    correct: false,
    score: 0,
    errorCodes: [],
    hintCount: 0,
    responseMs: 2000,
    occurredAt: "2026-09-19T10:03:00Z",
    bits: 0,
  },
  {
    eventId: "q3-2",
    questionId: "q3",
    attemptNumber: 2,
    correct: true,
    score: 1,
    errorCodes: [],
    hintCount: 0,
    responseMs: 3000,
    occurredAt: "2026-09-19T10:04:00Z",
    bits: 6,
  },
];

const SYNCED: SyncState = { status: "synced", pending: 0 };

let posted: unknown[] = [];
let onRetrySync = vi.fn<() => void>();

function renderSummary(options: {
  mode: MissionResponse["mode"];
  syncState?: SyncState;
  domainId?: string;
  missionId?: string;
}) {
  const missionId = options.missionId ?? "mission-1";
  const mission = makeMission(
    options.mode,
    options.domainId ?? null,
    missionId,
  );

  return render(
    <MemoryRouter initialEntries={[`/missions/${missionId}`]}>
      <Routes>
        <Route
          path="/missions/:missionId"
          element={
            <QuizCompletionSummary
              mission={mission}
              attempts={attempts}
              syncState={options.syncState ?? SYNCED}
              onRetrySync={onRetrySync}
            />
          }
        />
        <Route
          path="/certifications/:certificationId"
          element={<p>Study Dashboard</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearCatalogCache();
  resetMissionCelebrations();
  window.localStorage.clear();
  reconcileBits(1240);
  posted = [];
  onRetrySync = vi.fn();
  setReducedMotion(true);
  vi.mocked(playMissionComplete).mockClear();

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
        return jsonResponse({ id: "22222222-2222-4222-8222-222222222222" });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
});

afterEach(() => {
  restoreMatchMedia();
  vi.unstubAllGlobals();
});

describe("QuizCompletionSummary", () => {
  it.each([
    ["quick_adaptive", "Quick Quiz Complete"],
    ["domain_quiz", "Domain Quiz Complete"],
    ["full_practice", "Full Practice Complete"],
  ] as const)(
    "%s uses the shared completion framework with its own title",
    async (mode, title) => {
      const { container } = renderSummary({
        mode,
        domainId: mode === "domain_quiz" ? "domain-1" : undefined,
      });

      expect(
        await screen.findByRole("heading", { name: title }),
      ).toBeInTheDocument();
      expect(container.querySelector("section.completion")).not.toBeNull();
      expect(screen.getByTestId("completion-message")).toBeInTheDocument();
    },
  );

  it("makes Bits earned the main reward and uses friendly knowledge names", async () => {
    renderSummary({ mode: "quick_adaptive" });

    const earned = await screen.findByTestId("bits-earned");
    expect(earned).toHaveTextContent("+24");
    expect(screen.getByTestId("bits-total")).toHaveTextContent("1,240 total");

    expect(await screen.findByText("CloudFormation")).toBeInTheDocument();
    expect(
      screen.getByText("Change sets · Drift detection"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Identity and Access Management"),
    ).toBeInTheDocument();

    // Raw concept ids must never reach the learner.
    expect(
      screen.queryByText("aws.cloudformation.changesets"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/aws\./)).not.toBeInTheDocument();
  });

  it("frames recoveries positively", async () => {
    renderSummary({ mode: "quick_adaptive" });
    expect(await screen.findByText("Strong recovery!")).toBeInTheDocument();
    expect(
      screen.getByText(/Recovering questions is how knowledge sticks/),
    ).toBeInTheDocument();
  });

  it("shows the correct Quick Quiz actions and starts another quiz", async () => {
    renderSummary({ mode: "quick_adaptive" });

    const again = await screen.findByRole("button", {
      name: /Play Another Quick Quiz/,
    });
    expect(
      screen.getByRole("link", { name: /Return to Study Dashboard/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nice momentum.")).toBeInTheDocument();

    await userEvent.click(again);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      certification_id: "aws-soa-c03",
      mode: "quick_adaptive",
      domain_id: null,
    });
  });

  it("shows the domain name and coverage for a Domain Quiz", async () => {
    renderSummary({ mode: "domain_quiz", domainId: "domain-1" });

    expect(
      await screen.findByRole("heading", { name: "Domain Quiz Complete" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Monitoring and Observability"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Domain coverage" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Metrics and alarms")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Practice This Domain Again/ }),
    ).toBeInTheDocument();
  });

  it("shows a domain breakdown and both actions for Full Practice", async () => {
    renderSummary({ mode: "full_practice" });

    expect(
      await screen.findByRole("heading", { name: "Domain breakdown" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Deployment and Automation"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to Study Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start Another Full Practice/ }),
    ).toBeInTheDocument();
  });

  it("keeps a successful sync visually quiet", async () => {
    renderSummary({ mode: "quick_adaptive", syncState: SYNCED });

    expect(await screen.findByText(/Progress saved/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry Sync/ }),
    ).not.toBeInTheDocument();
  });

  it("promotes a failed sync with a retry action", async () => {
    renderSummary({
      mode: "quick_adaptive",
      syncState: {
        status: "error",
        pending: 2,
        message: "Sync failed with HTTP 500",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sync failed with HTTP 500",
    );
    const retry = screen.getByRole("button", { name: "Retry Sync" });
    await userEvent.click(retry);
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });

  it("fires the completion sound and animation only once per mission", async () => {
    const view = renderSummary({ mode: "quick_adaptive" });

    expect(playMissionComplete).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter initialEntries={["/missions/mission-1"]}>
        <QuizCompletionSummary
          mission={makeMission("quick_adaptive", null, "mission-1")}
          attempts={attempts}
          syncState={SYNCED}
          onRetrySync={onRetrySync}
        />
      </MemoryRouter>,
    );
    expect(playMissionComplete).toHaveBeenCalledTimes(1);

    view.unmount();
    renderSummary({ mode: "quick_adaptive", missionId: "mission-1" });
    expect(playMissionComplete).toHaveBeenCalledTimes(1);
  });

  it("celebrates a new mission when the summary component is reused", () => {
    const view = renderSummary({
      mode: "quick_adaptive",
      missionId: "mission-1",
    });
    expect(playMissionComplete).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter initialEntries={["/missions/mission-2"]}>
        <QuizCompletionSummary
          mission={makeMission("quick_adaptive", null, "mission-2")}
          attempts={attempts}
          syncState={SYNCED}
          onRetrySync={onRetrySync}
        />
      </MemoryRouter>,
    );

    expect(playMissionComplete).toHaveBeenCalledTimes(2);
  });

  it("remains functional under reduced motion", async () => {
    setReducedMotion(true);
    renderSummary({ mode: "quick_adaptive" });

    // Final amount and knowledge cards render without any animation.
    expect(await screen.findByTestId("bits-earned")).toHaveTextContent("+24");
    expect(await screen.findByText("CloudFormation")).toBeInTheDocument();
    expect(playMissionComplete).toHaveBeenCalledTimes(1);
  });

  it("renders the animated Bits element when motion is allowed", async () => {
    setReducedMotion(false);
    renderSummary({ mode: "quick_adaptive" });

    const earned = await screen.findByTestId("bits-earned");
    expect(earned).toBeInTheDocument();

    // The animation must settle on the earned total.
    await waitFor(() => expect(earned).toHaveTextContent("+24"), {
      timeout: 2500,
    });
  });

  it("catches a failed restart and surfaces it", async () => {
    renderSummary({ mode: "quick_adaptive" });
    const again = await screen.findByRole("button", {
      name: /Play Another Quick Quiz/,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "boom" } }, 500)),
    );
    await userEvent.click(again);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Could not start/),
    );
  });

  it("does not restart automatically", async () => {
    renderSummary({ mode: "full_practice" });
    await screen.findByRole("heading", { name: "Domain breakdown" });

    // Reaching the summary must not have issued a new mission.
    expect(posted).toHaveLength(0);
  });

  it("reports pending events with a quiet retry", async () => {
    renderSummary({
      mode: "quick_adaptive",
      syncState: { status: "pending", pending: 2 },
    });

    expect(await screen.findByTestId("summary-pending")).toHaveTextContent(
      "2 learning events waiting to sync",
    );
    const retry = screen.getByRole("button", { name: "Retry Sync" });
    await act(async () => {
      await userEvent.click(retry);
    });
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });
});
