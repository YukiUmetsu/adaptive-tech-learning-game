import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GameCatalog } from "../data";
import type { MissionDefinition, SynergyDefinition } from "../models/mission";
import {
  activeSynergies,
  computeLatencyMs,
  computeSpentBudget,
  hasDetection,
} from "../engine/combat";
import {
  callNextWave as callNextWaveAction,
  createInitialState,
  deployHero as deployHeroAction,
  placeDefense as placeDefenseAction,
  removeDefense as removeDefenseAction,
  startFirstWave,
  stepSimulation,
  upgradeDefense as upgradeDefenseAction,
  type GameState,
  type SimResult,
} from "../engine/simulation";
import { clearSession, loadSession, saveSession } from "../persistence/gameCache";

/**
 * Drives a Cyber Defense mission with a fixed-timestep loop.
 *
 * The simulation itself is pure (`stepSimulation`); this hook is the only place
 * that touches timers, React state, and the temporary local cache. Requests are
 * never made during gameplay (spec sections 28 and 46.14).
 */

/** Fixed simulation step. Smaller steps feel smoother without extra cost. */
const TICK_MS = 100;

/** Cache writes are throttled while a wave is running. */
const CACHE_INTERVAL_MS = 1500;

export interface UseGameEngineOptions {
  /** Pauses the loop without losing state (manual pause or configuration). */
  paused: boolean;
  /** 1 or 2. Applied to in-game time, not to the tick clock. */
  speed: number;
}

export interface GameEngineApi {
  state: GameState;
  latencyMs: number;
  spent: number;
  activeSynergies: SynergyDefinition[];
  detectionActive: boolean;
  place: (
    defenseId: string,
    nodeId: string,
    nodeType: string,
    padId?: string,
    gate?: { partnerPadId: string; position: number },
  ) => SimResult;
  upgrade: (placementId: string) => SimResult;
  remove: (placementId: string) => SimResult;
  startWave: () => void;
  callNextWave: () => SimResult;
  deployHero: (heroId: string, position: number) => SimResult;
  reset: () => void;
}

export function useGameEngine(
  mission: MissionDefinition,
  catalog: GameCatalog,
  options: UseGameEngineOptions,
): GameEngineApi {
  const [state, setState] = useState<GameState>(() => {
    const base = createInitialState(mission, catalog);
    const cached = loadSession(mission.id);
    if (!cached) {
      return base;
    }
    // Backfill fields added since the snapshot was written so a restored run
    // can never render with a missing array.
    return {
      ...base,
      ...cached,
      stats: { ...base.stats, ...cached.stats },
      heroes: cached.heroes.length > 0 ? cached.heroes : base.heroes,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const pausedRef = useRef(options.paused);
  pausedRef.current = options.paused;
  const speedRef = useRef(options.speed);
  speedRef.current = options.speed;

  // Reset when the mission changes (for example navigating between missions).
  const missionIdRef = useRef(mission.id);
  useEffect(() => {
    if (missionIdRef.current === mission.id) {
      return;
    }
    missionIdRef.current = mission.id;
    clearSession();
    const fresh = createInitialState(mission, catalog);
    stateRef.current = fresh;
    setState(fresh);
  }, [mission, catalog]);

  // Fixed-timestep loop.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current) {
        return;
      }
      setState((previous) =>
        stepSimulation(previous, TICK_MS * speedRef.current, { mission, catalog }),
      );
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [mission, catalog]);

  // Persist the run so an accidental refresh can recover it.
  const lastSavedRef = useRef(0);
  useEffect(() => {
    if (state.phase === "won" || state.phase === "lost") {
      // A finished run must not be restored as if it were still active.
      clearSession();
      return;
    }
    const now = Date.now();
    if (state.phase === "running" && now - lastSavedRef.current < CACHE_INTERVAL_MS) {
      return;
    }
    lastSavedRef.current = now;
    saveSession(state);
  }, [state]);

  const apply = useCallback((result: SimResult): SimResult => {
    if (result.ok) {
      stateRef.current = result.state;
      setState(result.state);
    }
    return result;
  }, []);

  const place = useCallback(
    (
      defenseId: string,
      nodeId: string,
      nodeType: string,
      padId?: string,
      gate?: { partnerPadId: string; position: number },
    ) =>
      apply(
        placeDefenseAction(
          stateRef.current,
          { defenseId, nodeId, nodeType, padId, gate },
          catalog,
        ),
      ),
    [apply, catalog],
  );

  const upgrade = useCallback(
    (placementId: string) =>
      apply(upgradeDefenseAction(stateRef.current, placementId, catalog)),
    [apply, catalog],
  );

  const remove = useCallback(
    (placementId: string) =>
      apply(removeDefenseAction(stateRef.current, placementId, catalog)),
    [apply, catalog],
  );

  const startWave = useCallback(() => {
    const next = startFirstWave(stateRef.current, mission);
    stateRef.current = next;
    setState(next);
  }, [mission]);

  const callNextWave = useCallback(
    () => apply(callNextWaveAction(stateRef.current, mission)),
    [apply, mission],
  );

  const deployHero = useCallback(
    (heroId: string, position: number) =>
      apply(deployHeroAction(stateRef.current, heroId, position, catalog)),
    [apply, catalog],
  );

  const reset = useCallback(() => {
    clearSession();
    const fresh = createInitialState(mission, catalog);
    stateRef.current = fresh;
    setState(fresh);
  }, [mission, catalog]);

  const latencyMs = useMemo(
    () => computeLatencyMs(state.placed, catalog),
    [state.placed, catalog],
  );
  const spent = useMemo(
    () => computeSpentBudget(state.placed, catalog),
    [state.placed, catalog],
  );
  const synergies = useMemo(
    () =>
      activeSynergies(
        state.placed.map((item) => item.defenseId),
        catalog.synergies,
      ),
    [state.placed, catalog],
  );
  const detectionActive = useMemo(
    () => hasDetection(state.placed, catalog),
    [state.placed, catalog],
  );

  return {
    state,
    latencyMs,
    spent,
    activeSynergies: synergies,
    detectionActive,
    place,
    upgrade,
    remove,
    startWave,
    callNextWave,
    deployHero,
    reset,
  };
}
