import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { learningFixture } from "../test/learningFixture";
import { restoreMatchMedia, setReducedMotion } from "../test/matchMedia";
import { loadDomainProgress } from "../state/learningProgress";
import { markSectionQuizComplete } from "../state/sectionQuiz";
import DomainLearningPage from "./DomainLearningPage";

vi.mock("../state/sound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/sound")>();
  return {
    ...actual,
    playReveal: vi.fn(),
    playNodeUnlock: vi.fn(),
    playPathUnlock: vi.fn(),
    playModuleComplete: vi.fn(),
  };
});

vi.mock("../state/focus", () => ({
  recordStudyActivity: vi.fn(),
}));

import {
  playModuleComplete,
  playNodeUnlock,
  playReveal,
} from "../state/sound";
import { recordStudyActivity } from "../state/focus";

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

let requests: RecordedRequest[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  requests = [];
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = (request?.method ?? init?.method ?? "GET").toUpperCase();
      let body: unknown = null;
      if (request) {
        try {
          body = JSON.parse(await request.clone().text());
        } catch {
          body = null;
        }
      }
      requests.push({ url, method, body });

      if (url.includes("/learning")) {
        return jsonResponse(learningFixture);
      }
      if (url.includes("/v1/missions/issue")) {
        return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreMatchMedia();
});

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={["/tracks/test-cert/domains/domain-1/learn"]}
    >
      <Routes>
        <Route
          path="/tracks/:certificationId/domains/:domainId/learn"
          element={<DomainLearningPage />}
        />
        <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function ready() {
  await screen.findByText("0 / 3 Nodes Unlocked");
}

async function openNode(name: string, state: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `${name}, ${state}` }));
}

