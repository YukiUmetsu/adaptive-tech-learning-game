import type { AttackType } from "../models/attack";
import {
  defenseStatsAtLevel,
  placeCost,
  type PlacedDefense,
} from "../models/defense";
import type { HeroRuntime, HeroUnit } from "../models/hero";
import type { MissionDefinition } from "../models/mission";
import type { GameCatalog } from "../data";
import {
  activeSynergies,
  auraBonus,
  canPlaceDefense,
  computeSpentBudget,
  coverageContains,
  damagePerSecond,
  hasDetection,
  systemDamageReduction,
  leakedSystemDamage,
  synergyDamageBonus,
  type PlacementCheck,
} from "./combat";
import { computePath } from "./pathing";
import { newId } from "../../lib/id";

/**
 * Deterministic, browser-only mission simulation (spec section 28).
 *
 * `stepSimulation` advances the state by a delta of in-game milliseconds and
 * returns a new state object. It performs no I/O, does not read the wall clock,
 * and takes no randomness unless a caller seeds it, which keeps it unit
 * testable and reproducible.
 *
 * Towers deal continuous damage per second while an attack is inside their
 * range (the tower-defense abstraction of continuously filtering traffic). Each
 * tick the simulation also emits `engagements` (which tower is firing at which
 * attack) and transient `effects` (blocked / breach) so the renderer can draw
 * beams and hit feedback without owning any gameplay state.
 */

export type GamePhase = "prep" | "running" | "won" | "lost";
export type WaveState = "spawning" | "clearing" | "intermission";

/** Build phase between waves. Long enough to plan, short enough to stay snappy. */
export const INTERMISSION_MS = 6000;
/** Duration of the "WAVE N" / "BOSS" entrance banner. */
export const WAVE_BANNER_MS = 1900;
const BLOCKED_EFFECT_MS = 650;
const LEAK_EFFECT_MS = 950;
const TIMEOUT_EFFECT_MS = 800;
const HIT_EFFECT_MS = 320;
const RESTORE_EFFECT_MS = 1200;

/** Rate-limiter gate queue. Only swarm traffic (DDoS) is rate limited. */
export const GATE_QUEUE_RANGE = 1.3;
export const GATE_QUEUE_OFFSET = 0.12;
const GATE_PASS_INTERVAL_MS = 750;
const GATE_PATIENCE_MS = 3200;

/** Firing cadence: a burst of shots, then a small break. */
const FIRE_BURST_MS = 620;
const FIRE_REST_MS = 140;

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 100000;
  }
  return hash;
}

function inFireBurst(elapsedMs: number, seed: number): boolean {
  const period = FIRE_BURST_MS + FIRE_REST_MS;
  return (elapsedMs + seed) % period < FIRE_BURST_MS;
}

const DEFAULT_WAVE_BONUS = 80;
const DEFAULT_EARLY_CALL_BONUS_PER_SECOND = 5;

/** Health fraction below which Backup triggers its one restore. */
const BACKUP_THRESHOLD = 0.5;

export interface EnemyState {
  id: string;
  attackId: string;
  attackType: AttackType;
  health: number;
  maxHealth: number;
  systemDamage: number;
  speed: number;
  /** Node ids from entry to target. */
  path: string[];
  pathIndex: number;
  /** Progress along the current segment, 0..1. */
  progress: number;
  revealed: boolean;
  blocked: boolean;
  leaked: boolean;
  boss: boolean;
  ageMs: number;
  /** Milliseconds piled up at a congested gate. */
  stuckMs: number;
  /** Gates this attack has been admitted through. */
  admittedGates: string[];
  /** Boss summons still owed. */
  summonsRemaining: number;
  /** Milliseconds until the next summon. */
  nextSummonInMs: number;
}

/** A tower currently firing at one attack, for beam rendering. */
export interface Engagement {
  defenseId: string;
  nodeId: string;
  enemyId: string;
}

/** A deployed hero attacking one attack. */
export interface HeroEngagement {
  heroUnitId: string;
  enemyId: string;
}

export type EffectKind = "blocked" | "leak" | "timeout" | "hit" | "restore";

/** A short-lived visual event. Derived from the simulation, never authoritative. */
export interface GameEffect {
  seq: number;
  kind: EffectKind;
  /** Snapshot of the attack path so the renderer can locate the effect. */
  path: string[];
  position: number;
  attackType: AttackType;
  boss: boolean;
  expiresAtMs: number;
  /** Health restored, for a `restore` effect. */
  amount?: number;
}

