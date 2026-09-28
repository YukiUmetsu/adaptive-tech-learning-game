import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberOperationRun } from "../game/state/cyberProfile";

/**
 * Operation lifecycle on the client.
 *
 * The server's `deployed_at` decides whether the configurable briefing is shown
 * or the deployed battle resumes directly. A failed deploy must never start an
 * untracked battle.
 */

vi.mock("../game/state/cyberProfile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../game/state/cyberProfile")>();
  return {
    ...actual,
    refreshCyberProfile: vi.fn(async () => null),
    getOperation: vi.fn(),
    deployOperation: vi.fn(),
    setOperationLoadout: vi.fn(),
    abandonOperation: vi.fn(),
  };
});

vi.mock("../game/components/CyberDefenseGame", () => ({
  default: () => <div data-testid="battle-view">battle</div>,
}));

import {
  deployOperation,
  getOperation,
  resetCyberProfile,
  type CyberApiResult,
} from "../game/state/cyberProfile";
import CyberDefenseOperationPage from "./CyberDefenseOperationPage";

function operationRun(deployedAt: string | null): CyberOperationRun {
  return {
    run_id: "run-1",
    status: "active",
    seed: 1,
    template_id: "web-assault",
    adversary_id: "ghost-7",
    adversary_name: "GHOST-7",
    hero_id: "sre",
    threat_level: 2,
    started_at: "2026-09-27T12:00:00Z",
    deployed_at: deployedAt,
    result: null,
    bits_awarded: 0,
    career_xp_awarded: 0,
    hero_xp_awarded: 0,
    operation: {
      seed: 1,
      template_id: "web-assault",
      adversary_id: "ghost-7",
      adversary_name: "GHOST-7",
      threat_level: 2,
      title: "Injection Wave",
      summary: "Malicious input probes the application.",
      map_id: "dual-service",
      starting_budget: 850,
      starting_health: 100,
      latency_target_ms: 200,
      available_defenses: ["xss_protection"],
      available_heroes: ["sre"],
      waves: [
        {
          boss: false,
          groups: [
            {
              attack_id: "xss",
              count: 3,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1,
              speed_multiplier: 1,
            },
          ],
        },
      ],
      modifiers: [],
      dominant_attack_type: "xss",
      hidden_attacks: false,
      boss: false,
      reward_preview: { bits: 60, career_xp: 100, hero_xp: 50 },
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/game/operations/run-1"]}>
      <Routes>
        <Route
          path="/game/operations/:runId"
          element={<CyberDefenseOperationPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getOperation).mockReset();
  vi.mocked(deployOperation).mockReset();
});

afterEach(() => {
  resetCyberProfile();
});

describe("CyberDefenseOperationPage deploy lifecycle", () => {
  it("shows the briefing before deploy and the battle only after it succeeds", async () => {
    vi.mocked(getOperation).mockResolvedValue({
      ok: true,
      data: operationRun(null),
    });
    vi.mocked(deployOperation).mockResolvedValue({
      ok: true,
      data: operationRun("2026-09-27T12:05:00Z"),
    } as CyberApiResult<CyberOperationRun>);

    renderPage();

    const deploy = await screen.findByRole("button", { name: /^deploy$/i });
    expect(screen.queryByTestId("battle-view")).not.toBeInTheDocument();

    fireEvent.click(deploy);

    await waitFor(() =>
      expect(screen.getByTestId("battle-view")).toBeInTheDocument(),
    );
    expect(deployOperation).toHaveBeenCalledWith("run-1");
  });

  it("does not start the battle when the deploy request fails", async () => {
    vi.mocked(getOperation).mockResolvedValue({
      ok: true,
      data: operationRun(null),
    });
    vi.mocked(deployOperation).mockResolvedValue({
      ok: false,
      code: "network",
      message: "Could not reach the server.",
      activeRunId: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^deploy$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not reach the server/,
    );
    expect(screen.queryByTestId("battle-view")).not.toBeInTheDocument();
  });

  it("resumes a deployed run directly without the briefing", async () => {
    vi.mocked(getOperation).mockResolvedValue({
      ok: true,
      data: operationRun("2026-09-27T12:05:00Z"),
    });

    renderPage();

    expect(await screen.findByTestId("battle-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^deploy$/i }),
    ).not.toBeInTheDocument();
  });
});
