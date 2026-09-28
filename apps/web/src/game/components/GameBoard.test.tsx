import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { GAME_CATALOG } from "../data";
import { MISSIONS_BY_ID } from "../data/missions";
import { OPERATION_MAPS } from "../data/operationMaps";
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

  it("reports the tapped pad with its stable logical identity", () => {
    const onSelectPad = vi.fn();
    renderBoard({ orientation: "vertical", onSelectPad });
    fireEvent.click(
      screen.getByRole("button", { name: "Tower pad 1" }),
    );
    const pad = onSelectPad.mock.calls[0][0];
    expect(pad.id).toBe("edge--internet--edge--0-left");
    expect(pad.edgeFrom).toBe("internet");
    expect(pad.edgeTo).toBe("edge");
    expect(pad.fraction).toBeGreaterThan(0);
    expect(typeof pad.nodeId).toBe("string");
  });

  it("renders a placed tower by its pad", () => {
    renderBoard({
      placed: [
        {
          id: "p1",
          defenseId: "rate_limiter",
          nodeId: "internet",
          padId: "edge--internet--edge--0-left",
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

  it("draws every architecture edge and places enemies on their own branch", () => {
    const map = OPERATION_MAPS["dual-service"];
    const viaApi: EnemyState = {
      ...enemy(0),
      id: "api-route",
      path: ["internet", "edge", "api", "db"],
      pathIndex: 1,
      progress: 0.5,
    };
    const viaApp: EnemyState = {
      ...enemy(1),
      id: "app-route",
      path: ["internet", "edge", "app", "db"],
      pathIndex: 1,
      progress: 0.5,
    };
    const { container } = render(
      <GameBoard
        {...boardProps({ map, enemies: [viaApi, viaApp], primaryTargetNodeId: "db" })}
      />,
    );

    // One rendered road group per graph edge, including both branches.
    expect(container.querySelectorAll(".cyber-road-group").length).toBe(
      map.edges.length,
    );

    const rendered = container.querySelectorAll(".cyber-enemy");
    expect(rendered.length).toBe(2);
    const transforms = [...rendered].map((node) => node.getAttribute("transform"));
    expect(transforms[0]).not.toEqual(transforms[1]);
  });

  it("only queues the enemy that traverses a branch gate", () => {
    const map = OPERATION_MAPS["dual-service"];
    const gate = {
      id: "gate-1",
      defenseId: "rate_limiter",
      nodeId: "edge",
      padId: "edge--edge--app--0-left",
      gatePartnerPadId: "edge--edge--app--0-right",
      gate: true,
      anchor: { from: "edge", to: "app", fraction: 0.3 },
      level: 1,
    };
    const apiEnemy: EnemyState = {
      ...enemy(0),
      id: "api-route",
      path: ["internet", "edge", "api", "db"],
      pathIndex: 1,
      progress: 0.1,
    };
    const appEnemy: EnemyState = {
      ...enemy(1),
      id: "app-route",
      path: ["internet", "edge", "app", "db"],
      pathIndex: 1,
      progress: 0.1,
    };

    const base = boardProps({ map, primaryTargetNodeId: "db" });
    const apiWithoutGate = render(<GameBoard {...base} enemies={[apiEnemy]} />);
    const apiBase = apiWithoutGate
      .container.querySelector(".cyber-enemy")!
      .getAttribute("transform");
    apiWithoutGate.unmount();

    const apiWithGate = render(
      <GameBoard {...base} placed={[gate]} enemies={[apiEnemy]} />,
    );
    expect(
      apiWithGate.container.querySelector(".cyber-enemy")!.getAttribute("transform"),
    ).toBe(apiBase);
    apiWithGate.unmount();

    const appWithoutGate = render(<GameBoard {...base} enemies={[appEnemy]} />);
    const appBase = appWithoutGate
      .container.querySelector(".cyber-enemy")!
      .getAttribute("transform");
    appWithoutGate.unmount();

    const appWithGate = render(
      <GameBoard {...base} placed={[gate]} enemies={[appEnemy]} />,
    );
    expect(
      appWithGate.container.querySelector(".cyber-enemy")!.getAttribute("transform"),
    ).not.toBe(appBase);
  });

  it("queues swarm traffic but never other attacks on the same gate edge", () => {
    const map = OPERATION_MAPS["dual-service"];
    const gate = {
      id: "gate-1",
      defenseId: "rate_limiter",
      nodeId: "edge",
      padId: "edge--edge--app--0-left",
      gatePartnerPadId: "edge--edge--app--0-right",
      gate: true,
      anchor: { from: "edge", to: "app", fraction: 0.3 },
      level: 1,
    };
    const swarmApp: EnemyState = {
      ...enemy(0),
      id: "swarm-app",
      attackId: "ddos_swarm",
      attackType: "ddos",
      path: ["internet", "edge", "app", "db"],
      pathIndex: 1,
      progress: 0.1,
    };
    const nonSwarmApp: EnemyState = {
      ...enemy(1),
      id: "xss-app",
      attackId: "xss",
      attackType: "xss",
      path: ["internet", "edge", "app", "db"],
      pathIndex: 1,
      progress: 0.1,
    };
    const swarmApi: EnemyState = {
      ...swarmApp,
      id: "swarm-api",
      path: ["internet", "edge", "api", "db"],
    };
    const base = boardProps({ map, primaryTargetNodeId: "db" });

    const transformFor = (state: EnemyState, gated: boolean) => {
      const view = render(
        <GameBoard {...base} placed={gated ? [gate] : []} enemies={[state]} />,
      );
      const transform = view.container
        .querySelector(".cyber-enemy")!
        .getAttribute("transform");
      view.unmount();
      return transform;
    };

    // Swarm on the gate's edge is shifted...
    expect(transformFor(swarmApp, true)).not.toBe(transformFor(swarmApp, false));
    // ...but non-swarm traffic on the same edge is not.
    expect(transformFor(nonSwarmApp, true)).toBe(transformFor(nonSwarmApp, false));
    // ...and swarm on a different branch is not.
    expect(transformFor(swarmApi, true)).toBe(transformFor(swarmApi, false));
  });

  it("keeps an Edge -> Application tower on its branch after an orientation change", () => {
    const map = OPERATION_MAPS["dual-service"];
    const placed = [
      {
        id: "p1",
        defenseId: "traffic_blocker",
        nodeId: "edge",
        padId: "edge--edge--app--0-left",
        anchor: { from: "edge", to: "app", fraction: 0.25 },
        level: 1,
      },
    ];
    const desktop = render(
      <GameBoard
        {...boardProps({ map, placed, primaryTargetNodeId: "db" })}
      />,
    );
    const desktopTower = desktop.getByRole("button", {
      name: /Traffic Blocker, level 1/,
    });
    const desktopTransform = desktopTower.getAttribute("transform");
    desktop.unmount();

    const mobile = render(
      <GameBoard
        {...boardProps({
          map,
          placed,
          primaryTargetNodeId: "db",
          orientation: "vertical",
        })}
      />,
    );
    const mobileTower = mobile.getByRole("button", {
      name: /Traffic Blocker, level 1/,
    });
    // The same saved placement resolves and renders on mobile, at a new pixel
    // position but on the same logical branch.
    expect(mobileTower).toBeInTheDocument();
    expect(mobileTower.getAttribute("transform")).not.toBe(desktopTransform);
  });
});
