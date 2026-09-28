import type { CSSProperties } from "react";

import InfoPopover from "../../components/InfoPopover";
import type { CyberOperationRun } from "../state/cyberProfile";
import type { GameCatalog } from "../data";
import { ADVERSARIES_BY_ID } from "../data/adversaries";
import { attackIntel } from "../data/attackIntel";
import { HEROES_BY_ID } from "../data/heroes";
import { OPERATION_MODIFIERS_BY_ID } from "../data/operationModifiers";
import {
  deriveOperationIntelVisibility,
  type TowerProgress,
} from "../data/towerEffects";
import { ATTACK_TYPE_LABELS, type AttackType } from "../models/attack";
import { findNode, type MissionMap } from "../models/map";
import { computePath } from "../engine/pathing";
import { layoutMap } from "../engine/layout";
import { buildMapRoadGeometry } from "../engine/roadGeometry";
import { operationMapFor } from "../engine/operationAdapter";
import { operationMapLabel } from "../data/operationMaps";
import AdversaryArt from "./art/AdversaryArt";
import CoreArt from "./art/CoreArt";
import EnemyArt from "./art/EnemyArt";
import HeroArt from "./art/HeroArt";
import {
  BoltIcon,
  ClockIcon,
  CoinIcon,
  HourglassIcon,
  PlayIcon,
  ShieldIcon,
  SwordIcon,
  TargetIcon,
} from "./art/Icons";

/**
 * Operation briefing.
 *
 * A mission-briefing screen: adversary sigil, Threat Level, a target-map
 * schematic, the incoming threat roster, mission parameters, active modifiers,
 * the assigned operator, and the reward preview.
 *
 * What it reveals is gated by Tower progression: without a Security Operations
 * Center the wave detail is unknown, and without Threat Intelligence the
 * adversary specialty, modifiers, and boss presence are hidden. Hidden detail
 * is never rendered at all, so it cannot be read from the DOM (Stage2.md step
 * 13.3 and the SOC / Threat Intelligence room effects).
 */
export interface OperationBriefingProps {
  run: CyberOperationRun;
  catalog: GameCatalog;
  /** Current rank of the Operation's adversary, shown in its intel card. */
  adversaryRank?: number;
  /** Tower/HQ room levels; gates what intel is shown. */
  towerProgress?: TowerProgress;
  onStart: () => void;
  onAbandon: () => void;
  onExit: () => void;
  /** True while the deploy request is in flight. */
  deploying?: boolean;
  /** Deploy failure message; the battle must not start while set. */
  deployError?: string | null;
}

/** One attack family visible in a revealed wave. */
interface WaveFamily {
  attackType: AttackType;
  attackId: string;
  count: number;
  boss: boolean;
}

/** A revealed upcoming wave. */
interface WaveIntel {
  index: number;
  families: WaveFamily[];
  totalCount: number;
  boss: boolean;
}

/** Families present in one wave, in first-seen order. */
function waveFamilies(
  wave: CyberOperationRun["operation"]["waves"][number],
  catalog: GameCatalog,
  dominant: string,
): WaveFamily[] {
  const byType = new Map<AttackType, WaveFamily>();
  for (const group of wave.groups) {
    const attack = catalog.attacksById[group.attack_id];
    if (!attack) {
      continue;
    }
    const existing = byType.get(attack.attackType);
    if (!existing) {
      byType.set(attack.attackType, {
        attackType: attack.attackType,
        attackId: attack.id,
        count: group.count,
        boss: attack.boss === true,
      });
      continue;
    }
    existing.count += group.count;
    existing.boss = existing.boss || attack.boss === true;
  }
  const families = [...byType.values()];
  families.sort((a, b) => {
    const aDominant = a.attackType === dominant;
    const bDominant = b.attackType === dominant;
    if (aDominant !== bDominant) {
      return aDominant ? -1 : 1;
    }
    return b.count - a.count;
  });
  return families;
}

/** Rough intensity label from a wave's total unit count. */
function intensityLabel(totalCount: number): string {
  if (totalCount < 8) {
    return "Light";
  }
  if (totalCount < 20) {
    return "Moderate";
  }
  return "Heavy";
}

/** The map node an Operation is really trying to reach (its longest path). */
function primaryTarget(
  map: MissionMap,
  catalog: GameCatalog,
  run: CyberOperationRun,
): string | null {
  const targets = new Set<string>();
  for (const wave of run.operation.waves) {
    for (const group of wave.groups) {
      const attack = catalog.attacksById[group.attack_id];
      if (attack) {
        targets.add(attack.targetNodeId);
      }
    }
  }
  let best: { id: string; length: number } | null = null;
  for (const id of targets) {
    const { path, reachable } = computePath(map, id);
    if (reachable && (!best || path.length > best.length)) {
      best = { id, length: path.length };
    }
  }
  return best?.id ?? null;
}

