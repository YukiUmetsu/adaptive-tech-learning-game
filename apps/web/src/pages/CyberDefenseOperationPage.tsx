import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import CyberDefenseGame from "../game/components/CyberDefenseGame";
import GameErrorBoundary from "../game/components/GameErrorBoundary";
import type { MissionSettlement } from "../game/components/MissionResult";
import OperationBriefing from "../game/components/OperationBriefing";
import OperationLoadout from "../game/components/OperationLoadout";
import type { PostmortemReport } from "../game/engine/postmortem";
import {
  generatedOperationToMissionDefinition,
  operationCatalog,
} from "../game/engine/operationAdapter";
import { GAME_CATALOG } from "../game/data";
import { resolveCatalogHeroes } from "../game/data/heroRuntime";
import {
  resilienceEmergencyRecovery,
  resiliencePostmortemIntel,
  engineeringLabSwapAllowance,
  towerProgressFromUpgrades,
} from "../game/data/towerEffects";
import { useFrozenHeroTalents } from "../game/hooks/useFrozenHeroTalents";
import { clearSession } from "../game/persistence/gameCache";
import {
  abandonOperation,
  completeOperation,
  getOperation,
  refreshCyberProfile,
  setOperationLoadout,
  useCyberProfile,
  type CyberOperationRun,
} from "../game/state/cyberProfile";
import {
  enqueuePendingSettlement,
  removePendingSettlement,
} from "../game/state/pendingSettlements";
import { durationBucket, trackCyberEvent } from "../game/state/cyberTelemetry";

/**
 * Repeatable Operation page: briefing → fight → consolidated settlement.
 *
 * The server-issued run snapshot is fetched and adapted to the Stage 1 engine;
 * the game cache key includes the run id, so a refresh restores the exact run
 * (Stage2.md step 13). Hero talents and Tower effects are resolved and frozen
 * for the run, and a dropped connection leaves a durable pending settlement.
 */