export interface WaveBanner {
  waveIndex: number;
  boss: boolean;
  remainingMs: number;
}

export interface SpawnEvent {
  atMs: number;
  attackId: string;
}

export interface MissionStats {
  spawned: number;
  blocked: number;
  leaked: number;
  blockedByAttack: Record<string, number>;
  leakedByAttack: Record<string, number>;
  damagedByAttack: Record<string, number>;
  damageByDefense: Record<string, number>;
  creditsEarned: number;
  earlyCalls: number;
  heroUses: number;
}

export interface GameState {
  missionId: string;
  phase: GamePhase;
  waveIndex: number;
  waveElapsedMs: number;
  waveState: WaveState;
  intermissionRemainingMs: number;
  health: number;
  maxHealth: number;
  budget: number;
  placed: PlacedDefense[];
  enemies: EnemyState[];
  engagements: Engagement[];
  heroUnits: HeroUnit[];
  heroEngagements: HeroEngagement[];
  effects: GameEffect[];
  waveBanner: WaveBanner | null;
  heroes: HeroRuntime[];
  stats: MissionStats;
  spawnQueue: SpawnEvent[];
  nextSpawnIndex: number;
  /** Per-gate time (elapsedMs) of the next admitted pass. */
  gatePass: Record<string, number>;
  effectSeq: number;
  restoreUsed: boolean;
  elapsedMs: number;
  /** Number of Backup restores triggered this mission. */
  backupRestoresUsed: number;
  /** Total system health restored by Backup this mission. */
  backupRestored: number;
}

export interface StepContext {
  mission: MissionDefinition;
  catalog: GameCatalog;
}

export interface SimResult {
  state: GameState;
  ok: boolean;
  reason?: string;
}

function emptyStats(): MissionStats {
  return {
    spawned: 0,
    blocked: 0,
    leaked: 0,
    blockedByAttack: {},
    leakedByAttack: {},
    damagedByAttack: {},
    damageByDefense: {},
    creditsEarned: 0,
    earlyCalls: 0,
    heroUses: 0,
  };
}

function enemyPosition(enemy: EnemyState): number {
  return enemy.pathIndex + enemy.progress;
}

/** Builds the per-wave spawn schedule. Groups spawn concurrently. */
export function buildSpawnQueue(
  mission: MissionDefinition,
  waveIndex: number,
): SpawnEvent[] {
  const wave = mission.waves[waveIndex];
  if (!wave) {
    return [];
  }
  const events: SpawnEvent[] = [];
  for (const group of wave.groups) {
    const delay = group.delayMs ?? 0;
    for (let i = 0; i < group.count; i += 1) {
      events.push({
        atMs: delay + i * group.spawnIntervalMs,
        attackId: group.attackId,
      });
    }
  }
  // Stable sort keeps declaration order for simultaneous spawns.
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.atMs === b.event.atMs
        ? a.index - b.index
        : a.event.atMs - b.event.atMs,
    )
    .map((entry) => entry.event);
}

/** Creates the initial (preparation) state for a mission. */
export function createInitialState(
  mission: MissionDefinition,
  catalog: GameCatalog,
): GameState {
  return {
    missionId: mission.id,
    phase: "prep",
    waveIndex: 0,
    waveElapsedMs: 0,
    waveState: "spawning",
    intermissionRemainingMs: 0,
    health: mission.startingHealth,
    maxHealth: mission.startingHealth,
    budget: mission.startingBudget,
    placed: [],
    enemies: [],
    engagements: [],
    heroUnits: [],
    heroEngagements: [],
    effects: [],
    waveBanner: null,
    heroes: mission.availableHeroes
      .filter((id) => catalog.heroesById[id])
      .map((heroId) => ({
        heroId,
        cooldownRemainingMs: 0,
      })),
    stats: emptyStats(),
    spawnQueue: [],
    nextSpawnIndex: 0,
    gatePass: {},
    effectSeq: 0,
    restoreUsed: false,
    elapsedMs: 0,
    backupRestoresUsed: 0,
    backupRestored: 0,
  };
}

