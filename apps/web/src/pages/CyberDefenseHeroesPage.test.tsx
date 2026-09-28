import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real profile store so tests can seed progress and observe the same
// reconciliation path the app uses; only the network-bound actions are mocked.
vi.mock("../game/state/cyberProfile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../game/state/cyberProfile")>();
  return {
    ...actual,
    refreshCyberProfile: vi.fn(async () => actual.getCyberProfile()),
    setHeroTalents: vi.fn(),
  };
});

import {
  getCyberProfile,
  refreshCyberProfile,
  resetCyberProfile,
  setCyberProfile,
  setHeroTalents,
  type CyberHeroProgress,
  type CyberProfile,
} from "../game/state/cyberProfile";
import CyberDefenseHeroesPage from "./CyberDefenseHeroesPage";

function baseProfile(heroes: CyberHeroProgress[]): CyberProfile {
  return {
    adversaries: [],
    bits_balance: 0,
    campaign: [],
    career: {
      level: 1,
      next_level_xp: 100,
      rank: "Analyst",
      xp: 0,
      xp_for_next_level: 100,
      xp_into_level: 0,
    },
    heroes,
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 1,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 1,
    tower_upgrades: [],
    unlocked_threat_level: 1,
  };
}

function heroProgress(
  overrides: Partial<CyberHeroProgress> = {},
): CyberHeroProgress {
  return {
    hero_id: "security_engineer",
    level: 1,
    max_level: 20,
    next_level_xp: 100,
    selected_talents: {},
    xp: 0,
    xp_for_next_level: 100,
    xp_into_level: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CyberDefenseHeroesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetCyberProfile();
  vi.clearAllMocks();
  vi.mocked(refreshCyberProfile).mockImplementation(async () =>
    getCyberProfile(),
  );
  vi.mocked(setHeroTalents).mockImplementation(async (heroId, talents) => {
    const current = getCyberProfile();
    if (!current) {
      throw new Error("no profile seeded");
    }
    const existing = current.heroes.find((hero) => hero.hero_id === heroId);
    const updated: CyberHeroProgress = {
      hero_id: heroId,
      level: existing?.level ?? 1,
      max_level: existing?.max_level ?? 20,
      next_level_xp: existing?.next_level_xp ?? 100,
      selected_talents: talents,
      xp: existing?.xp ?? 0,
      xp_for_next_level: existing?.xp_for_next_level ?? 100,
      xp_into_level: existing?.xp_into_level ?? 0,
    };
    setCyberProfile({
      ...current,
      heroes: current.heroes.some((hero) => hero.hero_id === heroId)
        ? current.heroes.map((hero) =>
            hero.hero_id === heroId ? updated : hero,
          )
        : [...current.heroes, updated],
    });
    return { ok: true, data: updated };
  });
});

describe("CyberDefenseHeroesPage", () => {
  it("shows one card per Stage 1 hero", () => {
    setCyberProfile(
      baseProfile([
        heroProgress({ hero_id: "security_engineer" }),
        heroProgress({ hero_id: "sre" }),
      ]),
    );

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Security Engineer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SRE" })).toBeInTheDocument();
  });

  it("keeps a locked milestone unselectable", () => {
    setCyberProfile(baseProfile([heroProgress({ level: 1 })]));

    renderPage();

    expect(
      screen.getByRole("button", { name: /Rapid Response/ }),
    ).toBeDisabled();
    expect(
      screen.getAllByText(/Reach level 5 to unlock/).length,
    ).toBeGreaterThan(0);
  });

  it("selects a talent at an unlocked milestone", async () => {
    const user = userEvent.setup();
    setCyberProfile(
      baseProfile([heroProgress({ level: 5, xp_into_level: 40 })]),
    );

    renderPage();

    const choice = screen.getByRole("button", { name: /Rapid Response/ });
    expect(choice).toBeEnabled();

    await user.click(choice);

    expect(setHeroTalents).toHaveBeenCalledWith("security_engineer", {
      "5": "rapid_response",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Rapid Response/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByText("Level 5: Rapid Response")).toBeInTheDocument();
  });

  it("replaces the previous choice when respeccing", async () => {
    const user = userEvent.setup();
    setCyberProfile(
      baseProfile([
        heroProgress({
          level: 5,
          selected_talents: { "5": "rapid_response" },
        }),
      ]),
    );

    renderPage();

    await user.click(screen.getByRole("button", { name: /Deep Hardening/ }));

    expect(setHeroTalents).toHaveBeenCalledWith("security_engineer", {
      "5": "deep_hardening",
    });
  });

  it("exposes hero XP through an accessible progress bar", () => {
    setCyberProfile(
      baseProfile([
        heroProgress({
          level: 5,
          xp: 320,
          xp_into_level: 120,
          xp_for_next_level: 200,
        }),
      ]),
    );

    renderPage();

    const bar = screen.getByRole("progressbar", {
      name: /Security Engineer experience: 320 XP, level 5 of 20/,
    });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
    expect(bar).toHaveAttribute("aria-valuenow", "120");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("60%");
  });

  it("never renders a negative XP width", () => {
    setCyberProfile(
      baseProfile([
        heroProgress({ level: 3, xp_into_level: -40, xp_for_next_level: 200 }),
      ]),
    );

    renderPage();

    const bar = screen.getByRole("progressbar", {
      name: /Security Engineer experience/,
    });
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("marks a max-level hero and caps its progress bar", () => {
    setCyberProfile(
      baseProfile([
        heroProgress({
          level: 20,
          xp: 5_000,
          xp_into_level: 0,
          xp_for_next_level: null,
        }),
      ]),
    );

    renderPage();

    expect(screen.getByText(/Max level/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", {
      name: /Security Engineer experience: 5000 XP, level 20 of 20/,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "5000");
    expect(bar).toHaveAttribute("aria-valuemax", "5000");
  });

  it("shows the next milestone level", () => {
    setCyberProfile(baseProfile([heroProgress({ level: 7 })]));

    renderPage();

    expect(screen.getByText("Next milestone: level 10")).toBeInTheDocument();
  });
});
