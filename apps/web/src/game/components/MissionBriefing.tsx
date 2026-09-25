import type { CSSProperties } from "react";

import type { MissionDefinition } from "../models/mission";
import type { GameCatalog } from "../data";
import TowerArt from "./art/TowerArt";

/**
 * Mission briefing (spec section 38.3). Deliberately short: threats, budget,
 * latency target, and the available controls — no long tutorial.
 */
export interface MissionBriefingProps {
  mission: MissionDefinition;
  catalog: GameCatalog;
  lockedReason?: string;
  onStart: () => void;
  onExit: () => void;
}

export default function MissionBriefing({
  mission,
  catalog,
  lockedReason,
  onStart,
  onExit,
}: MissionBriefingProps) {
  const defenses = mission.availableDefenses
    .map((id) => catalog.defensesById[id])
    .filter((defense): defense is NonNullable<typeof defense> => !!defense);

  return (
    <section className="cyber-briefing" aria-labelledby="cyber-briefing-title">
      <button type="button" className="cyber-back" onClick={onExit}>
        ← All missions
      </button>
      <h1 id="cyber-briefing-title">{mission.title}</h1>
      <p className="cyber-briefing-lede">{mission.description}</p>

      <dl className="cyber-briefing-stats">
        <div>
          <dt>Threats</dt>
          <dd>{mission.threatSummary.join(", ")}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{mission.startingBudget.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Latency target</dt>
          <dd>&lt; {mission.latencyTargetMs} ms</dd>
        </div>
      </dl>

      <div>
        <h2>Available controls</h2>
        <ul className="cyber-briefing-defenses">
          {defenses.map((defense) => (
            <li
              key={defense.id}
              style={{ "--tower-color": defense.color } as CSSProperties}
            >
              <svg
                className="cyber-briefing-thumb"
                viewBox="-24 -24 48 48"
                aria-hidden="true"
              >
                <TowerArt defense={defense} level={1} />
              </svg>
              <span>
                <strong>{defense.name}</strong>
                <span className="muted"> — {defense.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {lockedReason ? (
        <p className="cyber-briefing-locked" role="note">
          🔒 {lockedReason}
        </p>
      ) : null}

      <div className="cyber-briefing-actions">
        <button
          type="button"
          className="cyber-primary-button"
          onClick={onStart}
          disabled={!!lockedReason}
        >
          Start setup
        </button>
        <button type="button" className="cyber-secondary-button" onClick={onExit}>
          Back
        </button>
      </div>
    </section>
  );
}