/** Starts a wave: resets spawn/engagement state and queues the entrance banner. */
export function beginWave(
  state: GameState,
  mission: MissionDefinition,
  waveIndex: number,
): GameState {
  if (waveIndex >= mission.waves.length) {
    return { ...state, phase: "won", engagements: [] };
  }
  const wave = mission.waves[waveIndex];
  return {
    ...state,
    phase: "running",
    waveIndex,
    waveState: "spawning",
    waveElapsedMs: 0,
    intermissionRemainingMs: 0,
    spawnQueue: buildSpawnQueue(mission, waveIndex),
    nextSpawnIndex: 0,
    enemies: [],
    engagements: [],
    heroEngagements: [],
    waveBanner: {
      waveIndex,
      boss: wave?.boss === true,
      remainingMs: WAVE_BANNER_MS,
    },
  };
}

/** Convenience for the UI: the player pressing "Start wave". */
export function startFirstWave(
  state: GameState,
  mission: MissionDefinition,
): GameState {
  if (state.phase !== "prep") {
    return state;
  }
  return beginWave(state, mission, 0);
}

/**
 * Calls the next wave during the build phase, granting a bonus for the time
 * saved (a classic tower-defense risk/reward choice).
 */
export function callNextWave(
  state: GameState,
  mission: MissionDefinition,
): SimResult {
  if (state.phase !== "running" || state.waveState !== "intermission") {
    return { state, ok: false, reason: "No wave is waiting." };
  }
  const perSecond =
    mission.earlyCallBonusPerSecond ?? DEFAULT_EARLY_CALL_BONUS_PER_SECOND;
  const seconds = Math.max(0, state.intermissionRemainingMs) / 1000;
  const bonus = Math.round(seconds * perSecond);
  const boosted: GameState = {
    ...state,
    budget: state.budget + bonus,
    stats: {
      ...state.stats,
      creditsEarned: state.stats.creditsEarned + bonus,
      earlyCalls: state.stats.earlyCalls + 1,
    },
  };
  return { state: beginWave(boosted, mission, state.waveIndex + 1), ok: true };
}

export function totalBudgetSpent(
  state: GameState,
  catalog: GameCatalog,
): number {
  return computeSpentBudget(state.placed, catalog);
}

export function canAfford(state: GameState, cost: number): boolean {
  return state.budget >= cost;
}

/** Places a level-1 defense, deducting its cost from the mission budget. */
export function placeDefense(
  state: GameState,
  input: {
    defenseId: string;
    nodeId: string;
    nodeType: string;
    padId?: string;
    /** Gate controls span the road and need the paired pad. */
    gate?: { partnerPadId: string; position: number };
  },
  catalog: GameCatalog,
): SimResult {
  const defense = catalog.defensesById[input.defenseId];
  if (!defense) {
    return { state, ok: false, reason: "Unknown control." };
  }
  const placement: PlacementCheck = canPlaceDefense(
    defense,
    input.nodeType as never,
  );
  if (!placement.ok) {
    return { state, ok: false, reason: placement.reason };
  }
  const targetPad = input.padId ?? input.nodeId;
  const padOccupied = (pad: string) =>
    state.placed.some(
      (item) => item.padId === pad || item.gatePartnerPadId === pad,
    );
  if (padOccupied(targetPad)) {
    return {
      state,
      ok: false,
      reason: "That build pad is already occupied.",
    };
  }
  if (input.gate && padOccupied(input.gate.partnerPadId)) {
    return {
      state,
      ok: false,
      reason: "The other side of the road is occupied.",
    };
  }
  const cost = placeCost(defense);
  if (state.budget < cost) {
    return { state, ok: false, reason: "Not enough budget." };
  }
  const placed: PlacedDefense = {
    id: newId(),
    defenseId: defense.id,
    nodeId: input.nodeId,
    padId: input.padId,
    level: 1,
    gate: input.gate ? true : undefined,
    gatePosition: input.gate?.position,
    gatePartnerPadId: input.gate?.partnerPadId,
  };
  return {
    state: {
      ...state,
      budget: state.budget - cost,
      placed: [...state.placed, placed],
    },
    ok: true,
  };
}

/** Upgrades a placed defense one level, deducting the upgrade cost. */
export function upgradeDefense(
  state: GameState,
  placementId: string,
  catalog: GameCatalog,
): SimResult {
  const index = state.placed.findIndex((item) => item.id === placementId);
  if (index < 0) {
    return { state, ok: false, reason: "Control not found." };
  }
  const placed = state.placed[index];
  const defense = catalog.defensesById[placed.defenseId];
  if (!defense) {
    return { state, ok: false, reason: "Unknown control." };
  }
  if (placed.level >= defense.maxLevel) {
    return { state, ok: false, reason: `${defense.name} is fully upgraded.` };
  }
  const nextPlaced = state.placed.map((item, itemIndex) =>
    itemIndex === index ? { ...item, level: item.level + 1 } : item,
  );
  return {
    state: { ...state, placed: nextPlaced },
    ok: true,
  };
}