export default function CyberDefenseOperationPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const profile = useCyberProfile();
  const [run, setRun] = useState<CyberOperationRun | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const [briefing, setBriefing] = useState(true);
  const [settlement, setSettlement] = useState<MissionSettlement | null>(null);
  const [loadoutBusy, setLoadoutBusy] = useState(false);
  const [loadoutMessage, setLoadoutMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!runId) {
      setStatus("missing");
      return;
    }
    void (async () => {
      await refreshCyberProfile();
      const result = await getOperation(runId);
      if (!active) {
        return;
      }
      if (result.ok) {
        setRun(result.data);
        setStatus("ready");
      } else {
        setStatus("missing");
      }
    })();
    return () => {
      active = false;
    };
  }, [runId]);

  const talents = useFrozenHeroTalents(profile?.heroes);
  const towerProgress = useMemo(
    () => towerProgressFromUpgrades(profile?.tower_upgrades),
    [profile],
  );

  const mission = useMemo(
    () =>
      run
        ? {
            ...generatedOperationToMissionDefinition(run.operation, run.run_id),
            emergencyRecovery: resilienceEmergencyRecovery(towerProgress),
          }
        : null,
    [run, towerProgress],
  );
  const catalog = useMemo(
    () =>
      run
        ? operationCatalog(
            run.operation,
            resolveCatalogHeroes(GAME_CATALOG, talents),
          )
        : GAME_CATALOG,
    [run, talents],
  );

  const handleComplete = useCallback(
    async (
      report: PostmortemReport,
      context: { heroId?: string; durationMs: number },
    ) => {
      if (!run) {
        return;
      }
      const payload = {
        completed: report.completed,
        stars: report.stars,
        health: report.health,
        duration_ms: Math.max(0, Math.round(context.durationMs)),
      };
      const record = enqueuePendingSettlement({
        kind: "operation",
        runId: run.run_id,
        payload,
      });
      setSettlement({ status: "saving" });
      const result = await completeOperation(run.run_id, payload);
      if (result.ok) {
        removePendingSettlement(record.id);
        trackCyberEvent(
          report.completed
            ? "cyber_operation_completed"
            : "cyber_operation_failed",
          {
            run_id: run.run_id,
            template_id: run.template_id,
            adversary_id: run.adversary_id,
            threat_level: run.threat_level,
            hero_id: run.hero_id ?? undefined,
            result: report.completed ? "completed" : "failed",
            stars: report.stars,
            duration_bucket: durationBucket(context.durationMs),
          },
        );
        const priorRank =
          profile?.adversaries.find(
            (entry) => entry.adversary_id === run.adversary_id,
          )?.rank ?? 1;
        if (result.data.adversary.rank > priorRank) {
          trackCyberEvent("cyber_adversary_rank_up", {
            adversary_id: run.adversary_id,
            result: String(result.data.adversary.rank),
          });
        }
        for (const flag of result.data.dossier_unlocks) {
          trackCyberEvent("cyber_dossier_unlock", {
            adversary_id: run.adversary_id,
            result: flag,
          });
        }
        setSettlement({
          status: "settled",
          reward: {
            bits: result.data.reward.bits,
            careerXp: result.data.reward.career_xp,
            heroXp: result.data.reward.hero_xp,
          },
          career: {
            level: result.data.career.level,
            rank: result.data.career.rank,
            levelUp: result.data.career.level_up,
          },
          dossierUnlocks: result.data.dossier_unlocks,
          storyNodes: result.data.story_nodes_completed,
        });
      } else if (result.code === "network" || result.code === "internal_error") {
        setSettlement({ status: "pending" });
      } else {
        removePendingSettlement(record.id);
        setSettlement({ status: "error", message: result.message });
      }
    },
    [run, profile],
  );

  const handleLoadout = useCallback(
    async (swaps: { remove: string; add: string }[]) => {
      if (!run) {
        return;
      }
      setLoadoutBusy(true);
      setLoadoutMessage(null);
      const result = await setOperationLoadout(run.run_id, swaps);
      if (result.ok) {
        setRun(result.data);
        setLoadoutMessage("Loadout updated.");
      } else {
        setLoadoutMessage(result.message);
      }
      setLoadoutBusy(false);
    },
    [run],
  );

  const handleAbandon = useCallback(async () => {
    if (!run) {
      return;
    }
    trackCyberEvent("cyber_operation_abandoned", {
      run_id: run.run_id,
      template_id: run.template_id,
      adversary_id: run.adversary_id,
      threat_level: run.threat_level,
    });
    await abandonOperation(run.run_id);
    navigate("/game");
  }, [navigate, run]);

  if (status === "loading") {
    return (
      <section>
        <h1>Loading Operation…</h1>
        <p className="muted">Fetching the server-issued Operation.</p>
      </section>
    );
  }

  if (status === "missing" || !run || !mission) {
    return (
      <section>
        <h1>Operation not found</h1>
        <p className="muted">
          That Operation does not exist, or it does not belong to your account.
        </p>
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={() => navigate("/game")}
        >
          Back to dashboard
        </button>
      </section>
    );
  }

  if (briefing) {
    const swapAllowance = engineeringLabSwapAllowance(towerProgress);
    return (
      <>
        <OperationBriefing
          run={run}
          catalog={catalog}
          towerProgress={towerProgress}
          adversaryRank={
            profile?.adversaries.find(
              (entry) => entry.adversary_id === run.adversary_id,
            )?.rank ?? 1
          }
          onStart={() => setBriefing(false)}
          onAbandon={() => {
            void handleAbandon();
          }}
          onExit={() => navigate("/game")}
        />
        {swapAllowance > 0 ? (
          <OperationLoadout
            run={run}
            catalog={catalog}
            allowance={swapAllowance}
            busy={loadoutBusy}
            message={loadoutMessage}
            onApply={(swaps) => void handleLoadout(swaps)}
          />
        ) : null}
      </>
    );
  }

  return (
    <GameErrorBoundary onReset={() => clearSession()}>
      <CyberDefenseGame
        mission={mission}
        catalog={catalog}
        adversaryId={run.adversary_id}
        hasNext={false}
        recordLocalProgress={false}
        onComplete={handleComplete}
        settlement={settlement}
        resilienceIntel={resiliencePostmortemIntel(towerProgress)}
        onExit={() => navigate("/game")}
        onNext={() => navigate("/game")}
      />
    </GameErrorBoundary>
  );
}
