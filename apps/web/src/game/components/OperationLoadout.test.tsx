import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GAME_CATALOG } from "../data";
import type { CyberOperationRun } from "../state/cyberProfile";
import OperationLoadout from "./OperationLoadout";

function run(): CyberOperationRun {
  return {
    run_id: "run-1",
    status: "active",
    seed: 1,
    template_id: "identity-breach",
    adversary_id: "ghost-7",
    adversary_name: "GHOST-7",
    hero_id: "security_engineer",
    threat_level: 2,
    started_at: "2026-09-27T12:00:00Z",
    result: null,
    bits_awarded: 0,
    career_xp_awarded: 0,
    hero_xp_awarded: 0,
    operation: {
      seed: 1,
      template_id: "identity-breach",
      adversary_id: "ghost-7",
      adversary_name: "GHOST-7",
      threat_level: 2,
      title: "Credential Cascade",
      summary: "Credential attacks are replayed against the sign-in flow.",
      map_id: "identity-stack",
      starting_budget: 750,
      starting_health: 100,
      latency_target_ms: 180,
      available_defenses: ["mfa", "rate_limiter", "traffic_blocker"],
      available_heroes: ["security_engineer", "sre"],
      waves: [
        {
          boss: false,
          groups: [
            {
              attack_id: "credential_stuffing",
              count: 5,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1,
              speed_multiplier: 1,
            },
          ],
        },
      ],
      modifiers: [],
      dominant_attack_type: "credential_stuffing",
      hidden_attacks: false,
      boss: false,
      reward_preview: { bits: 60, career_xp: 100, hero_xp: 50 },
    },
  };
}

describe("OperationLoadout", () => {
  it("sends the intended substitution to the server", () => {
    const onApply = vi.fn();
    render(
      <OperationLoadout
        run={run()}
        catalog={GAME_CATALOG}
        allowance={1}
        busy={false}
        message={null}
        onApply={onApply}
      />,
    );

    const trafficBlocker = GAME_CATALOG.defensesById["traffic_blocker"].name;
    fireEvent.change(screen.getByLabelText(`Replace ${trafficBlocker}`), {
      target: { value: "monitoring" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply loadout/i }));

    expect(onApply).toHaveBeenCalledWith([
      { remove: "traffic_blocker", add: "monitoring" },
    ]);
  });

  it("cannot start with the default loadout untouched", () => {
    render(
      <OperationLoadout
        run={run()}
        catalog={GAME_CATALOG}
        allowance={1}
        busy={false}
        message={null}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /apply loadout/i })).toBeDisabled();
  });
});