/** Removes a placed defense and refunds its full cost (free experimentation). */
export function removeDefense(
  state: GameState,
  placementId: string,
  catalog: GameCatalog,
): SimResult {
  const placed = state.placed.find((item) => item.id === placementId);
  if (!placed) {
    return { state, ok: false, reason: "Control not found." };
  }
  const refund = computeSpentBudget([placed], catalog);
  return {
    state: {
      ...state,
      budget: state.budget + refund,
      placed: state.placed.filter((item) => item.id !== placementId),
      engagements: state.engagements.filter(
        (entry) => entry.defenseId !== placementId,
      ),
    },
    ok: true,
  };
}

/**
 * Deploys a hero onto the road at the given path position. The hero fights for
 * its duration and then goes on cooldown.
 */
export function deployHero(
  state: GameState,
  heroId: string,
  position: number,
  catalog: GameCatalog,
): SimResult {
  const hero = state.heroes.find((item) => item.heroId === heroId);
  const definition = catalog.heroesById[heroId];
  if (!hero || !definition) {
    return { state, ok: false, reason: "Hero not available." };
  }
  if (hero.cooldownRemainingMs > 0) {
    return { state, ok: false, reason: `${definition.name} is not ready yet.` };
  }
  if (state.heroUnits.some((unit) => unit.heroId === heroId)) {
    return {
      state,
      ok: false,
      reason: `${definition.name} is already deployed.`,
    };
  }
  const unit: HeroUnit = {
    id: newId(),
    heroId,
    position: Math.max(0, position),
    ttlMs: definition.durationMs,
    attackCooldownMs: 0,
  };
  return {
    state: {
      ...state,
      heroUnits: [...state.heroUnits, unit],
      heroes: state.heroes.map((item) =>
        item.heroId === heroId
          ? { ...item, cooldownRemainingMs: definition.cooldownMs }
          : item,
      ),
      stats: { ...state.stats, heroUses: state.stats.heroUses + 1 },
    },
    ok: true,
  };
}

/** Active hero auras from currently deployed units. */
function heroMagnitudes(
  state: GameState,
  catalog: GameCatalog,
): { boost: number; reduction: number } {
  let boost = 0;
  let reduction = 0;
  for (const unit of state.heroUnits) {
    const definition = catalog.heroesById[unit.heroId];
    if (!definition) {
      continue;
    }
    if (definition.kind === "effectiveness_boost") {
      boost += definition.magnitude;
    } else {
      reduction += definition.magnitude;
    }
  }
  return { boost, reduction };
}

interface TowerContext {
  synergies: ReturnType<typeof activeSynergies>;
  aura: number;
  heroBoost: number;
}

function pushEffect(
  state: GameState,
  kind: EffectKind,
  enemy: EnemyState,
  amount?: number,
): void {
  state.effectSeq += 1;
  state.effects.push({
    seq: state.effectSeq,
    kind,
    path: enemy.path,
    position: enemyPosition(enemy),
    attackType: enemy.attackType,
    boss: enemy.boss,
    amount,
    expiresAtMs:
      state.elapsedMs +
      (kind === "blocked"
        ? BLOCKED_EFFECT_MS
        : kind === "timeout"
          ? TIMEOUT_EFFECT_MS
          : kind === "hit"
            ? HIT_EFFECT_MS
            : kind === "restore"
              ? RESTORE_EFFECT_MS
              : LEAK_EFFECT_MS),
  });
}

function killEnemy(enemy: EnemyState, state: GameState): void {
  enemy.health = 0;
  enemy.blocked = true;
  state.stats.blocked += 1;
  state.stats.blockedByAttack[enemy.attackId] =
    (state.stats.blockedByAttack[enemy.attackId] ?? 0) + 1;
  pushEffect(state, "blocked", enemy);
}

function isSwarm(enemy: EnemyState, catalog: GameCatalog): boolean {
  return catalog.attacksById[enemy.attackId]?.tags?.includes("swarm") === true;
}

/** Moves an attack to an exact path position (edge index + fraction). */
function setPathPosition(enemy: EnemyState, position: number): void {
  const maxIndex = Math.max(0, enemy.path.length - 1);
  const clamped = Math.max(0, position);
  const index = Math.min(maxIndex, Math.floor(clamped));
  enemy.pathIndex = index;
  enemy.progress = index >= maxIndex ? 0 : clamped - index;
}

