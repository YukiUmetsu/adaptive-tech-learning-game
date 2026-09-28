import type { CSSProperties } from "react";

import InfoPopover from "../../components/InfoPopover";
import type { CyberOperationRun } from "../state/cyberProfile";
import type { GameCatalog } from "../data";
import { ADVERSARIES_BY_ID } from "../data/adversaries";
import { attackIntel } from "../data/attackIntel";
import { HEROES_BY_ID } from "../data/heroes";
import { OPERATION_MODIFIERS_BY_ID } from "../data/operationModifiers";
import { ATTACK_TYPE_LABELS, type AttackType } from "../models/attack";
import { findNode, type MapNode, type MissionMap } from "../models/map";
import { computePath } from "../engine/pathing";
import { operationMapFor } from "../engine/operationAdapter";
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
 * the assigned operator, and the reward preview. Hidden wave composition is not
 * revealed unless Tower upgrades expose it (Stage2.md step 13.3).
 */
export interface OperationBriefingProps {
  run: CyberOperationRun;
  catalog: GameCatalog;
  /** Current rank of the Operation's adversary, shown in its intel card. */
  adversaryRank?: number;
  onStart: () => void;
  onAbandon: () => void;
  onExit: () => void;
}

/** Human-readable map name from its id, for example `full-stack` -> `Full Stack`. */
function mapLabel(mapId: string): string {
  return mapId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Aggregated incoming threat per attack family. */
interface ThreatSummary {
  attackType: AttackType;
  /** A representative attack id for this family, used for intel. */
  attackId: string;
  count: number;
  boss: boolean;
}

function summarizeThreats(
  run: CyberOperationRun,
  catalog: GameCatalog,
): ThreatSummary[] {
  const byType = new Map<AttackType, ThreatSummary>();
  for (const wave of run.operation.waves) {
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
      // Prefer a non-boss attack as the family's intel representative.
      if (catalog.attacksById[existing.attackId]?.boss && !attack.boss) {
        existing.attackId = attack.id;
      }
    }
  }
  return [...byType.values()].sort((a, b) => {
    if (a.attackType === run.operation.dominant_attack_type) {
      return -1;
    }
    if (b.attackType === run.operation.dominant_attack_type) {
      return 1;
    }
    return b.count - a.count;
  });
}

