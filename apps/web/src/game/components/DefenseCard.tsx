import type { CSSProperties } from "react";

import type { AttackType } from "../models/attack";
import type { DefenseDefinition } from "../models/defense";
import { DEFENSE_CATEGORY_LABELS } from "../models/defense";
import { attackLabel, effectivenessStars } from "../lib/format";
import { hasSprite, towerSpriteKey } from "../assets/sprites";
import Sprite from "../assets/Sprite";
import TowerArt from "./art/TowerArt";
import StatsRow, { type Stat } from "./art/Stats";
import {
  BoltIcon,
  ClockIcon,
  CoinIcon,
  TargetIcon,
} from "./art/Icons";

/**
 * Compact, scannable defense card. Shows the tower art, the short description,
 * simple strength stars, and the cost/latency/coverage numbers that matter for
 * the decision.
 */
export interface DefenseCardProps {
  defense: DefenseDefinition;
  cost: number;
  latencyMs: number;
  /** Attack types to show strength for, normally the mission threats. */
  attackTypes: AttackType[];
  canDeploy: boolean;
  invalidReason?: string;
  disabledReason?: string;
  deployLabel: string;
  onDeploy: () => void;
}

export default function DefenseCard({
  defense,
  cost,
  latencyMs,
  attackTypes,
  canDeploy,
  invalidReason,
  disabledReason,
  deployLabel,
  onDeploy,
}: DefenseCardProps) {
  const shown = attackTypes.filter(
    (attackType) => (defense.effectiveness[attackType] ?? 0) > 0,
  );
  const key = towerSpriteKey(defense.id);
  const stats: Stat[] = [
    { icon: <CoinIcon size={14} />, label: "Cost", value: `${cost}`, tone: "cost" },
    { icon: <ClockIcon size={14} />, label: "Latency", value: `+${latencyMs}ms` },
  ];
  if (defense.power > 0) {
    stats.push({
      icon: <BoltIcon size={14} />,
      label: "Damage per second",
      value: `${defense.power}`,
    });
    stats.push({
      icon: <TargetIcon size={14} />,
      label: "Range",
      value: `${defense.range}`,
    });
  }

  return (
    <article
      className="cyber-defense-card"
      style={{ "--tower-color": defense.color } as CSSProperties}
    >
      <div className="cyber-defense-thumb" aria-hidden="true">
        <svg viewBox="-24 -24 48 48">
          {hasSprite(key) ? (
            <Sprite spriteKey={key} x={0} y={0} width={46} height={46} />
          ) : (
            <TowerArt defense={defense} level={1} />
          )}
        </svg>
      </div>

      <div className="cyber-defense-main">
        <header className="cyber-defense-card-head">
          <h3>{defense.name}</h3>
          <span className="cyber-defense-category">
            {DEFENSE_CATEGORY_LABELS[defense.category]}
          </span>
        </header>
        <p className="cyber-defense-desc">{defense.description}</p>

        {shown.length > 0 ? (
          <ul className="cyber-defense-strengths">
            {shown.map((attackType) => (
              <li key={attackType}>
                <span className="cyber-defense-attack">
                  {attackLabel(attackType)}
                </span>
                <span
                  className="cyber-defense-stars"
                  aria-label={`${Math.round(
                    (defense.effectiveness[attackType] ?? 0) * 5,
                  )} of 5`}
                >
                  {effectivenessStars(defense.effectiveness[attackType] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cyber-defense-support">
            Support control — limits impact rather than blocking.
          </p>
        )}

        <StatsRow stats={stats} />

        <div className="cyber-defense-card-foot">
          <button
            type="button"
            className="cyber-deploy-button"
            disabled={!canDeploy}
            title={!canDeploy ? disabledReason ?? invalidReason : undefined}
            onClick={onDeploy}
          >
            {deployLabel}
          </button>
        </div>
        {!canDeploy && (invalidReason || disabledReason) ? (
          <p className="cyber-defense-hint" role="note">
            {invalidReason ?? disabledReason}
          </p>
        ) : null}
      </div>
    </article>
  );
}
