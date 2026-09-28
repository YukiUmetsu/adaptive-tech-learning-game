import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberProfile } from "../game/state/cyberProfile";
import CyberDefenseStoryPage from "./CyberDefenseStoryPage";

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

function profileFixture(story: CyberProfile["story"]): CyberProfile {
  return {
    adversaries: [],
    bits_balance: 0,
    campaign: [],
    career: { level: 1, rank: "Analyst", xp: 0, xp_into_level: 0 },
    heroes: [],
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 1,
    story,
    total_operations_completed: 0,
    tower_level: 0,
    tower_upgrades: [],
    unlocked_threat_level: 1,
    operations_unlocked: false,
    confrontation_available: false,
    available_adversaries: [],
    cosmetics: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CyberDefenseStoryPage />
    </MemoryRouter>,
  );
}

/** The chapter panel that owns the given chapter title. */
function chapterPanel(title: string): HTMLElement {
  const panel = screen.getByRole("heading", { name: title }).closest("section");
  if (!panel) {
    throw new Error(`No chapter panel rendered for ${title}`);
  }
  return panel;
}

beforeEach(() => {
  vi.mocked(useCyberProfile).mockReset();
  vi.mocked(useCyberProfile).mockReturnValue(null);
  vi.mocked(useCyberProfileLoading).mockReset();
  vi.mocked(useCyberProfileLoading).mockReturnValue(false);
  vi.mocked(refreshCyberProfile).mockReset();
  vi.mocked(refreshCyberProfile).mockResolvedValue(null);
});

describe("CyberDefenseStoryPage", () => {
  it("refreshes the server profile on mount", () => {
    renderPage();

    expect(refreshCyberProfile).toHaveBeenCalledTimes(1);
  });

  it("shows the full body of a completed node and hides incomplete bodies", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({
        active_chapter: "chapter-1",
        completed_nodes: ["chapter-1-complete"],
      }),
    );

    renderPage();

    const chapter1 = chapterPanel("Chapter 1 — First Contact");
    expect(within(chapter1).getByText("Chapter 1 Complete")).toBeInTheDocument();
    expect(
      within(chapter1).getByText(
        "The botnet is contained and the storefront is stable.",
      ),
    ).toBeInTheDocument();
    expect(
      within(chapter1).getByText(
        "The pattern behind the attacks is bigger than one flood. Repeatable Operations are now unlocked.",
      ),
    ).toBeInTheDocument();

    // The next chapter is locked, so none of its body text is in the DOM.
    expect(document.body).not.toHaveTextContent(
      "A recurring signature shows up in the identity logs: GHOST-7.",
    );
    expect(document.body).not.toHaveTextContent(
      "It rarely forces a door. It waits for a reused credential instead.",
    );
  });

  it("renders cleanly with no completed nodes", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({ active_chapter: "chapter-1", completed_nodes: [] }),
    );

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Story Archive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Chapter 1 — First Contact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Chapter 5 — Stage 2 Climax" }),
    ).toBeInTheDocument();

    // Nothing is unlocked yet, so no story body text is rendered anywhere.
    expect(document.body).not.toHaveTextContent(
      "The botnet is contained and the storefront is stable.",
    );
  });

  it("highlights the active chapter with a text label", () => {
    vi.mocked(useCyberProfile).mockReturnValue(
      profileFixture({
        active_chapter: "chapter-2",
        completed_nodes: ["chapter-1-complete"],
      }),
    );

    renderPage();

    const chapter2 = chapterPanel("Chapter 2 — Pattern Recognition");
    expect(within(chapter2).getByText("Current chapter")).toBeInTheDocument();
    expect(within(chapter2).getByText("You are here")).toBeInTheDocument();

    const chapter3 = chapterPanel("Chapter 3 — Multiple Vectors");
    expect(
      within(chapter3).queryByText("Current chapter"),
    ).not.toBeInTheDocument();
  });

  it("renders an all-locked archive when no profile has loaded", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Story Archive" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Locked — reach this point in the campaign/).length,
    ).toBeGreaterThan(0);
  });

  it("links back to the dashboard", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: /back to dashboard/i }),
    ).toHaveAttribute("href", "/game");
  });
});
