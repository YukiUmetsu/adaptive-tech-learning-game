import { useMemo, type CSSProperties, type ReactNode } from "react";

import type { AttackType } from "../models/attack";
import {
  defenseStatsAtLevel,
  placeCost,
  upgradeBitsCost,
  type PlacedDefense,
} from "../models/defense";
import type { MissionDefinition, SynergyDefinition } from "../models/mission";
import type { GameCatalog } from "../data";
import { canPlaceDefense } from "../engine/combat";
import { isDefenseUnlocked } from "../persistence/gameProgress";
import { hasSprite, towerSpriteKey } from "../assets/sprites";
import Sprite from "../assets/Sprite";
import DefenseCard from "./DefenseCard";
import TowerArt from "./art/TowerArt";
import StatsRow from "./art/Stats";
import { BoltIcon, ClockIcon, CoinIcon, TargetIcon } from "./art/Icons";
import type { PadSelection } from "./GameBoard";

/**
 * Compact defense shop: a bar of control chips plus a detail panel that appears
 * only when the player selects a pad, a control, or a placed tower.
 */
export interface DefenseShopProps {
  mission: MissionDefinition;
  catalog: GameCatalog;
  placed: PlacedDefense[];
  budget: number;
  bitsAvailable: number;
  armedDefenseId: string | null;
  selectedPad: PadSelection | null;
  selectedPlacementId: string | null;
  synergies: SynergyDefinition[];
  feedback: string | null;
  onArm: (defenseId: string) => void;
  onClear: () => void;
  onDeploy: (defenseId: string) => void;
  onUpgrade: (placementId: string) => void;
  onRemove: (placementId: string) => void;
}

