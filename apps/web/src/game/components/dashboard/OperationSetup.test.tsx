import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberProfile } from "../../state/cyberProfile";
import { writeLastHeroId } from "../../persistence/heroSelection";
import OperationSetup from "./OperationSetup";

function profile(overrides: Partial<CyberProfile> = {}): CyberProfile {
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
    heroes: [
      {
        hero_id: "security_engineer",
        xp: 0,
        level: 3,
        max_level: 20,
        next_level_xp: 100,
        xp_into_level: 0,
        xp_for_next_level: 100,
        selected_talents: {},
      },
      {
        hero_id: "sre",
        xp: 0,
        level: 1,
        max_level: 20,
        next_level_xp: 100,
        xp_into_level: 0,
        xp_for_next_level: 100,
        selected_talents: {},
      },
    ],
    highest_threat_level_cleared: 3,
    legacy_progress_imported: true,
    recommended_threat_level: 5,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 1,
    tower_upgrades: [],
    unlocked_threat_level: 6,
    operations_unlocked: true,
    confrontation_available: false,
    available_adversaries: ["ghost-7"],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("OperationSetup", () => {
  it("defaults to the recommended Threat Level", () => {
    const onStart = vi.fn();
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: /continue defense/i }));

    expect(onStart).toHaveBeenCalledWith({
      heroId: "security_engineer",
      threatLevel: 5,
      templateId: undefined,
    });
  });

  it("sends the selected operator id", () => {
    const onStart = vi.fn();
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole("radio", { name: /SRE/ }));
    fireEvent.click(screen.getByRole("button", { name: /continue defense/i }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ heroId: "sre" }),
    );
  });

  it("restores the last selected operator", () => {
    const onStart = vi.fn();
    writeLastHeroId("sre");
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: /continue defense/i }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ heroId: "sre" }),
    );
  });

  it("falls back safely when the stored operator is invalid", () => {
    const onStart = vi.fn();
    writeLastHeroId("not-a-hero");
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: /continue defense/i }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ heroId: "security_engineer" }),
    );
  });

  it("never advertises a locked Threat Level", () => {
    const onStart = vi.fn();
    render(
      <OperationSetup
        profile={profile({ recommended_threat_level: 3, unlocked_threat_level: 4 })}
        starting={false}
        onStart={onStart}
      />,
    );

    // nearby = [2, 3, 4]; all unlocked levels are 1..4.
    expect(screen.queryByRole("radio", { name: "5" })).not.toBeInTheDocument();
    const options = screen.getAllByRole("option");
    for (const option of options) {
      expect(Number(option.getAttribute("value"))).toBeLessThanOrEqual(4);
    }

    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: /continue defense/i }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ threatLevel: 4 }),
    );
  });
});
