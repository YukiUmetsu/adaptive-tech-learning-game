import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GAME_CATALOG } from "../data";
import type { CyberOperationRun } from "../state/cyberProfile";
import type { TowerProgress } from "../data/towerEffects";
import OperationBriefing from "./OperationBriefing";

function operationRun(
  overrides: Partial<CyberOperationRun["operation"]> = {},
): CyberOperationRun {
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
      ...overrides,
    },
  };
}

function renderBriefing(
  run: CyberOperationRun = operationRun(),
  towerProgress: TowerProgress = {},
) {
  return render(
    <OperationBriefing
      run={run}
      catalog={GAME_CATALOG}
      towerProgress={towerProgress}
      onStart={vi.fn()}
      onAbandon={vi.fn()}
      onExit={vi.fn()}
    />,
  );
}

describe("OperationBriefing threat intel", () => {
  it("opens an anchored info card on the (i) trigger and closes it", () => {
    renderBriefing(operationRun(), { soc: 2 });

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
    renderBriefing(operationRun(), { soc: 2 });

    fireEvent.click(
      screen.getByRole("button", { name: /SQL Injection intel/i }),
    );
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens the adversary intel card from its name/emblem", () => {
    renderBriefing(operationRun(), { threat_intelligence: 1 });

    fireEvent.click(screen.getByRole("button", { name: /NULL intel/i }));

    const card = screen.getByRole("tooltip");
    expect(
      within(card).getByText(/NULL probes the application layer/i),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Rank 1/i)).toBeInTheDocument();
  });
});

describe("OperationBriefing branching schematic", () => {
  it("shows both API and Application branches of a branching Operation", () => {
    renderBriefing(
      operationRun({
        map_id: "dual-service",
        dominant_attack_type: "xss",
      }),
    );
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
  });

  it("lists and highlights every actual target of a multi-target Operation", () => {
    const run = operationRun({
      map_id: "dual-service",
      dominant_attack_type: "sql_injection",
      waves: [
        {
          boss: false,
          groups: [
            {
              attack_id: "sql_injection",
              count: 2,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1,
              speed_multiplier: 1,
            },
            {
              attack_id: "xss",
              count: 2,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1,
              speed_multiplier: 1,
            },
          ],
        },
      ],
    });
    const { container } = renderBriefing(run);
    expect(container.querySelector(".cyber-op-map-caption")?.textContent).toContain(
      "Targets: Database, Application",
    );
    const targets = [...container.querySelectorAll(".cyber-op-map-node.is-target")];
    const labels = targets.map((node) => node.querySelector("text")?.textContent);
    expect(labels).toContain("Database");
    expect(labels).toContain("Application");
    // API is traversed but never attacked, so it must not be a target.
    expect(labels).not.toContain("API");
  });

  it("keeps a single-target Operation singular", () => {
    const { container } = renderBriefing(operationRun({ map_id: "web-stack" }));
    const caption = container.querySelector(".cyber-op-map-caption")?.textContent;
    expect(caption).toContain("Target: Database");
    expect(caption).not.toContain("Targets:");
  });
});

describe("OperationBriefing Tower intel gating", () => {
  it("hides wave families, modifiers, boss and specialty without upgrades", () => {
    const run = operationRun({
      boss: true,
      hidden_attacks: true,
      modifiers: [
        { id: "mixed_vector", name: "Mixed Vector", description: "A second family." },
        { id: "strict_latency", name: "Strict Latency", description: "Tighter target." },
      ],
    });
    renderBriefing(run, {});

    expect(screen.queryByText(/SQL Injection/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Specialty unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/Mixed Vector/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BOSS INCOMING/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hidden traffic detected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Threat categories unknown/)).toBeInTheDocument();
  });

  it("replaces Unknown modifiers with the real set after Threat Intel improves", () => {
    const run = operationRun({
      modifiers: [
        { id: "mixed_vector", name: "Mixed Vector", description: "A second family." },
        { id: "strict_latency", name: "Strict Latency", description: "Tighter target." },
      ],
    });

    const { unmount } = renderBriefing(run, {});
    expect(
      screen.getByText(/Unknown — upgrade Threat Intelligence/i),
    ).toBeInTheDocument();
    unmount();

    // Threat Intel Lv2 reveals one modifier and admits the rest are unknown.
    renderBriefing(run, { threat_intelligence: 2 });
    expect(screen.getByText(/Mixed Vector/)).toBeInTheDocument();
    expect(screen.queryByText(/Strict Latency/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 additional modifier unknown/i)).toBeInTheDocument();
  });

  it("reveals boss presence only at Threat Intel Lv3", () => {
    const run = operationRun({ boss: true, modifiers: [] });

    const { unmount } = renderBriefing(run, { threat_intelligence: 2 });
    expect(screen.queryByText(/BOSS INCOMING/)).not.toBeInTheDocument();
    unmount();

    renderBriefing(run, { threat_intelligence: 3 });
    expect(screen.getByText(/BOSS INCOMING/)).toBeInTheDocument();
  });

  it("shows wave categories from SOC but counts only at SOC Lv4", () => {
    const run = operationRun();

    const { unmount } = renderBriefing(run, { soc: 2 });
    expect(screen.getByText(/Wave 1/)).toBeInTheDocument();
    expect(screen.getByText(/SQL Injection/)).toBeInTheDocument();
    expect(screen.queryByText(/×4/)).not.toBeInTheDocument();
    unmount();

    renderBriefing(run, { soc: 4 });
    expect(screen.getByText(/×4/)).toBeInTheDocument();
  });
});
