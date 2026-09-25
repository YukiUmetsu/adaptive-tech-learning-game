import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MISSIONS_BY_ID } from "../data/missions";
import { resetGameProgress } from "../persistence/gameProgress";
import CyberDefenseGame from "./CyberDefenseGame";

beforeEach(() => {
  window.localStorage.clear();
  resetGameProgress();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function dismissTutorial() {
  const skip = screen.queryByRole("button", { name: "Skip" });
  if (skip) {
    fireEvent.click(skip);
  }
}

function renderGame() {
  const mission = MISSIONS_BY_ID["ddos-basics"];
  render(
    <MemoryRouter>
      <CyberDefenseGame
        mission={mission}
        hasNext={false}
        onExit={() => {}}
        onNext={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("CyberDefenseGame", () => {
  it("shows the how-to-play popup on the first run and closes it", () => {
    renderGame();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Defend the core")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a player place defenses and win a mission", async () => {
    renderGame();
    dismissTutorial();

    // Deploy a Traffic Analyzer before a Traffic Blocker.
    fireEvent.click(
      screen.getByRole("button", { name: /Traffic Analyzer, 180 credits/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Tower pad 1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Traffic Blocker, 220 credits/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Tower pad 3" }),
    );

    // Starting a wave must release the open configuration (auto-pause).
    fireEvent.click(screen.getByRole("button", { name: /Start wave 1/ }));

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(screen.getByText("MISSION COMPLETE")).toBeInTheDocument();
    expect(screen.getByText(/Most effective control/i)).toBeInTheDocument();
  });

  it("ignores a legacy saved run instead of blanking the page", () => {
    window.localStorage.setItem(
      "adaptive-learn.cyber-defense-session.v1",
      JSON.stringify({
        version: 1,
        missionId: "ddos-basics",
        savedAt: new Date().toISOString(),
        state: { missionId: "ddos-basics", phase: "prep" },
      }),
    );

    renderGame();
    dismissTutorial();

    expect(
      screen.getByRole("button", { name: /Start wave 1/ }),
    ).toBeInTheDocument();
  });
});
