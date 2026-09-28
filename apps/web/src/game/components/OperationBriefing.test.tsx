import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GAME_CATALOG } from "../data";
import type { CyberOperationRun } from "../state/cyberProfile";
import OperationBriefing from "./OperationBriefing";

function operationRun(): CyberOperationRun {
  return {
    run_id: "run-1",
    status: "active",
    seed: 1,
    template_id: "web-assault",
    adversary_id: "null",
    adversary_name: "NULL",
    hero_id: "security_engineer",
    threat_level: 4,
    started_at: "2026-09-27T12:00:00Z",
    result: null,
    bits_awarded: 0,
    career_xp_awarded: 0,
    hero_xp_awarded: 0,
    operation: {
      seed: 1,
      template_id: "web-assault",
      adversary_id: "null",
      adversary_name: "NULL",
      threat_level: 4,
      title: "Injection Wave",
      summary: "Malicious input probes the application and database layers.",
      map_id: "web-stack",
      starting_budget: 850,
      starting_health: 100,
      latency_target_ms: 200,
      available_defenses: ["parameterized_queries", "waf"],
      available_heroes: ["security_engineer", "sre"],
      waves: [
        {
          boss: false,
          groups: [
            {
              attack_id: "sql_injection",
              count: 4,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1.2,
              speed_multiplier: 1,
            },
          ],
        },
      ],
      modifiers: [],
      dominant_attack_type: "sql_injection",
      hidden_attacks: false,
      boss: false,
      reward_preview: { bits: 60, career_xp: 100, hero_xp: 50 },
    },
  };
}

function renderBriefing() {
  return render(
    <OperationBriefing
      run={operationRun()}
      catalog={GAME_CATALOG}
      onStart={vi.fn()}
      onAbandon={vi.fn()}
      onExit={vi.fn()}
    />,
  );
}

describe("OperationBriefing threat intel", () => {
  it("opens an anchored info card on the (i) trigger and closes it", () => {
    renderBriefing();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /SQL Injection intel/i }),
    );

    const card = screen.getByRole("tooltip");
    expect(card).toBeInTheDocument();
    expect(screen.getByText(/Parameterized queries/i)).toBeInTheDocument();
    expect(screen.getByText(/How to defend/i)).toBeInTheDocument();

    // Clicking the (i) again closes it.
    fireEvent.click(
      screen.getByRole("button", { name: /SQL Injection intel/i }),
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes the info card on Escape", () => {
    renderBriefing();

    fireEvent.click(
      screen.getByRole("button", { name: /SQL Injection intel/i }),
    );
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens the adversary intel card from its name/emblem", () => {
    renderBriefing();

    fireEvent.click(screen.getByRole("button", { name: /NULL intel/i }));

    const card = screen.getByRole("tooltip");
    expect(
      within(card).getByText(/NULL probes the application layer/i),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Rank 1/i)).toBeInTheDocument();
  });
});