/**
 * Rate-limiter gate queue.
 *
 * Only a small number of swarm attacks pass each gate per interval; everyone
 * else waits outside the small opening and eventually times out.
 */
function applyGateQueues(
  enemies: EnemyState[],
  state: GameState,
  catalog: GameCatalog,
  dtMs: number,
): void {
  const gates = state.placed.filter(
    (entry) => entry.gate && entry.gatePosition !== undefined,
  );
  if (gates.length === 0) {
    return;
  }

  // Admit one swarm attack per gate when the interval has elapsed.
  for (const gate of gates) {
    const gatePosition = gate.gatePosition as number;
    const nextAt = state.gatePass[gate.id] ?? 0;
    if (state.elapsedMs < nextAt) {
      continue;
    }
    let best: EnemyState | null = null;
    let bestPosition = -Infinity;
    for (const enemy of enemies) {
      if (enemy.blocked || !isSwarm(enemy, catalog)) {
        continue;
      }
      if (enemy.admittedGates.includes(gate.id)) {
        continue;
      }
      const position = enemyPosition(enemy);
      if (position >= gatePosition) {
        continue;
      }
      if (gatePosition - position > GATE_QUEUE_RANGE) {
        continue;
      }
      if (position > bestPosition) {
        bestPosition = position;
        best = enemy;
      }
    }
    if (best) {
      best.admittedGates.push(gate.id);
      state.gatePass[gate.id] = state.elapsedMs + GATE_PASS_INTERVAL_MS;
    }
  }

  // Everyone else waits just outside the opening.
  for (const enemy of enemies) {
    if (enemy.blocked || !isSwarm(enemy, catalog)) {
      continue;
    }
    const position = enemyPosition(enemy);
    let blocking: (typeof gates)[number] | null = null;
    for (const gate of gates) {
      if (enemy.admittedGates.includes(gate.id)) {
        continue;
      }
      const gatePosition = gate.gatePosition as number;
      if (gatePosition <= position) {
        continue;
      }
      if (gatePosition - position > GATE_QUEUE_RANGE) {
        continue;
      }
      if (!blocking || gatePosition < (blocking.gatePosition as number)) {
        blocking = gate;
      }
    }
    if (blocking) {
      const maxPosition = (blocking.gatePosition as number) - GATE_QUEUE_OFFSET;
      if (position > maxPosition) {
        setPathPosition(enemy, maxPosition);
      }
      enemy.stuckMs += dtMs;
      if (enemy.stuckMs >= GATE_PATIENCE_MS) {
        enemy.health = 0;
        enemy.blocked = true;
        state.stats.blocked += 1;
        state.stats.blockedByAttack[enemy.attackId] =
          (state.stats.blockedByAttack[enemy.attackId] ?? 0) + 1;
        pushEffect(state, "timeout", enemy);
      }
    } else {
      enemy.stuckMs = Math.max(0, enemy.stuckMs - dtMs * 2);
    }
  }
}

function applyTowerDamage(
  enemy: EnemyState,
  state: GameState,
  catalog: GameCatalog,
  ctx: TowerContext,
  dtSeconds: number,
): void {
  const position = enemyPosition(enemy);
  const synergyBonus = synergyDamageBonus(enemy.attackType, ctx.synergies);
  for (const placed of state.placed) {
    const nodeIndex = enemy.path.indexOf(placed.nodeId);
    if (nodeIndex < 0) {
      continue;
    }
    const defense = catalog.defensesById[placed.defenseId];
    if (!defense) {
      continue;
    }
    const stats = defenseStatsAtLevel(defense, placed.level);
    if (!coverageContains(position, nodeIndex, stats.range)) {
      continue;
    }
    let supportMultiplier = 1;
    for (const source of state.placed) {
      const sourceDefense = catalog.defensesById[source.defenseId];
      if (!sourceDefense?.supportTargetId || sourceDefense.supportTargetId !== defense.id) {
        continue;
      }
      const sourceIndex = enemy.path.indexOf(source.nodeId);
      if (sourceIndex >= 0 && sourceIndex < nodeIndex) {
        supportMultiplier = Math.max(
          supportMultiplier,
          sourceDefense.supportMultiplier ?? 1,
        );
      }
    }
    const dps = damagePerSecond(defense, placed.level, enemy.attackType, {
      auraBonus: ctx.aura,
      synergyBonus,
      heroBoost: ctx.heroBoost,
      supportMultiplier,
    });
    if (dps <= 0) {
      continue;
    }
    const damage = dps * dtSeconds;
    enemy.health -= damage;
    state.stats.damageByDefense[placed.defenseId] =
      (state.stats.damageByDefense[placed.defenseId] ?? 0) + damage;
    if (enemy.health <= 0) {
      killEnemy(enemy, state);
      return;
    }
  }
}