/**
 * Horizontal architecture schematic.
 *
 * Renders the real graph (every node and edge) using the same layout
 * abstraction as the game board, so a branching Operation's briefing and battle
 * describe the same topology. Likely/known targets are highlighted.
 */
function TargetMap({
  map,
  targetId,
  dominantType,
}: {
  map: MissionMap;
  targetId: string | null;
  dominantType: AttackType;
}) {
  const layout = layoutMap(map, {
    orientation: "horizontal",
    layerSpacing: 96,
    nodeSpacing: 68,
    margin: 56,
  });
  const geometry = buildMapRoadGeometry(map, layout);
  const targetSet = new Set<string>(
    map.nodes
      .filter((node) => node.id === targetId || node.type === "database")
      .map((node) => node.id),
  );

  const entry = layout.positions[map.entryNodeId];
  const core = targetId ? layout.positions[targetId] : undefined;

  return (
    <svg
      className="cyber-op-map-svg"
      viewBox={`0 0 ${layout.width} ${Math.max(120, layout.height)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Architecture: ${map.nodes
        .map((node) => node.label)
        .join(", ")}`}
    >
      {geometry.edgeOrder.map((key) => {
        const edge = geometry.edges[key];
        return (
          <polyline
            key={key}
            className="cyber-op-map-lane"
            points={edge.points.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        );
      })}
      {map.nodes.map((node) => {
        const position = layout.positions[node.id];
        if (!position) {
          return null;
        }
        const isTarget = targetSet.has(node.id);
        return (
          <g
            key={node.id}
            className={`cyber-op-map-node${isTarget ? " is-target" : ""}`}
            transform={`translate(${position.x} ${position.y})`}
          >
            <circle r={8} className="cyber-op-map-node-ring" />
            <circle r={3.2} className="cyber-op-map-node-dot" />
            <text y={-20} textAnchor="middle" className="cyber-op-map-node-label">
              {node.label}
            </text>
          </g>
        );
      })}
      {entry ? (
        <g transform={`translate(${entry.x - 30} ${entry.y})`}>
          <g className="cyber-op-map-enemy">
            <EnemyArt attackType={dominantType} />
          </g>
        </g>
      ) : null}
      {core ? (
        <g transform={`translate(${core.x + 42} ${core.y})`}>
          <CoreArt integrity={1} />
        </g>
      ) : null}
    </svg>
  );
}

export default function OperationBriefing({
  run,
  catalog,
  adversaryRank = 1,
  towerProgress = {},
  onStart,
  onAbandon,
  onExit,
  deploying = false,
  deployError = null,
}: OperationBriefingProps) {
  const operation = run.operation;
  const adversary = ADVERSARIES_BY_ID[operation.adversary_id] ?? undefined;
  const map = operationMapFor(operation);
  const targetId = primaryTarget(map, catalog, run);
  const visibility = deriveOperationIntelVisibility(towerProgress);
  const hero = run.hero_id ? HEROES_BY_ID[run.hero_id] : undefined;
  const estimatedMinutes = Math.max(
    5,
    Math.round((operation.waves.length * 90) / 60),
  );
  const targetLabel = targetId
    ? (findNode(map, targetId)?.label ?? operationMapLabel(operation.map_id))
    : operationMapLabel(operation.map_id);

  const visibleWaves: WaveIntel[] = operation.waves
    .slice(0, visibility.visibleWaveCount)
    .map((wave, index) => {
      const families = waveFamilies(wave, catalog, operation.dominant_attack_type);
      return {
        index,
        families,
        totalCount: families.reduce((sum, family) => sum + family.count, 0),
        boss: wave.boss === true,
      };
    });

  const modifierLimit = Number.isFinite(visibility.visibleModifierCount)
    ? visibility.visibleModifierCount
    : operation.modifiers.length;
  const visibleModifiers = operation.modifiers.slice(0, modifierLimit);
  const hiddenModifierCount = Math.max(
    0,
    operation.modifiers.length - visibleModifiers.length,
  );
  const adversaryModifiers = (adversary?.modifierIds ?? [])
    .map((id) => OPERATION_MODIFIERS_BY_ID[id]?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <section className="cyber-op" aria-labelledby="operation-title">
      {/* Adversary banner + target schematic */}
      <header
        className="cyber-op-hero"
        style={
          { "--accent": adversary?.color ?? "#38bdf8" } as CSSProperties
        }
      >
        <div className="cyber-op-hero-copy">
          <div className="cyber-op-sigil-row">
            <InfoPopover
              label={`${adversary?.name ?? operation.adversary_name} intel`}
              accent={adversary?.color}
              align="left"
              triggerClassName="cyber-op-adversary-trigger"
              trigger={
                <>
                  <span className="cyber-op-sigil" aria-hidden="true">
                    <AdversaryArt
                      adversaryId={operation.adversary_id}
                      size={64}
                    />
                  </span>
                  <span className="cyber-op-adversary-id">
                    <span className="cyber-op-kicker">
                      {adversary?.name ?? operation.adversary_name}
                    </span>
                    <span className="cyber-op-specialty">
                      {visibility.showAdversarySpecialty
                        ? (adversary?.specialty ?? "Recurring adversary")
                        : "Specialty unknown"}
                    </span>
                  </span>
                </>
              }
            >
              <span className="game-popover-title">
                {adversary?.name ?? operation.adversary_name}
              </span>
              {visibility.showAdversarySpecialty ? (
                <>
                  <p className="cyber-op-intel-summary">
                    {adversary?.theme ?? "A recurring adversary."}
                  </p>
                  <p className="cyber-op-intel-label">
                    {adversary?.specialty ?? "Recurring adversary"}
                  </p>
                </>
              ) : (
                <p className="cyber-op-intel-summary">
                  Upgrade Threat Intelligence to learn this adversary's specialty.
                </p>
              )}
              <p className="cyber-op-intel-label">Rank {adversaryRank}</p>
              {visibility.visibleModifierCount > 0 && adversaryModifiers.length > 0 ? (
                <>
                  <p className="cyber-op-intel-label">Modifier pool</p>
                  <ul className="cyber-op-intel-defences">
                    {adversaryModifiers.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </InfoPopover>
            <span className="cyber-op-threat">
              <span className="cyber-op-threat-num">{operation.threat_level}</span>
              <span className="cyber-op-threat-label">Threat</span>
            </span>
          </div>
          <h1 id="operation-title">{operation.title}</h1>
          <p className="cyber-op-summary">{operation.summary}</p>
        </div>

        <div className="cyber-op-map">
          <TargetMap
            map={map}
            targetId={targetId}
            dominantType={operation.dominant_attack_type as AttackType}
          />
          <p className="cyber-op-map-caption">
            <TargetIcon size={14} /> Target: {targetLabel} ·{" "}
            {operationMapLabel(operation.map_id)}
          </p>
        </div>
      </header>

      <div className="cyber-op-grid">
        <section className="cyber-op-panel" aria-labelledby="op-threats-title">
          <h2 id="op-threats-title">Incoming threats</h2>
          {visibility.visibleWaveCount === 0 ? (
            <p className="muted">
              Threat categories unknown. Upgrade the SOC to reveal the first wave
              before you deploy.
            </p>
          ) : (
            <>
              <p className="cyber-op-hint">Tap a threat for a quick brief.</p>
              {visibleWaves.map((wave) => (
                <div key={wave.index} className="cyber-op-wave">
                  <p className="cyber-op-wave-label">
                    Wave {wave.index + 1}
                    {visibility.showWaveIntensity
                      ? ` — ${intensityLabel(wave.totalCount)}`
                      : ""}
                    {visibility.showBossPresence && wave.boss ? " · BOSS" : ""}
                  </p>
                  <ul className="cyber-op-threats">
                    {wave.families.map((family) => {
                      const intel = attackIntel(family.attackId);
                      const isDominant =
                        family.attackType === operation.dominant_attack_type;
                      return (
                        <li
                          key={`${wave.index}-${family.attackType}`}
                          className={isDominant ? "is-dominant" : ""}
                        >
                          <span className="cyber-op-threat-art" aria-hidden="true">
                            <svg viewBox="-16 -16 32 32">
                              <EnemyArt attackType={family.attackType} />
                            </svg>
                          </span>
                          <span className="cyber-op-threat-name">
                            {ATTACK_TYPE_LABELS[family.attackType]}
                          </span>
                          {visibility.showExactThreatCounts ? (
                            <span className="cyber-op-threat-count">
                              ×{family.count}
                            </span>
                          ) : null}
                          {intel ? (
                            <InfoPopover
                              label={`${ATTACK_TYPE_LABELS[family.attackType]} intel`}
                              accent={adversary?.color}
                            >
                              <span className="game-popover-title">
                                {ATTACK_TYPE_LABELS[family.attackType]}
                              </span>
                              <p className="cyber-op-intel-summary">
                                {intel.summary}
                              </p>
                              <p className="cyber-op-intel-label">How to defend</p>
                              <ul className="cyber-op-intel-defences">
                                {intel.defences.map((defence) => (
                                  <li key={defence}>{defence}</li>
                                ))}
                              </ul>
                            </InfoPopover>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {operation.waves.length > visibleWaves.length ? (
                <p className="muted">
                  {visibility.showWaveIntensity
                    ? `${operation.waves.length - visibleWaves.length} later wave${
                        operation.waves.length - visibleWaves.length === 1 ? "" : "s"
                      } still unknown.`
                    : "More waves remain unknown."}
                </p>
              ) : null}
            </>
          )}

          {visibility.showBossPresence && operation.boss ? (
            <p className="cyber-op-flag is-boss">BOSS INCOMING</p>
          ) : null}
          {visibility.visibleModifierCount > 0 && operation.hidden_attacks ? (
            <p className="cyber-op-flag is-hidden">
              Hidden traffic detected — bring detection
            </p>
          ) : null}
        </section>

        <section className="cyber-op-panel" aria-labelledby="op-params-title">
          <h2 id="op-params-title">Mission parameters</h2>
          <ul className="cyber-op-params">
            <li title="Estimated time">
              <HourglassIcon size={16} />
              <span>~{estimatedMinutes} min</span>
            </li>
            <li title="Waves">
              <BoltIcon size={16} />
              <span>
                {visibility.showWaveIntensity
                  ? `${operation.waves.length} waves`
                  : "waves unknown"}
              </span>
            </li>
            <li title="Starting budget">
              <CoinIcon size={16} />
              <span>{operation.starting_budget.toLocaleString()} credits</span>
            </li>
            <li title="Latency target">
              <ClockIcon size={16} />
              <span>{operation.latency_target_ms} ms target</span>
            </li>
          </ul>
          {hero ? (
            <div className="cyber-op-operator">
              <span className="cyber-op-operator-art" aria-hidden="true">
                <HeroArt heroId={hero.id} size={46} />
              </span>
              <div>
                <span className="cyber-op-operator-label">
                  Assigned operator
                </span>
                <strong>{hero.name}</strong>
              </div>
            </div>
          ) : null}
        </section>

        <section className="cyber-op-panel" aria-labelledby="op-modifiers-title">
          <h2 id="op-modifiers-title">Modifiers</h2>
          {visibility.visibleModifierCount === 0 ? (
            <p className="muted">
              Unknown — upgrade Threat Intelligence to reveal active modifiers.
            </p>
          ) : visibleModifiers.length > 0 ? (
            <>
              <ul className="cyber-op-modifiers">
                {visibleModifiers.map((modifier) => (
                  <li key={modifier.id}>
                    <strong>{modifier.name}</strong>
                    <span>{modifier.description}</span>
                  </li>
                ))}
              </ul>
              {hiddenModifierCount > 0 ? (
                <p className="muted">
                  {hiddenModifierCount} additional modifier
                  {hiddenModifierCount === 1 ? "" : "s"} unknown.
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted">None — a clean run.</p>
          )}
        </section>

        <section className="cyber-op-panel" aria-labelledby="op-reward-title">
          <h2 id="op-reward-title">Reward preview</h2>
          <ul className="cyber-op-rewards">
            <li>
              <CoinIcon size={16} />
              <strong>{operation.reward_preview.bits}</strong>
              <span>Bits</span>
            </li>
            <li>
              <SwordIcon size={16} />
              <strong>{operation.reward_preview.career_xp}</strong>
              <span>Career XP</span>
            </li>
            <li>
              <ShieldIcon size={16} />
              <strong>{operation.reward_preview.hero_xp}</strong>
              <span>Hero XP</span>
            </li>
          </ul>
          <p className="cyber-op-reward-note muted">At 3 stars</p>
        </section>
      </div>

      <div className="cyber-op-actions">
        <button
          type="button"
          className="cyber-cta cyber-op-deploy"
          onClick={onStart}
          disabled={deploying}
        >
          <PlayIcon size={18} /> {deploying ? "DEPLOYING…" : "DEPLOY"}
        </button>
        {deployError ? (
          <span className="cyber-notice" role="alert">
            {deployError}
          </span>
        ) : null}
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={onAbandon}
        >
          Abandon Operation
        </button>
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={onExit}
        >
          Back to dashboard
        </button>
      </div>
    </section>
  );
}
