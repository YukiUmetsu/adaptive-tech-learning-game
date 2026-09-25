import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { GAME_CATALOG } from "../data";
import { MISSIONS_BY_ID } from "../data/missions";
import type { EnemyState } from "../engine/simulation";
import GameBoard, { ENEMY_RENDER_CAP } from "./GameBoard";

const mission = MISSIONS_BY_ID["ddos-basics"];

function enemy(index: number): EnemyState {
  return {
    id: `enemy-${index}`,
    attackId: "ddos_swarm",
    attackType: "ddos",
    health: 14,
    maxHealth: 14,
    systemDamage: 6,
    speed: 0.5,
    path: ["internet", "edge", "api"],
    pathIndex: 1,
    progress: 0.5,
    revealed: true,
    blocked: false,
    leaked: false,
    boss: false,
    ageMs: 0,
    stuckMs: 0,
    admittedGates: [],
    summonsRemaining: 0,
    nextSummonInMs: 0,
  };
}

function boardProps(
  overrides: Partial<ComponentProps<typeof GameBoard>> = {},
): ComponentProps<typeof GameBoard> {
  return {
    map: mission.map,
    orientation: "horizontal",
    catalog: GAME_CATALOG,
    placed: [],
    enemies: [],
    effects: [],
    engagements: [],
    heroUnits: [],
    heroEngagements: [],
    selectedPadId: null,
    selectedPlacementId: null,
    armedDefense: null,
    armedHeroId: null,
    detectionActive: false,
    primaryTargetNodeId: "api",
    integrity: 1,
    reducedMotion: false,
    elapsedMs: 0,
    onSelectPad: () => {},
    onSelectPlacement: () => {},
    onDeployHero: () => {},
    ...overrides,
  };
}

function renderBoard(overrides: Partial<ComponentProps<typeof GameBoard>> = {}) {
  return render(<GameBoard {...boardProps(overrides)} />);
}

describe("GameBoard", () => {
  it("places many tower pads along the road and hides architecture labels", () => {
    renderBoard();
    expect(
      screen.getByRole("button", { name: "Tower pad 1" }),
    ).toBeInTheDocument();
    // Pads run along the whole road, not three fixed columns.
    expect(
      screen.getAllByRole("button", { name: /Tower pad \d+/ }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("Internet")).not.toBeInTheDocument();
    expect(screen.queryByText("Edge")).not.toBeInTheDocument();
  });

  it("reports the tapped pad", () => {
    const onSelectPad = vi.fn();
    renderBoard({ orientation: "vertical", onSelectPad });
    fireEvent.click(
      screen.getByRole("button", { name: "Tower pad 1" }),
    );
    const pad = onSelectPad.mock.calls[0][0];
    expect(pad.id.startsWith("pad-1")).toBe(true);
    expect(typeof pad.nodeId).toBe("string");
  });

  it("renders a placed tower by its pad", () => {
    renderBoard({
      placed: [
        {
          id: "p1",
          defenseId: "rate_limiter",
          nodeId: "internet",
          padId: "pad-1",
          level: 1,
        },
      ],
    });
    expect(
      screen.getByRole("button", { name: /Rate Limiter, level 1/ }),
    ).toBeInTheDocument();
  });

  it("caps rendered enemies without changing the count", () => {
    const enemies = Array.from(
      { length: ENEMY_RENDER_CAP + 10 },
      (_, index) => enemy(index),
    );
    renderBoard({ enemies });
    expect(screen.getByText(/Showing 26 of 36 attacks/)).toBeInTheDocument();
  });

  it("shows what an attack is when it is tapped, and hides it when tapped again", () => {
    renderBoard({ enemies: [enemy(0)] });

    fireEvent.click(
      screen.getByRole("button", { name: /DDoS Swarm, DDoS/ }),
    );
    expect(screen.getByText("DDoS Swarm")).toBeInTheDocument();
    expect(screen.getByText(/14 \/ 14 HP/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /DDoS Swarm, DDoS/ }),
    );
    expect(screen.queryByText("DDoS Swarm")).not.toBeInTheDocument();
  });

  it("keeps the callout until the attack is destroyed", () => {
    const alive = boardProps({ enemies: [enemy(0)] });
    const { rerender } = render(<GameBoard {...alive} />);

    fireEvent.click(
      screen.getByRole("button", { name: /DDoS Swarm, DDoS/ }),
    );
    expect(screen.getByText("DDoS Swarm")).toBeInTheDocument();

    // Still alive after the next simulation tick: the callout persists.
    rerender(<GameBoard {...alive} />);
    expect(screen.getByText("DDoS Swarm")).toBeInTheDocument();

    // Destroyed: the callout goes with it.
    rerender(<GameBoard {...boardProps({ enemies: [] })} />);
    expect(screen.queryByText("DDoS Swarm")).not.toBeInTheDocument();
  });

  it("keeps a hidden attack unidentified until Detection is online", () => {
    renderBoard({ enemies: [{ ...enemy(0), revealed: false }] });

    fireEvent.click(screen.getByRole("button", { name: /Unknown attack/ }));
    expect(screen.getByText("Unknown attack")).toBeInTheDocument();
    expect(
      screen.getByText(/Deploy Monitoring \/ IDS to identify hidden attacks/),
    ).toBeInTheDocument();
    expect(screen.queryByText("DDoS Swarm")).not.toBeInTheDocument();
  });

  it("labels a revealed attack even when Detection is online", () => {
    renderBoard({
      detectionActive: true,
      enemies: [{ ...enemy(0), revealed: false }],
    });

    fireEvent.click(
      screen.getByRole("button", { name: /DDoS Swarm, DDoS/ }),
    );
    expect(screen.getByText("DDoS Swarm")).toBeInTheDocument();
  });
});