/** Primary target per firing tower, used to draw beams. */
function computeEngagements(
  enemies: EnemyState[],
  state: GameState,
  catalog: GameCatalog,
  ctx: TowerContext,
): Engagement[] {
  const engagements: Engagement[] = [];
  for (const placed of state.placed) {
    const defense = catalog.defensesById[placed.defenseId];
    if (!defense) {
      continue;
    }
    const stats = defenseStatsAtLevel(defense, placed.level);
    if (stats.power <= 0) {
      continue;
    }
    // Lasers fire in short bursts with a small break, not continuously.
    if (!inFireBurst(state.elapsedMs, hashId(placed.id))) {
      continue;
    }
    let target: EnemyState | null = null;
    let targetPosition = -Infinity;
    for (const enemy of enemies) {
      const nodeIndex = enemy.path.indexOf(placed.nodeId);
      if (nodeIndex < 0) {
        continue;
      }
      const position = enemyPosition(enemy);
      if (!coverageContains(position, nodeIndex, stats.range)) {
        continue;
      }
      const dps = damagePerSecond(defense, placed.level, enemy.attackType, {
        auraBonus: ctx.aura,
        synergyBonus: synergyDamageBonus(enemy.attackType, ctx.synergies),
        heroBoost: ctx.heroBoost,
      });
      if (dps <= 0) {
        continue;
      }
      if (position > targetPosition) {
        targetPosition = position;
        target = enemy;
      }
    }
    if (target) {
      engagements.push({
        defenseId: placed.id,
        nodeId: placed.nodeId,
        enemyId: target.id,
      });
    }
  }
  return engagements;
}

/** Deployed heroes land strong, short-range melee hits on nearby attacks. */
function applyHeroAttacks(
  enemies: EnemyState[],
  state: GameState,
  catalog: GameCatalog,
  dtMs: number,
): void {
  if (state.heroUnits.length === 0) {
    return;
  }
  for (const unit of state.heroUnits) {
    unit.attackCooldownMs = Math.max(0, unit.attackCooldownMs - dtMs);
    if (unit.attackCooldownMs > 0) {
      continue;
    }
    const definition = catalog.heroesById[unit.heroId];
    if (!definition) {
      continue;
    }
    let target: EnemyState | null = null;
    let bestPosition = -Infinity;
    for (const enemy of enemies) {
      if (enemy.blocked) {
        continue;
      }
      const position = enemyPosition(enemy);
      if (Math.abs(position - unit.position) > definition.attackRange) {
        continue;
      }
      if (position > bestPosition) {
        bestPosition = position;
        target = enemy;
      }
    }
    if (!target) {
      continue;
    }
    target.health -= definition.attackDamage;
    unit.attackCooldownMs = definition.attackIntervalMs;
    pushEffect(state, "hit", target);
    if (target.health <= 0) {
      killEnemy(target, state);
    }
  }
}

/** Primary target per deployed hero, used to draw attacks. */
function computeHeroEngagements(
  enemies: EnemyState[],
  state: GameState,
  catalog: GameCatalog,
): HeroEngagement[] {
  const result: HeroEngagement[] = [];
  for (const unit of state.heroUnits) {
    const definition = catalog.heroesById[unit.heroId];
    if (!definition) {
      continue;
    }
    let target: EnemyState | null = null;
    let bestPosition = -Infinity;
    for (const enemy of enemies) {
      const position = enemyPosition(enemy);
      if (Math.abs(position - unit.position) > definition.attackRange) {
        continue;
      }
      if (position > bestPosition) {
        bestPosition = position;
        target = enemy;
      }
    }
    if (target) {
      result.push({ heroUnitId: unit.id, enemyId: target.id });
    }
  }
  return result;
}

/**
 * Advances the simulation by `dtMs` in-game milliseconds.
 *
 * Returns the same state object when nothing can change (not running, or a
 * non-positive delta), which keeps React re-renders cheap.
 */