/** The map node an Operation is really trying to reach (its longest path). */
function primaryTarget(map: MissionMap, catalog: GameCatalog, run: CyberOperationRun): string | null {
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

/** Horizontal architecture schematic: entry → nodes → protected target. */
function TargetMap({
  map,
  targetId,
  dominantType,
}: {
  map: MissionMap;
  targetId: string | null;
  dominantType: AttackType;
}) {
  const path = targetId ? computePath(map, targetId).path : [];
  const nodes = path
    .map((id) => findNode(map, id))
    .filter((node): node is MapNode => Boolean(node));
  if (nodes.length === 0) {
    return null;
  }

  const spacing = 78;
  const padX = 84;
  const y = 58;
  const width = padX * 2 + (nodes.length - 1) * spacing;
  const nodeX = (index: number) => padX + index * spacing;

  return (
    <svg
      className="cyber-op-map-svg"
      viewBox={`0 0 ${width} 112`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Attack path to ${nodes[nodes.length - 1].label}`}
    >
      <line
        x1={padX}
        y1={y}
        x2={nodeX(nodes.length - 1)}
        y2={y}
        className="cyber-op-map-lane"
      />
      {nodes.map((node, index) => (
        <g
          key={node.id}
          className="cyber-op-map-node"
          transform={`translate(${nodeX(index)} ${y})`}
        >
          <circle r={8} className="cyber-op-map-node-ring" />
          <circle r={3.2} className="cyber-op-map-node-dot" />
          <text y={-20} textAnchor="middle" className="cyber-op-map-node-label">
            {node.label}
          </text>
        </g>
      ))}
      <g transform={`translate(${padX - 30} ${y})`}>
        <g className="cyber-op-map-enemy">
          <EnemyArt attackType={dominantType} />
        </g>
      </g>
      <g transform={`translate(${nodeX(nodes.length - 1) + 42} ${y})`}>
        <CoreArt integrity={1} />
      </g>
    </svg>
  );
}

export default function OperationBriefing({
  run,
  catalog,
  adversaryRank = 1,
  onStart,
  onAbandon,
  onExit,
}: OperationBriefingProps) {
  const operation = run.operation;
  const adversary = ADVERSARIES_BY_ID[operation.adversary_id] ?? undefined;
  const map = operationMapFor(operation);
  const targetId = primaryTarget(map, catalog, run);
  const threats = summarizeThreats(run, catalog);
  const hero = run.hero_id ? HEROES_BY_ID[run.hero_id] : undefined;
  const adversaryModifiers = (adversary?.modifierIds ?? [])
    .map((id) => OPERATION_MODIFIERS_BY_ID[id]?.name)
    .filter((name): name is string => Boolean(name));
  const estimatedMinutes = Math.max(
    5,
    Math.round((operation.waves.length * 90) / 60),
  );
  const targetLabel = targetId
    ? (findNode(map, targetId)?.label ?? mapLabel(operation.map_id))
    : mapLabel(operation.map_id);

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
                      {adversary?.specialty ?? "Recurring adversary"}
                    </span>
                  </span>
                </>
              }
            >
              <span className="game-popover-title">
                {adversary?.name ?? operation.adversary_name}
              </span>
              <p className="cyber-op-intel-summary">
                {adversary?.theme ?? "A recurring adversary."}
              </p>
              <p className="cyber-op-intel-label">Rank {adversaryRank}</p>
              {adversaryModifiers.length > 0 ? (
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
            {mapLabel(operation.map_id)}
          </p>
        </div>
      </header>

      <div className="cyber-op-grid">
        <section className="cyber-op-panel" aria-labelledby="op-threats-title">
          <h2 id="op-threats-title">Incoming threats</h2>
          <p className="cyber-op-hint">Tap a threat for a quick brief.</p>
          <ul className="cyber-op-threats">
            {threats.map((threat) => {
              const intel = attackIntel(threat.attackId);
              return (
                <li
                  key={threat.attackType}
                  className={
                    threat.attackType === operation.dominant_attack_type
                      ? "is-dominant"
                      : ""
                  }
                >
                  <span className="cyber-op-threat-art" aria-hidden="true">
                    <svg viewBox="-16 -16 32 32">
                      <EnemyArt attackType={threat.attackType} />
                    </svg>
                  </span>
                  <span className="cyber-op-threat-name">
                    {ATTACK_TYPE_LABELS[threat.attackType]}
                  </span>
                  <span className="cyber-op-threat-count">
                    ×{threat.count}
                  </span>
                  {intel ? (
                    <InfoPopover
                      label={`${ATTACK_TYPE_LABELS[threat.attackType]} intel`}
                      accent={adversary?.color}
                    >
                      <span className="game-popover-title">
                        {ATTACK_TYPE_LABELS[threat.attackType]}
                      </span>
                      <p className="cyber-op-intel-summary">{intel.summary}</p>
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

          {operation.boss ? (
            <p className="cyber-op-flag is-boss">BOSS INCOMING</p>
          ) : null}
          {operation.hidden_attacks ? (
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
              <span>{operation.waves.length} waves</span>
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
          {operation.modifiers.length > 0 ? (
            <ul className="cyber-op-modifiers">
              {operation.modifiers.map((modifier) => (
                <li key={modifier.id}>
                  <strong>{modifier.name}</strong>
                  <span>{modifier.description}</span>
                </li>
              ))}
            </ul>
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
        >
          <PlayIcon size={18} /> DEPLOY
        </button>
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
