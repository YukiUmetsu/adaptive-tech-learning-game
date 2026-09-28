import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberProfile } from "../game/state/cyberProfile";
import { AuthContext, type AuthContextValue } from "../auth/context";
import {
  recordMissionResult,
  resetGameProgress,
} from "../game/persistence/gameProgress";

let profileFixture: CyberProfile | null = null;

vi.mock("../game/state/cyberProfile", () => ({
  useCyberProfile: () => profileFixture,
  useCyberProfileLoading: () => false,
  useCyberProfileError: () => null,
  refreshCyberProfile: async () => profileFixture,
  maybeImportLegacyProgress: async () => {},
  startOperation: async () => ({
    ok: false as const,
    code: "unavailable",
    message: "offline",
    activeRunId: null,
  }),
  completeOperation: async () => ({
    ok: false as const,
    code: "network",
    message: "offline",
    activeRunId: null,
  }),
  completeCampaign: async () => ({
    ok: false as const,
    code: "network",
    message: "offline",
    activeRunId: null,
  }),
}));

vi.mock("../game/state/cyberTelemetry", () => ({
  trackCyberEvent: () => {},
  durationBucket: () => "5_10m",
  flushCyberTelemetry: async () => {},
  resetCyberTelemetry: () => {},
  telemetryBufferLength: () => 0,
}));

import CyberDefensePage from "./CyberDefensePage";

function baseProfile(overrides: Partial<CyberProfile> = {}): CyberProfile {
  return {
    career: {
      xp: 340,
      level: 4,
      rank: "Junior Security Analyst",
      next_level_xp: 390,
      xp_into_level: 110,
      xp_for_next_level: 160,
    },
    bits_balance: 1840,
    tower_level: 3,
    tower_upgrades: [],
    heroes: [],
    adversaries: [
      {
        adversary_id: "ghost-7",
        progress: 130,
        rank: 4,
        encounters: 3,
        victories: 2,
        highest_threat_level_cleared: 4,
        dossier_flags: [],
      },
    ],
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    campaign: [],
    highest_threat_level_cleared: 4,
    recommended_threat_level: 5,
    unlocked_threat_level: 7,
    total_operations_completed: 3,
    active_operation_run_id: null,
    legacy_progress_imported: true,
    operations_unlocked: false,
    confrontation_available: false,
    available_adversaries: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetGameProgress();
  profileFixture = baseProfile();
});

function authValue(status: "anonymous" | "authenticated"): AuthContextValue {
  return {
    status,
    user:
      status === "authenticated"
        ? { id: "user-1", email: "learner@example.com", name: "Ada" }
        : null,
    configured: status === "authenticated",
    devSignIn: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    getAccessToken: async () => null,
  };
}

function renderPage(status: "anonymous" | "authenticated" = "authenticated") {
  return render(
    <AuthContext.Provider value={authValue(status)}>
      <MemoryRouter>
        <CyberDefensePage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("CyberDefensePage", () => {
  it("shows career, Tower, Bits, and threat on the hub", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: /Junior Security Analyst/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Level 4/)).toBeInTheDocument();
    expect(screen.getAllByText("Lv 3").length).toBeGreaterThan(0);
    expect(screen.getByText("1,840")).toBeInTheDocument();
    expect(screen.getByText("GHOST-7")).toBeInTheDocument();
    expect(screen.getByText("Rank 4")).toBeInTheDocument();
  });

  it("points the primary action at the campaign while it is incomplete", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: /continue campaign/i }),
    ).toHaveAttribute("href", "/game/missions/ddos-basics");
  });

  it("resumes an active Operation", () => {
    profileFixture = baseProfile({
      active_operation_run_id: "11111111-1111-1111-1111-111111111111",
    });
    renderPage();

    expect(
      screen.getByRole("link", { name: /resume operation/i }),
    ).toHaveAttribute(
      "href",
      "/game/operations/11111111-1111-1111-1111-111111111111",
    );
  });

  it("offers Continue Defense once the campaign is complete", () => {
    profileFixture = baseProfile({
      operations_unlocked: true,
      campaign: [
        "ddos-basics",
        "sql-injection",
        "credential-stuffing",
        "mixed-defense",
        "botnet-boss",
      ].map((mission_id) => ({
        mission_id,
        completed: true,
        best_stars: 3,
        best_health: 90,
        attempts: 1,
        first_clear_reward_settled: true,
      })),
    });
    renderPage();

    expect(
      screen.getByRole("button", { name: /continue defense/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Recommended Operation/i)).toBeInTheDocument();
  });

  it("exposes the upgrade modules and the campaign list", () => {
    renderPage();

    expect(screen.getByRole("link", { name: /^Tower,/ })).toHaveAttribute(
      "href",
      "/game/tower",
    );
    expect(screen.getByRole("link", { name: /^Heroes,/ })).toHaveAttribute(
      "href",
      "/game/heroes",
    );
    expect(
      screen.getByRole("link", { name: /^Threat Intel,/ }),
    ).toHaveAttribute("href", "/game/intel");
    expect(screen.getByRole("link", { name: /^Story,/ })).toHaveAttribute(
      "href",
      "/game/story",
    );
    expect(
      screen.getAllByText("Protect the Storefront").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("0 of 5 cleared")).toBeInTheDocument();
  });

  it("lets a signed-out visitor browse but sends them to sign in to play", () => {
    renderPage("anonymous");

    expect(screen.getByText("Protect the Storefront")).toBeInTheDocument();
    expect(screen.getByText("Systems secured")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /sign in to play/i });
    expect(cta).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fgame%2Fmissions%2Fddos-basics",
    );
  });

  it("advances the signed-out call to action once a mission is cleared", () => {
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 3,
      health: 90,
    });

    renderPage("anonymous");

    expect(
      screen.getByRole("link", { name: /sign in to play/i }),
    ).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fgame%2Fmissions%2Fsql-injection",
    );
  });
});