export function stepSimulation(
  state: GameState,
  dtMs: number,
  ctx: StepContext,
): GameState {
  if (state.phase !== "running" || dtMs <= 0) {
    return state;
  }

  const { mission, catalog } = ctx;
  const s: GameState = {
    ...state,
    stats: {
      ...state.stats,
      blockedByAttack: { ...state.stats.blockedByAttack },
      leakedByAttack: { ...state.stats.leakedByAttack },
      damagedByAttack: { ...state.stats.damagedByAttack },
      damageByDefense: { ...state.stats.damageByDefense },
    },
    heroes: state.heroes.map((hero) => ({ ...hero })),
    effects: [],
    engagements: [],
    heroEngagements: [],
    gatePass: { ...(state.gatePass ?? {}) },
  };

  s.elapsedMs += dtMs;
  for (const hero of s.heroes) {
    hero.cooldownRemainingMs = Math.max(0, hero.cooldownRemainingMs - dtMs);
  }
  s.heroUnits = state.heroUnits
    .map((unit) => ({ ...unit, ttlMs: unit.ttlMs - dtMs }))
    .filter((unit) => unit.ttlMs > 0);

  // Keep only effects that are still alive after this tick.
  for (const effect of state.effects) {
    if (effect.expiresAtMs > s.elapsedMs) {
      s.effects.push(effect);
    }
  }

  if (s.waveBanner) {
    const remaining = s.waveBanner.remainingMs - dtMs;
    s.waveBanner = remaining > 0 ? { ...s.waveBanner, remainingMs: remaining } : null;
  }

  if (s.waveState === "intermission") {
    s.intermissionRemainingMs -= dtMs;
    if (s.intermissionRemainingMs <= 0) {
      return beginWave(s, mission, s.waveIndex + 1);
    }
    return s;
  }

  s.waveElapsedMs += dtMs;

  const synergies = activeSynergies(
    s.placed.map((item) => item.defenseId),
    catalog.synergies,
  );
  const aura = auraBonus(s.placed, catalog);
  const { boost: heroBoost, reduction: heroReduction } = heroMagnitudes(
    s,
    catalog,
  );
  const towerCtx: TowerContext = { synergies, aura, heroBoost };
  const dtSeconds = dtMs / 1000;

  const enemies: EnemyState[] = [...s.enemies];

  // Spawn scheduled attacks for this tick.
  while (
    s.nextSpawnIndex < s.spawnQueue.length &&
    s.spawnQueue[s.nextSpawnIndex].atMs <= s.waveElapsedMs
  ) {
    const event = s.spawnQueue[s.nextSpawnIndex];
    s.nextSpawnIndex += 1;
    const enemy = createEnemy(event.attackId, s, mission, catalog);
    if (enemy) {
      enemies.push(enemy);
    }
  }

  const summoned: EnemyState[] = [];
  const moved: EnemyState[] = [];

  for (const source of enemies) {
    const enemy: EnemyState = {
      ...source,
      admittedGates: [...(source.admittedGates ?? [])],
    };
    enemy.ageMs += dtMs;

    // Boss summons. `summonsRemaining` counts units, so cap each firing at what
    // is still owed instead of spawning every configured unit per firing.
    const attack = catalog.attacksById[enemy.attackId];
    if (attack?.summons && enemy.summonsRemaining > 0) {
      enemy.nextSummonInMs -= dtMs;
      if (enemy.nextSummonInMs <= 0) {
        let spawned = 0;
        for (const summon of attack.summons) {
          const take = Math.min(summon.count, enemy.summonsRemaining - spawned);
          for (let i = 0; i < take; i += 1) {
            const created = createEnemy(summon.attackId, s, mission, catalog);
            if (created) {
              summoned.push(created);
            }
          }
          spawned += take;
          if (spawned >= enemy.summonsRemaining) {
            break;
          }
        }
        enemy.summonsRemaining -= spawned;
        enemy.nextSummonInMs = attack.summons[0]?.intervalMs ?? 4000;
      }
    }

    let remainingMove = enemy.speed * (dtMs / 1000);
    while (
      remainingMove > 0 &&
      !enemy.blocked &&
      !enemy.leaked &&
      enemy.pathIndex < enemy.path.length - 1
    ) {
      const toNext = 1 - enemy.progress;
      if (remainingMove >= toNext) {
        remainingMove -= toNext;
        enemy.progress = 0;
        enemy.pathIndex += 1;
      } else {
        enemy.progress += remainingMove;
        remainingMove = 0;
      }
    }
    moved.push(enemy);
  }

  // Damage after movement so coverage uses the updated positions.
  applyGateQueues(moved, s, catalog, dtMs);
  for (const enemy of moved) {
    if (!enemy.blocked) {
      applyTowerDamage(enemy, s, catalog, towerCtx, dtSeconds);
    }
  }
  applyHeroAttacks(moved, s, catalog, dtMs);

  const survivors: EnemyState[] = [];
  for (const enemy of moved) {
    if (enemy.blocked) {
      continue;
    }
    if (enemy.pathIndex === enemy.path.length - 1) {
      leakEnemy(enemy, s, catalog, heroReduction);
      continue;
    }
    survivors.push(enemy);
  }

  s.enemies = [...survivors, ...summoned];
  s.engagements = computeEngagements(s.enemies, s, catalog, towerCtx);
  s.heroEngagements = computeHeroEngagements(s.enemies, s, catalog);

  if (s.phase === "running") {
    const noMoreSpawns = s.nextSpawnIndex >= s.spawnQueue.length;
    if (noMoreSpawns && s.enemies.length === 0) {
      if (s.waveIndex >= mission.waves.length - 1) {
        s.phase = "won";
        s.engagements = [];
        s.heroEngagements = [];
      } else {
        const bonus = mission.waveClearBonus ?? DEFAULT_WAVE_BONUS;
        s.budget += bonus;
        s.stats.creditsEarned += bonus;
        s.waveState = "intermission";
        s.intermissionRemainingMs = INTERMISSION_MS;
        s.engagements = [];
        s.heroEngagements = [];
      }
    }
  }

  return s;
}

