import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GAME_CATALOG } from "../data";
import type { MissionDefinition } from "../models/mission";
import { MOBILE_NAV_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { buildPostmortem } from "../engine/postmortem";
import { computePath } from "../engine/pathing";
import { useGameEngine } from "../hooks/useGameEngine";
import { recordMissionResult } from "../persistence/gameProgress";
import { hasSeenTutorial, markTutorialSeen } from "../persistence/tutorial";
import { prefersReducedMotionPreference } from "../../state/preferences";
import { flushBitSpends } from "../../state/bitSpends";
import { refundBits, spendBits, useSettledBits } from "../../state/wallet";
import { newId } from "../../lib/id";
import { upgradeBitsCost } from "../models/defense";
import {
  playBaseHit,
  playBlocked,
  playBoss,
  playBuild,
  playCheck,
  playDefeat,
  playFanfare,
  playHeroAttack,
  playRestore,
  playShoot,
  playUpgrade,
  playVictory,
  playWaveStart,
} from "../../state/sound";
import DefenseShop from "./DefenseShop";
import GameBoard, { type PadSelection } from "./GameBoard";
import GameHud, { type WavePreviewEntry } from "./GameHud";
import HeroBar from "./HeroBar";
import HeroDetail from "./HeroDetail";
import MissionResult from "./MissionResult";
import WaveBanner from "./WaveBanner";
import TutorialOverlay from "./TutorialOverlay";

/**
 * Mission container.
 *
 * Owns UI concerns (selection, pause, speed, sound, screen shake, progress
 * recording) and delegates all gameplay math to the pure engine through
 * `useGameEngine`. Simulation stays offline: the only mid-mission request is the
 * optional, idempotent Bits spend for a control upgrade, which never blocks
 * play and reconciles later (spec sections 28 and 29). The board spans the full
 * width; the tower shop and hero roster are a compact tray below it.
 */
export interface CyberDefenseGameProps {
  mission: MissionDefinition;
  hasNext: boolean;
  onExit: () => void;
  onNext: () => void;
}

export default function CyberDefenseGame({
  mission,
  hasNext,
  onExit,
  onNext,
}: CyberDefenseGameProps) {
  const catalog = GAME_CATALOG;
  const isMobile = useMediaQuery(MOBILE_NAV_QUERY);
  const orientation = isMobile ? "vertical" : "horizontal";
  const reducedMotion = prefersReducedMotionPreference();
  const bitsAvailable = useSettledBits();
  // Stable id for this mission attempt, stamped on every Bits spend so the
  // server can group and audit upgrades within one run.
  const runIdRef = useRef(newId());

  const [manualPaused, setManualPaused] = useState(false);
  const [autoPause, setAutoPause] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [armedDefenseId, setArmedDefenseId] = useState<string | null>(null);
  const [selectedPad, setSelectedPad] = useState<PadSelection | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    null,
  );
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [heroBurst, setHeroBurst] = useState(0);
  const [showTutorial, setShowTutorial] = useState(() => !hasSeenTutorial());

  const hasSelection =
    armedDefenseId !== null ||
    selectedPad !== null ||
    selectedPlacementId !== null ||
    selectedHeroId !== null;
  const paused = manualPaused || (autoPause && hasSelection);

  const engine = useGameEngine(mission, catalog, { paused, speed });
  const { state } = engine;

  const armedDefense = armedDefenseId
    ? catalog.defensesById[armedDefenseId] ?? null
    : null;

  const primaryTargetNodeId = useMemo(() => {
    const targets = new Set<string>();
    for (const wave of mission.waves) {
      for (const group of wave.groups) {
        const attack = catalog.attacksById[group.attackId];
        if (attack) {
          targets.add(attack.targetNodeId);
        }
      }
    }
    let best: { id: string; length: number } | null = null;
    for (const id of targets) {
      const { path, reachable } = computePath(mission.map, id);
      if (reachable && (!best || path.length > best.length)) {
        best = { id, length: path.length };
      }
    }
    return best?.id ?? null;
  }, [mission, catalog]);

  const nextWavePreview = useMemo<WavePreviewEntry[]>(() => {
    const showingBuildPhase =
      state.phase === "prep" || state.waveState === "intermission";
    if (!showingBuildPhase) {
      return [];
    }
    const previewIndex = state.phase === "prep" ? 0 : state.waveIndex + 1;
    const wave = mission.waves[previewIndex];
    if (!wave) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const group of wave.groups) {
      counts.set(group.attackId, (counts.get(group.attackId) ?? 0) + group.count);
    }
    return [...counts.entries()].flatMap(([attackId, count]) => {
      const attack = catalog.attacksById[attackId];
      return attack
        ? [
            {
              attackId,
              name: attack.name,
              attackType: attack.attackType,
              count,
            },
          ]
        : [];
    });
  }, [state.phase, state.waveState, state.waveIndex, mission, catalog]);

  const bossHealth = useMemo(() => {
    const bosses = state.enemies.filter((enemy) => enemy.boss);
    if (bosses.length === 0) {
      return null;
    }
    return {
      health: bosses.reduce((sum, enemy) => sum + enemy.health, 0),
      maxHealth: bosses.reduce((sum, enemy) => sum + enemy.maxHealth, 0),
    };
  }, [state.enemies]);

  const report = useMemo(
    () =>
      state.phase === "won" || state.phase === "lost"
        ? buildPostmortem(state, mission, catalog)
        : null,
    [state, mission, catalog],
  );

  const shakeTimer = useRef<number | null>(null);
  const triggerShake = useCallback(() => {
    setShaking(true);
    if (shakeTimer.current !== null) {
      window.clearTimeout(shakeTimer.current);
    }
    shakeTimer.current = window.setTimeout(() => setShaking(false), 240);
  }, []);
  useEffect(
    () => () => {
      if (shakeTimer.current !== null) {
        window.clearTimeout(shakeTimer.current);
      }
    },
    [],
  );

  const burstTimer = useRef<number | null>(null);
  const triggerHeroBurst = useCallback(() => {
    setHeroBurst((value) => value + 1);
    if (burstTimer.current !== null) {
      window.clearTimeout(burstTimer.current);
    }
    burstTimer.current = window.setTimeout(() => setHeroBurst(0), 900);
  }, []);
  useEffect(
    () => () => {
      if (burstTimer.current !== null) {
        window.clearTimeout(burstTimer.current);
      }
    },
    [],
  );

  const closeTutorial = useCallback(() => {
    markTutorialSeen();
    setShowTutorial(false);
  }, []);

  const prevRef = useRef({ blocked: 0, leaked: 0, waveIndex: -1, restores: 0 });
  useEffect(() => {
    const previous = prevRef.current;
    if (state.stats.blocked > previous.blocked) {
      playBlocked();
    }
    if (state.stats.leaked > previous.leaked) {
      playBaseHit();
      triggerShake();
    }
    if (state.backupRestoresUsed > previous.restores) {
      playRestore();
    }
    if (state.phase === "running" && state.waveIndex !== previous.waveIndex) {
      if (state.waveBanner?.boss) {
        playBoss();
      } else {
        playWaveStart();
      }
    }
    prevRef.current = {
      blocked: state.stats.blocked,
      leaked: state.stats.leaked,
      waveIndex: state.waveIndex,
      restores: state.backupRestoresUsed,
    };
  }, [state, triggerShake]);

  const firing = state.engagements.length > 0;
  useEffect(() => {
    if (firing && !paused) {
      playShoot();
    }
  }, [firing, paused]);

  // A hero melee hit is signalled by a "hit" effect. Play a short swing cue for
  // each new one; the sound service throttles bursts from multiple heroes.
  const heroHitSeqRef = useRef(0);
  useEffect(() => {
    let latest = heroHitSeqRef.current;
    let landed = false;
    for (const effect of state.effects) {
      if (effect.kind === "hit" && effect.seq > heroHitSeqRef.current) {
        landed = true;
        latest = Math.max(latest, effect.seq);
      }
    }
    if (landed) {
      heroHitSeqRef.current = latest;
      playHeroAttack();
    }
  }, [state.effects]);

  const recordedRef = useRef(false);
  useEffect(() => {
    if (!report || recordedRef.current) {
      return;
    }
    recordedRef.current = true;
    if (report.completed) {
      // A perfect clear or a defeated boss earns the bigger fanfare.
      const boss = mission.waves.some((wave) => wave.boss === true);
      if (report.stars >= 3 || boss) {
        playFanfare();
      } else {
        playVictory();
      }
    } else {
      playDefeat();
    }
    recordMissionResult(mission.id, {
      completed: report.completed,
      stars: report.stars,
      health: report.health,
    });
  }, [report, mission.id, mission.waves]);

  const handleArm = (defenseId: string) => {
    setFeedback(null);
    setSelectedPlacementId(null);
    setSelectedHeroId(null);
    setArmedDefenseId((previous) =>
      previous === defenseId ? null : defenseId,
    );
  };

  const gateFor = (defenseId: string, pad: PadSelection) => {
    const defense = catalog.defensesById[defenseId];
    if (!defense?.requiresGate) {
      return undefined;
    }
    return pad.partnerId
      ? { partnerPadId: pad.partnerId, position: pad.roadPosition ?? 0 }
      : undefined;
  };

  const handleSelectPad = (pad: PadSelection) => {
    setFeedback(null);
    setSelectedPlacementId(null);
    setSelectedHeroId(null);
    setSelectedPad(pad);
    if (!armedDefenseId) {
      return;
    }
    const defense = catalog.defensesById[armedDefenseId];
    if (defense?.requiresGate && !pad.partnerId) {
      setFeedback("This control needs both sides of the road.");
      return;
    }
    const result = engine.place(
      armedDefenseId,
      pad.nodeId,
      pad.nodeType,
      pad.id,
      gateFor(armedDefenseId, pad),
    );
    if (result.ok) {
      setFeedback(`${defense?.name ?? "Control"} deployed.`);
      playBuild();
    } else {
      setFeedback(result.reason ?? "Could not deploy there.");
    }
  };

  const handleSelectPlacement = (placementId: string) => {
    setFeedback(null);
    setArmedDefenseId(null);
    setSelectedHeroId(null);
    setSelectedPad(null);
    setSelectedPlacementId(placementId);
  };

  const handleSelectHero = (heroId: string) => {
    setFeedback(null);
    setArmedDefenseId(null);
    setSelectedPlacementId(null);
    setSelectedPad(null);
    setSelectedHeroId((previous) => (previous === heroId ? null : heroId));
  };

  const handleClear = () => {
    setArmedDefenseId(null);
    setSelectedPad(null);
    setSelectedPlacementId(null);
    setSelectedHeroId(null);
    setFeedback(null);
  };

  const handleStartWave = () => {
    // Releasing configuration clears the auto-pause so the wave actually runs.
    handleClear();
    setManualPaused(false);
    engine.startWave();
  };

  const handleTogglePause = () => {
    // If auto-pause is holding the game due to an open configuration, the pause
    // button releases it instead of toggling manual pause.
    if (!manualPaused && autoPause && hasSelection) {
      handleClear();
      return;
    }
    setManualPaused((value) => !value);
  };

  const handleDeploy = (defenseId: string) => {
    if (!selectedPad) {
      setFeedback("Tap a tower pad on the map first.");
      return;
    }
    const defense = catalog.defensesById[defenseId];
    if (defense?.requiresGate && !selectedPad.partnerId) {
      setFeedback("This control needs both sides of the road.");
      return;
    }
    const result = engine.place(
      defenseId,
      selectedPad.nodeId,
      selectedPad.nodeType,
      selectedPad.id,
      gateFor(defenseId, selectedPad),
    );
    if (result.ok) {
      setFeedback(`${defense?.name ?? "Control"} deployed.`);
      playBuild();
    } else {
      setFeedback(result.reason ?? "Could not deploy there.");
    }
  };

  const handleUpgrade = (placementId: string) => {
    const placed = state.placed.find((entry) => entry.id === placementId);
    const defense = placed && catalog.defensesById[placed.defenseId];
    if (!placed || !defense) {
      return;
    }
    const cost = upgradeBitsCost(defense, placed.level);
    const spend = {
      eventId: newId(),
      runId: runIdRef.current,
      defenseId: defense.id,
      fromLevel: placed.level,
      amount: cost,
    };
    if (!spendBits(spend)) {
      setFeedback("Not enough Bits to upgrade.");
      return;
    }
    const result = engine.upgrade(placementId);
    if (result.ok) {
      setFeedback("Control upgraded for this mission.");
      playUpgrade();
      // Persist the debit. The spend already applied locally, so a slow or
      // offline network never blocks the upgrade; the queue reconciles later.
      void flushBitSpends();
    } else {
      refundBits(spend.eventId);
      setFeedback(result.reason ?? "Could not upgrade.");
    }
  };

  const handleRemove = (placementId: string) => {
    const result = engine.remove(placementId);
    if (result.ok) {
      setFeedback("Control removed and refunded.");
      playCheck();
    } else {
      setFeedback(result.reason ?? "");
    }
    setSelectedPlacementId(null);
  };

  const handleDeployHero = (heroId: string, position: number) => {
    const result = engine.deployHero(heroId, position);
    const hero = catalog.heroesById[heroId];
    if (result.ok) {
      setFeedback(`${hero?.name ?? "Hero"} deployed.`);
      playUpgrade();
      triggerHeroBurst();
      setSelectedHeroId(null);
    } else {
      setFeedback(result.reason ?? "Could not deploy the hero.");
    }
  };

  const handleCallNextWave = () => {
    const result = engine.callNextWave();
    if (result.ok) {
      setFeedback("Wave called early — bonus credits earned.");
      playCheck();
    } else {
      setFeedback(result.reason ?? "No wave waiting.");
    }
  };

  const handleRetry = () => {
    recordedRef.current = false;
    setArmedDefenseId(null);
    setSelectedPad(null);
    setSelectedPlacementId(null);
    setSelectedHeroId(null);
    setManualPaused(false);
    engine.reset();
  };

  const selectedHeroRuntime = state.heroes.find(
    (hero) => hero.heroId === selectedHeroId,
  );
  const selectedHeroDef = selectedHeroId
    ? catalog.heroesById[selectedHeroId]
    : undefined;
  const deployedHeroIds = state.heroUnits.map((unit) => unit.heroId);
  const armedHeroId =
    selectedHeroDef &&
    selectedHeroRuntime &&
    selectedHeroRuntime.cooldownRemainingMs <= 0 &&
    !deployedHeroIds.includes(selectedHeroDef.id)
      ? selectedHeroDef.id
      : null;

  const backupPlaced = state.placed.some(
    (item) => (catalog.defensesById[item.defenseId]?.restoreAmount ?? 0) > 0,
  );
  const backupStatus: "ready" | "used" | null = backupPlaced
    ? state.restoreUsed
      ? "used"
      : "ready"
    : null;

  if (report) {
    return (
      <div className="cyber-game cyber-game--result">
        <MissionResult
          report={report}
          mission={mission}
          hasNext={hasNext}
          onRetry={handleRetry}
          onContinue={onExit}
          onNext={onNext}
        />
      </div>
    );
  }

  return (
    <div className="cyber-game">
      <GameHud
        phase={state.phase}
        health={state.health}
        maxHealth={state.maxHealth}
        budget={state.budget}
        latencyMs={engine.latencyMs}
        latencyTargetMs={mission.latencyTargetMs}
        waveIndex={state.waveIndex}
        waveCount={mission.waves.length}
        waveState={state.waveState}
        intermissionRemainingMs={state.intermissionRemainingMs}
        elapsedMs={state.elapsedMs}
        paused={paused}
        speed={speed}
        autoPause={autoPause}
        bossHealth={bossHealth}
        nextWavePreview={nextWavePreview}
        earlyCallBonusPerSecond={mission.earlyCallBonusPerSecond ?? 5}
        onTogglePause={handleTogglePause}
        onSpeedChange={setSpeed}
        onToggleAutoPause={() => setAutoPause((value) => !value)}
        onCallNextWave={handleCallNextWave}
        onShowTutorial={() => setShowTutorial(true)}
        showStartWave={state.phase === "prep"}
        onStartWave={handleStartWave}
        backupStatus={backupStatus}
      />

      <div className={`cyber-board-wrap${shaking ? " is-shaking" : ""}`}>
        <GameBoard
          map={mission.map}
          orientation={orientation}
          catalog={catalog}
          placed={state.placed}
          enemies={state.enemies}
          effects={state.effects}
          engagements={state.engagements}
          heroUnits={state.heroUnits}
          heroEngagements={state.heroEngagements}
          selectedPadId={selectedPad?.id ?? null}
          selectedPlacementId={selectedPlacementId}
          armedDefense={armedDefense}
          armedHeroId={armedHeroId}
          detectionActive={engine.detectionActive}
          primaryTargetNodeId={primaryTargetNodeId}
          integrity={state.maxHealth > 0 ? state.health / state.maxHealth : 0}
          reducedMotion={reducedMotion}
          elapsedMs={state.elapsedMs}
          onSelectPad={handleSelectPad}
          onSelectPlacement={handleSelectPlacement}
          onDeployHero={handleDeployHero}
        />
        <WaveBanner banner={state.waveBanner} waveCount={mission.waves.length} />
        {heroBurst > 0 ? (
          <div key={heroBurst} className="cyber-hero-burst" aria-hidden="true" />
        ) : null}
      </div>

      <div className="cyber-tray">
        <HeroBar
          heroes={state.heroes}
          catalog={catalog}
          deployedHeroIds={deployedHeroIds}
          selectedHeroId={selectedHeroId}
          onSelect={handleSelectHero}
        />

        <DefenseShop
          mission={mission}
          catalog={catalog}
          placed={state.placed}
          budget={state.budget}
          bitsAvailable={bitsAvailable}
          armedDefenseId={armedDefenseId}
          selectedPad={selectedPad}
          selectedPlacementId={selectedPlacementId}
          synergies={engine.activeSynergies}
          feedback={feedback}
          onArm={handleArm}
          onClear={handleClear}
          onDeploy={handleDeploy}
          onUpgrade={handleUpgrade}
          onRemove={handleRemove}
        />

        {selectedHeroDef && selectedHeroRuntime ? (
          <HeroDetail
            definition={selectedHeroDef}
            runtime={selectedHeroRuntime}
            deployed={deployedHeroIds.includes(selectedHeroDef.id)}
            onClose={() => setSelectedHeroId(null)}
          />
        ) : null}
      </div>

      {showTutorial ? <TutorialOverlay onClose={closeTutorial} /> : null}
    </div>
  );
}