export default function DefenseShop({
  mission,
  catalog,
  placed,
  budget,
  bitsAvailable,
  armedDefenseId,
  selectedPad,
  selectedPlacementId,
  synergies,
  feedback,
  onArm,
  onClear,
  onDeploy,
  onUpgrade,
  onRemove,
}: DefenseShopProps) {
  const selectedPlacement = placed.find(
    (entry) => entry.id === selectedPlacementId,
  );

  const threatAttackTypes = useMemo(() => {
    const types = new Set<AttackType>();
    for (const wave of mission.waves) {
      for (const group of wave.groups) {
        const attack = catalog.attacksById[group.attackId];
        if (attack) {
          types.add(attack.attackType);
        }
      }
    }
    return [...types];
  }, [mission, catalog]);

  const availableDefenses = useMemo(
    () =>
      mission.availableDefenses
        .map((id) => catalog.defensesById[id])
        .filter((defense) => defense && isDefenseUnlocked(defense.id)),
    [mission, catalog],
  );

  const hasSelection =
    armedDefenseId !== null ||
    selectedPad !== null ||
    selectedPlacementId !== null;

  const armedDefense = armedDefenseId
    ? catalog.defensesById[armedDefenseId]
    : undefined;

  let detail: ReactNode = null;

  if (selectedPlacement) {
    const defense = catalog.defensesById[selectedPlacement.defenseId];
    if (defense) {
      const stats = defenseStatsAtLevel(defense, selectedPlacement.level);
      const maxed = selectedPlacement.level >= defense.maxLevel;
      const nextCost = maxed ? 0 : upgradeBitsCost(defense, selectedPlacement.level);
      const affordable = bitsAvailable >= nextCost;
      detail = (
        <div className="cyber-shop-detail">
          <div className="cyber-shop-detail-head">
            <h2>{defense.name}</h2>
            <span className="muted">
              Level {selectedPlacement.level}/{defense.maxLevel}
            </span>
          </div>
          <p className="cyber-defense-desc">{defense.description}</p>
          <StatsRow
            stats={[
              { icon: <BoltIcon size={14} />, label: "Damage per second", value: `${Math.round(stats.power)}` },
              { icon: <ClockIcon size={14} />, label: "Latency", value: `+${stats.latencyMs}ms` },
              { icon: <TargetIcon size={14} />, label: "Range", value: `${stats.range}` },
              {
                icon: <CoinIcon size={14} />,
                label: "Upgrade cost",
                value: maxed ? "MAX" : `${nextCost} Bits`,
                tone: "cost",
              },
            ]}
          />
          <div className="cyber-shop-actions">
            <button
              type="button"
              className="cyber-primary-button"
              disabled={maxed || !affordable}
              onClick={() => onUpgrade(selectedPlacement.id)}
            >
              {maxed ? "Fully upgraded" : `Upgrade (${nextCost} Bits)`}
            </button>
            <button
              type="button"
              className="cyber-secondary-button cyber-action-button--danger"
              onClick={() => onRemove(selectedPlacement.id)}
            >
              Remove (refund)
            </button>
          </div>
          {!maxed && !affordable ? (
            <p className="cyber-defense-hint">Not enough Bits.</p>
          ) : null}
        </div>
      );
    }
  } else if (armedDefense) {
    const cost = placeCost(armedDefense);
    const stats = defenseStatsAtLevel(armedDefense, 1);
    const placementCheck = selectedPad
      ? canPlaceDefense(armedDefense, selectedPad.nodeType as never)
      : { ok: false, reason: "Tap a tower pad on the map to place it." };
    const occupied = selectedPad
      ? placed.some(
          (entry) => (entry.padId ?? entry.nodeId) === selectedPad.id,
        )
      : false;
    const affordable = budget >= cost;
    const canDeploy =
      !!selectedPad && placementCheck.ok && !occupied && affordable;
    detail = (
      <div className="cyber-shop-detail">
        <DefenseCard
          defense={armedDefense}
          cost={cost}
          latencyMs={stats.latencyMs}
          attackTypes={threatAttackTypes}
          canDeploy={canDeploy}
          invalidReason={selectedPad ? placementCheck.reason : undefined}
          disabledReason={
            occupied
              ? "This build pad is already occupied."
              : !affordable
                ? "Not enough credits."
                : undefined
          }
          deployLabel={`Deploy (${cost})`}
          onDeploy={() => onDeploy(armedDefense.id)}
        />
      </div>
    );
  } else if (selectedPad) {
    const valid = availableDefenses.filter(
      (defense) => canPlaceDefense(defense, selectedPad.nodeType as never).ok,
    );
    detail = (
      <div className="cyber-shop-detail">
        <div className="cyber-shop-detail-head">
          <h2>Build here</h2>
          <span className="muted">
            {placed.some(
              (entry) => (entry.padId ?? entry.nodeId) === selectedPad.id,
            )
              ? "Occupied"
              : "Empty pad"}
          </span>
        </div>
        {valid.length === 0 ? (
          <p className="muted">No controls fit this spot.</p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="cyber-shop" aria-label="Defense shop">
      <div className="cyber-shop-bar" role="toolbar" aria-label="Defense controls">
        {availableDefenses.map((defense) => {
          const cost = placeCost(defense);
          const armed = defense.id === armedDefenseId;
          const key = towerSpriteKey(defense.id);
          return (
            <button
              key={defense.id}
              type="button"
              className={`cyber-shop-chip${armed ? " is-armed" : ""}${
                budget < cost ? " is-poor" : ""
              }`}
              style={{ "--tower-color": defense.color } as CSSProperties}
              aria-pressed={armed}
              aria-label={`${defense.name}, ${cost} credits`}
              onClick={() => onArm(defense.id)}
            >
              <svg className="cyber-shop-chip-art" viewBox="-26 -26 52 52" aria-hidden="true">
                {hasSprite(key) ? (
                  <Sprite spriteKey={key} x={0} y={0} width={50} height={50} />
                ) : (
                  <TowerArt defense={defense} level={1} />
                )}
              </svg>
              <span className="cyber-shop-chip-name">{defense.name}</span>
              <span className="cyber-shop-chip-cost">{cost}</span>
            </button>
          );
        })}
        {hasSelection ? (
          <button
            type="button"
            className="cyber-shop-clear"
            onClick={onClear}
            aria-label="Cancel selection"
          >
            ✕
          </button>
        ) : null}
      </div>

      {feedback ? (
        <p className="cyber-shop-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      {detail}

      {synergies.length > 0 ? (
        <div className="cyber-synergies">
          <h3>Defense in depth</h3>
          <ul>
            {synergies.map((synergy) => (
              <li key={synergy.id}>
                <strong>{synergy.name}</strong> — {synergy.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
