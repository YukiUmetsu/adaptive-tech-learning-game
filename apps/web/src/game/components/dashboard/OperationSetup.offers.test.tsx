import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CyberProfile } from "../../state/cyberProfile";

/**
 * Operation offer selection.
 *
 * The dashboard must present the server-issued offers, keep one selected by
 * default, and start exactly the offered template. The confrontation keeps a
 * selectable Threat Level so the climax is not forced to one difficulty.
 */
const offers = [
  {
    offer_id: "11111111-1111-1111-1111-111111111111",
    template_id: "identity-breach",
    title: "Credential Cascade",
    adversary_id: "ghost-7",
    adversary_name: "GHOST-7",
    estimated_minutes: 7,
    map_id: "identity-fork",
    summary: "Credential attacks replay the sign-in flow.",
    threat_summary: ["credential_stuffing"],
    reward_preview: { bits: 90, career_xp: 120, hero_xp: 70 },
  },
  {
    offer_id: "22222222-2222-2222-2222-222222222222",
    template_id: "web-assault",
    title: "Injection Wave",
    adversary_id: "null",
    adversary_name: "NULL",
    estimated_minutes: 9,
    map_id: "dual-service",
    summary: "Malicious input probes the application.",
    threat_summary: ["sql_injection", "xss"],
    reward_preview: { bits: 110, career_xp: 140, hero_xp: 80 },
  },
];

vi.mock("../../state/cyberProfile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../state/cyberProfile")>();
  return {
    ...actual,
    getOperationOffers: vi.fn(async () => ({
      ok: true as const,
      data: {
        offers,
        confrontation_available: true,
        preview_threat_level: 2,
      },
    })),
  };
});

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
        level: 1,
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
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 2,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 1,
    tower_upgrades: [],
    unlocked_threat_level: 4,
    operations_unlocked: true,
    confrontation_available: true,
    available_adversaries: ["ghost-7"],
    cosmetics: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("OperationSetup offers", () => {
  it("renders the server offers and starts the selected one", async () => {
    const onStart = vi.fn();
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    await waitFor(() =>
      expect(screen.getByText("Credential Cascade")).toBeInTheDocument(),
    );
    expect(screen.getByText("Injection Wave")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Injection Wave/i }));
    fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: "22222222-2222-2222-2222-222222222222",
        threatLevel: 2,
      }),
    );
  });

  it("defaults to the first offer", async () => {
    const onStart = vi.fn();
    render(<OperationSetup profile={profile()} starting={false} onStart={onStart} />);

    await waitFor(() =>
      expect(screen.getByText("Credential Cascade")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: "11111111-1111-1111-1111-111111111111",
      }),
    );
  });

  it("keeps a chooseable Threat Level for the confrontation", async () => {
    const onStart = vi.fn();
    render(
      <OperationSetup
        profile={profile()}
        mode="confrontation"
        starting={false}
        onStart={onStart}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Credential Cascade")).toBeInTheDocument(),
    );
    // Threat Level chips are offered for the confrontation too.
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: /begin confrontation/i }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "ghost7-confrontation",
        threatLevel: 3,
      }),
    );
  });
});
