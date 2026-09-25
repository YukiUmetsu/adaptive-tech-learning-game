import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PostmortemReport } from "../engine/postmortem";
import { MISSIONS_BY_ID } from "../data/missions";
import MissionResult from "./MissionResult";

const mission = MISSIONS_BY_ID["ddos-basics"];
const bossMission = MISSIONS_BY_ID["botnet-boss"];

function report(overrides: Partial<PostmortemReport> = {}): PostmortemReport {
  return {
    completed: true,
    stars: 3,
    survived: true,
    health: 82,
    maxHealth: 100,
    latencyMs: 90,
    latencyTargetMs: 150,
    latencyOk: true,
    spent: 650,
    budgetRemaining: 50,
    recommendedSpend: 650,
    budgetOk: true,
    creditsEarned: 120,
    blocked: [],
    leaked: [],
    blockedTotal: 24,
    leakedTotal: 0,
    message: "Layer controls along the road.",
    backupRestored: 0,
    bitsPreview: 60,
    ...overrides,
  };
}

function renderResult(overrides: Partial<PostmortemReport> = {}, boss = false) {
  const { container } = render(
    <MissionResult
      report={report(overrides)}
      mission={boss ? bossMission : mission}
      hasNext={false}
      onRetry={() => {}}
      onContinue={() => {}}
      onNext={() => {}}
    />,
  );
  return container;
}

describe("MissionResult celebration", () => {
  it("fires a victory burst when the mission is cleared", () => {
    const container = renderResult();

    expect(container.querySelector(".cyber-result.is-celebrating")).not.toBeNull();
    expect(container.querySelector(".cyber-celebration")).not.toBeNull();
    expect(
      container.querySelectorAll(".cyber-confetti").length,
    ).toBeGreaterThan(0);
    // Decorative only: the burst is hidden from assistive tech.
    expect(container.querySelector(".cyber-celebration")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("marks a boss clear with the gold variant", () => {
    const container = renderResult({}, true);
    expect(
      container.querySelector(".cyber-celebration.is-boss"),
    ).not.toBeNull();
  });

  it("shows no celebration when the mission failed", () => {
    const container = renderResult({ completed: false, stars: 0 });

    expect(container.querySelector(".cyber-celebration")).toBeNull();
    expect(screen.getByText("SYSTEM COMPROMISED")).toBeInTheDocument();
  });

  it("reports the health Backup restored", () => {
    renderResult({ backupRestored: 25 });
    expect(screen.getByText(/Backup restored/i)).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("omits the Backup line when nothing was restored", () => {
    renderResult({ backupRestored: 0 });
    expect(screen.queryByText(/Backup restored/i)).not.toBeInTheDocument();
  });
});