function createEnemy(
  attackId: string,
  state: GameState,
  mission: MissionDefinition,
  catalog: GameCatalog,
): EnemyState | null {
  const attack = catalog.attacksById[attackId];
  if (!attack) {
    return null;
  }
  const { path, reachable } = computePath(mission.map, attack.targetNodeId);
  if (!reachable) {
    return null;
  }
  const enemy: EnemyState = {
    id: newId(),
    attackId: attack.id,
    attackType: attack.attackType,
    health: attack.health,
    maxHealth: attack.health,
    systemDamage: attack.systemDamage,
    speed: attack.speed,
    path,
    pathIndex: 0,
    progress: 0,
    revealed: !attack.hiddenUntilDetected || hasDetection(state.placed, catalog),
    blocked: false,
    leaked: false,
    boss: attack.boss === true,
    ageMs: 0,
    stuckMs: 0,
    admittedGates: [],
    summonsRemaining:
      attack.summons?.reduce((sum, item) => sum + item.count, 0) ?? 0,
    nextSummonInMs: attack.summons?.[0]?.intervalMs ?? 0,
  };
  state.stats.spawned += 1;
  return enemy;
}

function leakEnemy(
  enemy: EnemyState,
  state: GameState,
  catalog: GameCatalog,
  heroReduction: number,
): void {
  enemy.leaked = true;
  const reduction = systemDamageReduction(enemy.attackType, state.placed, catalog, {
    heroReduction,
  });
  const healthFraction =
    enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;
  const damage = leakedSystemDamage(
    enemy.systemDamage,
    healthFraction,
    reduction,
  );
  state.health = Math.max(0, state.health - damage);
  state.stats.leaked += 1;
  state.stats.leakedByAttack[enemy.attackId] =
    (state.stats.leakedByAttack[enemy.attackId] ?? 0) + 1;
  state.stats.damagedByAttack[enemy.attackType] =
    (state.stats.damagedByAttack[enemy.attackType] ?? 0) + damage;
  pushEffect(state, "leak", enemy);

  if (
    !state.restoreUsed &&
    state.health > 0 &&
    state.health <= state.maxHealth * BACKUP_THRESHOLD
  ) {
    const backup = state.placed.find(
      (item) => catalog.defensesById[item.defenseId]?.restoreAmount,
    );
    if (backup) {
      const defense = catalog.defensesById[backup.defenseId];
      const amount = defense?.restoreAmount ?? 0;
      const restored = Math.min(state.maxHealth, state.health + amount) - state.health;
      state.health += restored;
      state.restoreUsed = true;
      state.backupRestoresUsed += 1;
      state.backupRestored += restored;
      // Visible, audible recovery: the restore is otherwise easy to miss.
      pushEffect(state, "restore", enemy, restored);
    }
  }

  if (state.health <= 0) {
    state.phase = "lost";
  }
}
