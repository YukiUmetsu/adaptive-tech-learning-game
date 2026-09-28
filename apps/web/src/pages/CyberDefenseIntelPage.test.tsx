import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberProfile } from "../game/state/cyberProfile";
import CyberDefenseIntelPage from "./CyberDefenseIntelPage";

vi.mock("../game/state/cyberProfile", () => ({
  useCyberProfile: vi.fn(),
  useCyberProfileLoading: vi.fn(() => false),
  refreshCyberProfile: vi.fn(() => Promise.resolve(null)),
}));

import {
  refreshCyberProfile,
  useCyberProfile,
  useCyberProfileLoading,
} from "../game/state/cyberProfile";

type AdversaryProgress = CyberProfile["adversaries"][number];

function profileFixture(overrides: Partial<CyberProfile> = {}): CyberProfile {
  return {
    adversaries: [],
    bits_balance: 0,
    campaign: [],
    career: { level: 1, rank: "Analyst", xp: 0, xp_into_level: 0 },
    heroes: [],
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 1,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 0,
    tower_upgrades: [],
    unlocked_threat_level: 1,
    operations_unlocked: false,
    confrontation_available: false,
    available_adversaries: [],
    ...overrides,
  };
}

function adversaryFixture(
  overrides: Partial<AdversaryProgress> & { adversary_id: string },
): AdversaryProgress {
  return {
    dossier_flags: [],
    encounters: 0,
    highest_threat_level_cleared: 0,
    progress: 0,
    rank: 1,
    victories: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CyberDefenseIntelPage />
    </MemoryRouter>,
  );
}

/** The panel for one adversary, found via its heading. */
function adversaryCard(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("section");
  if (!card) {
    throw new Error(`No intel card rendered for ${name}`);
  }
  return card;
}

beforeEach(() => {
  vi.mocked(useCyberProfile).mockReset();
  vi.mocked(useCyberProfile).mockReturnValue(null);
  vi.mocked(useCyberProfileLoading).mockReset();
  vi.mocked(useCyberProfileLoading).mockReturnValue(false);
  vi.mocked(refreshCyberProfile).mockReset();
  vi.mocked(refreshCyberProfile).mockResolvedValue(null);
});

describe("CyberDefenseIntelPage", () => {
  it("refreshes the server profile on mount", () => {
    renderPage();

    expect(refreshCyberProfile).toHaveBeenCalledTimes(1);
  });

  it("lists every adversary with its modifier pool", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "GHOST-7" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NULL" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "VIPER" })).toBeInTheDocument();

    const ghost = adversaryCard("GHOST-7");
    expect(within(ghost).getByText("Hidden Traffic")).toBeInTheDocument();
    expect(within(ghost).getByText("Credential Surge")).toBeInTheDocument();
    expect(within(ghost).getByText("Identity Pressure")).toBeInTheDocument();
  });

  it("does not leak hidden dossier labels before they unlock", () => {
    renderPage();

    // No flags are unlocked, so every entry is a generic placeholder.
    expect(document.body).not.toHaveTextContent("Credential specialist");
    expect(document.body).not.toHaveTextContent("Hidden traffic observed");
    expect(document.body).not.toHaveTextContent("Boss pattern witnessed");

    expect(
      within(adversaryCard("GHOST-7")).getAllByText("Locked intel").length,
    ).toBeGreaterThan(0);

    // Locked entries never leak their detail text either.
    expect(document.body).not.toHaveTextContent(/builds target lists/i);
  });

  it("opens an anchored info card for a known dossier entry", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({
        adversaries: [
          adversaryFixture({
            adversary_id: "ghost-7",
            dossier_flags: ["identity_specialist"],
            rank: 4,
          }),
        ],
      }),
    );

    renderPage();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Credential specialist intel/i }),
    );

    const card = screen.getByRole("tooltip");
    expect(
      within(card).getByText(/builds target lists from breach dumps/i),
    ).toBeInTheDocument();
  });

  it("reveals an unlocked dossier entry after the profile reports its flag", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({
        adversaries: [
          adversaryFixture({
            adversary_id: "ghost-7",
            dossier_flags: ["identity_specialist"],
            rank: 4,
            encounters: 12,
            victories: 9,
            highest_threat_level_cleared: 5,
          }),
        ],
      }),
    );

    renderPage();

    const ghost = adversaryCard("GHOST-7");
    expect(within(ghost).getByText(/Credential specialist/)).toBeInTheDocument();
    // Other entries stay hidden even though the dossier has opened.
    expect(within(ghost).queryByText(/Credential surge observed/)).toBeNull();
  });

  it("renders rank, record, highest Threat, and dossier percent", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({
        adversaries: [
          adversaryFixture({
            adversary_id: "ghost-7",
            dossier_flags: ["identity_specialist", "uses_hidden_traffic"],
            rank: 4,
            encounters: 12,
            victories: 9,
            highest_threat_level_cleared: 5,
          }),
        ],
      }),
    );

    renderPage();

    // 2 of 6 GHOST-7 dossier entries known -> 33%.
    expect(screen.getByText("Dossier 33%")).toBeInTheDocument();

    const ghost = adversaryCard("GHOST-7");
    expect(within(ghost).getByText("Rank 4")).toBeInTheDocument();
    expect(within(ghost).getByText("12")).toBeInTheDocument();
    expect(within(ghost).getByText("9")).toBeInTheDocument();
    expect(within(ghost).getByText("5")).toBeInTheDocument();
    expect(within(ghost).getByText(/Hidden traffic observed/)).toBeInTheDocument();
  });

  it("defaults to rank 1 when an adversary has never been encountered", () => {
    renderPage();

    const viper = adversaryCard("VIPER");
    expect(within(viper).getByText("Rank 1")).toBeInTheDocument();
    expect(within(viper).getByText("Dossier 0%")).toBeInTheDocument();
    expect(within(viper).getByText("None yet")).toBeInTheDocument();

    // Progress is read only from the profile; untouched adversaries stay at
    // their defaults rather than inheriting another adversary's record.
    const ghost = adversaryCard("GHOST-7");
    expect(within(ghost).getByText("Dossier 0%")).toBeInTheDocument();
  });

  it("links back to the dashboard", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: /back to dashboard/i }),
    ).toHaveAttribute("href", "/game");
  });
});