async function revealPrompt(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Reveal ${label}` }));
}

/** Fully unlocks Alpha and returns to the map. */
async function unlockAlpha() {
  await openNode("Alpha", "Ready to discover");
  await revealPrompt("WHAT?");
  await revealPrompt("LOOK FOR");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Continue to Knowledge Map" }));
}

/** Completes the first group so the next group becomes available. */
async function unlockFirstModule() {
  await unlockAlpha();
  await openNode("Beta", "Ready to discover");
  await revealPrompt("CONNECTS TO?");
}

async function selectGroup(title: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: new RegExp(title) }));
}

async function closeCard() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Continue to Knowledge Map" }),
  );
}

describe("DomainLearningPage", () => {
  it("renders authored prompt content on a knowledge card", async () => {
    renderPage();
    await ready();

    expect(
      screen.getByRole("button", { name: "Alpha, Ready to discover" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Beta, Locked" }),
    ).toBeInTheDocument();

    await openNode("Alpha", "Ready to discover");
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Alpha is __________")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reveal WHAT?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Look for __________")).toBeInTheDocument();
  });

  it("does not open a locked node", async () => {
    renderPage();
    await ready();

    await openNode("Beta", "Locked");

    expect(screen.queryByText("Alpha → __________")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Beta" })).not.toBeInTheDocument();
    expect(playReveal).not.toHaveBeenCalled();
  });

  it("reveals prompts, updates node charge, and unlocks the node once", async () => {
    renderPage();
    await ready();

    await openNode("Alpha", "Ready to discover");
    expect(
      screen.getByLabelText("0 of 2 prompts revealed"),
    ).toBeInTheDocument();

    await revealPrompt("WHAT?");
    expect(screen.getByText("Alpha records activity.")).toBeInTheDocument();
    expect(
      screen.getByLabelText("1 of 2 prompts revealed"),
    ).toBeInTheDocument();
    expect(playReveal).toHaveBeenCalledTimes(1);

    await revealPrompt("LOOK FOR");
    expect(screen.getByText("who changed it")).toBeInTheDocument();
    expect(
      screen.getByLabelText("2 of 2 prompts revealed"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/UNLOCKED!/).length).toBeGreaterThan(0);
    expect(playNodeUnlock).toHaveBeenCalledTimes(1);
  });

  it("records meaningful study activity for node and reveal interactions", async () => {
    renderPage();
    await ready();

    await openNode("Alpha", "Ready to discover");
    expect(recordStudyActivity).toHaveBeenCalledWith("knowledge_node");

    await revealPrompt("WHAT?");
    expect(recordStudyActivity).toHaveBeenCalledWith("reveal");
  });

  it("celebrates an unlock inside the card, with no transient banner", async () => {
    const { container } = renderPage();
    await ready();

    await openNode("Alpha", "Ready to discover");
    await revealPrompt("WHAT?");
    await revealPrompt("LOOK FOR");

    // The persistent card state is the celebration; nothing appears and
    // disappears elsewhere on the page.
    expect(container.querySelector(".node-unlock-celebration")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continue to Knowledge Map" }),
    ).toBeInTheDocument();
    expect(playNodeUnlock).toHaveBeenCalledTimes(1);
  });

  it("opens the dependent node after a prerequisite unlocks", async () => {
    renderPage();
    await ready();

    await unlockAlpha();

    expect(
      screen.getByRole("button", { name: "Beta, Ready to discover" }),
    ).toBeInTheDocument();
    // The second group still depends on the first being complete, and only the
    // active group is rendered.
    expect(
      screen.getByRole("button", { name: /Advanced/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("list", { name: "Advanced" }),
    ).not.toBeInTheDocument();
  });

  it("shows one knowledge group at a time with grouped progress", async () => {
    const { container } = renderPage();
    await ready();

    expect(
      screen.getByRole("list", { name: "Foundations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Advanced" }),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll(".knowledge-group-card")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /Advanced/ }),
    ).toHaveAttribute("aria-disabled", "true");

    await unlockFirstModule();

    expect(
      screen.getByRole("button", { name: /Advanced/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await selectGroup("Advanced");
    expect(
      screen.getByRole("list", { name: "Advanced" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Gamma, Ready to discover" }),
    ).toBeInTheDocument();
  });

  it("fires the unlock celebration only once per completed node", async () => {
    renderPage();
    await ready();

    await unlockAlpha();
    expect(playNodeUnlock).toHaveBeenCalledTimes(1);

    // Revisiting an already unlocked node must not replay the celebration.
    await openNode("Alpha", "Unlocked");
    expect(playNodeUnlock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Continue to Knowledge Map" }),
    ).toBeInTheDocument();
  });

  it("persists reveals across a reload", async () => {
    const first = renderPage();
    await ready();
    await unlockAlpha();
    first.unmount();
    expect(loadDomainProgress("v1", "domain-1")?.revealedPromptIds.n1).toEqual([
      "what",
      "look",
    ]);
    vi.clearAllMocks();

    renderPage();
    // Wait for persisted progress to be applied before interacting.
    await screen.findByText("1 / 3 Nodes Unlocked");

    await openNode("Alpha", "Unlocked");
    expect(
      screen.getByLabelText("2 of 2 prompts revealed"),
    ).toBeInTheDocument();
    await closeCard();
    expect(
      screen.getByRole("button", { name: "Beta, Ready to discover" }),
    ).toBeInTheDocument();
    // No unlock animation on reload; the node was already discovered.
    expect(playNodeUnlock).not.toHaveBeenCalled();
  });

  it("celebrates module completion and unlocks the next path", async () => {
    const { container } = renderPage();
    await ready();

    await unlockFirstModule();

    await waitFor(() =>
      expect(
        container.querySelector(".module-complete-celebration"),
      ).not.toBeNull(),
    );
    expect(playModuleComplete).toHaveBeenCalledTimes(1);

    const celebration = container.querySelector(
      ".module-complete-celebration",
    ) as HTMLElement;
    expect(within(celebration).getByText(/MODULE COMPLETE/)).toBeInTheDocument();
    expect(within(celebration).getByText(/Path Unlocked:/)).toBeInTheDocument();
    expect(within(celebration).getByText("Advanced")).toBeInTheDocument();

    // The celebration sits below the knowledge card, so completing a module
    // never pushes the open card down.
    const card = container.querySelector(
      ".knowledge-card-panel",
    ) as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(
      card!.compareDocumentPosition(celebration) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await selectGroup("Advanced");
    expect(
      screen.getByRole("button", { name: "Gamma, Ready to discover" }),
    ).toBeInTheDocument();
  });

  it("finishes a section with a section-scoped quiz", async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();

    await unlockFirstModule();
    await screen.findByText(/MODULE COMPLETE/);

    await user.click(
      screen.getByRole("button", { name: /Take Section Quiz/ }),
    );
    await screen.findByText("Mission runner");

    const issue = requests.find((request) =>
      request.url.includes("/v1/missions/issue"),
    );
    expect(issue?.method).toBe("POST");
    expect(issue?.body).toMatchObject({
      certification_id: "test-cert",
      certification_version: "v1",
      mode: "section_quiz",
      domain_id: "domain-1",
      module_id: "m1",
    });
  });

  it("keeps a durable section-quiz entry point after the celebration closes", async () => {
    const user = userEvent.setup();
    markSectionQuizComplete("v1", "domain-1", "m1");
    renderPage();
    await ready();

    await unlockFirstModule();
    await screen.findByText(/MODULE COMPLETE/);
    await user.click(screen.getByRole("button", { name: "Continue Exploring" }));
    await selectGroup("Foundations");

    expect(await screen.findByText("Section quiz complete")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Retake Section Quiz/ }),
    ).toBeInTheDocument();
  });

  it("offers the Domain Quiz when the whole map is complete", async () => {    const user = userEvent.setup();
    renderPage();
    await ready();

    await unlockFirstModule();
    await selectGroup("Advanced");
    await openNode("Gamma", "Ready to discover");
    await revealPrompt("MENTAL MODEL");

    await screen.findByText("Knowledge Map Complete");
    const quizButtons = screen.getAllByRole("button", {
      name: /Start Domain Quiz/,
    });
    await user.click(quizButtons[0]);

    await screen.findByText("Mission runner");
    const issue = requests.find((request) =>
      request.url.includes("/v1/missions/issue"),
    );
    expect(issue?.method).toBe("POST");
    expect(issue?.body).toMatchObject({
      certification_id: "test-cert",
      certification_version: "v1",
      mode: "domain_quiz",
      domain_id: "domain-1",
    });
  });

  it("never creates scored learning events during exploration", async () => {
    renderPage();
    await ready();

    await openNode("Alpha", "Ready to discover");
    await revealPrompt("WHAT?");
    await revealPrompt("LOOK FOR");

    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.some((request) => request.url.includes("/v1/sync")),
    ).toBe(false);
    expect(
      requests.some((request) => request.url.includes("/v1/missions/issue")),
    ).toBe(false);
  });

  it("announces the unlock in the card without a transient banner", async () => {
    setReducedMotion(true);
    const { container } = renderPage();
    await ready();

    await openNode("Alpha", "Ready to discover");
    await revealPrompt("WHAT?");
    await revealPrompt("LOOK FOR");

    expect(screen.getAllByText(/UNLOCKED!/).length).toBeGreaterThan(0);
    expect(container.querySelector(".node-unlock-celebration")).toBeNull();
  });

  it("uses semantic controls rather than canvas coordinates", async () => {
    const { container } = renderPage();
    await ready();

    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByRole("list", { name: "Foundations" })).toBeInTheDocument();
    expect(
      container.querySelectorAll(".knowledge-node").length,
    ).toBeGreaterThan(0);
  });

  it("deep-links to a knowledge node from the query string", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/tracks/test-cert/domains/domain-1/learn?node=n1",
        ]}
      >
        <Routes>
          <Route
            path="/tracks/:certificationId/domains/:domainId/learn"
            element={<DomainLearningPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await ready();

    expect(
      await screen.findByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
  });
});
