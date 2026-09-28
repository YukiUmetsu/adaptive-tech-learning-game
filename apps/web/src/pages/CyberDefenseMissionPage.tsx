import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import CyberDefenseGame from "../game/components/CyberDefenseGame";
import GameErrorBoundary from "../game/components/GameErrorBoundary";
import MissionBriefing from "../game/components/MissionBriefing";
import type { MissionSettlement } from "../game/components/MissionResult";
import type { PostmortemReport } from "../game/engine/postmortem";
import { resolveCatalogHeroes } from "../game/data/heroRuntime";
import { isCyberCampaignMissionUnlocked } from "../game/data/campaignUnlock";
import { GAME_CATALOG } from "../game/data";
import {
  resilienceEmergencyRecovery,
  resiliencePostmortemIntel,
  towerProgressFromUpgrades,
} from "../game/data/towerEffects";
import { useFrozenHeroTalents } from "../game/hooks/useFrozenHeroTalents";
import { clearSession } from "../game/persistence/gameCache";
import { useGameProgress } from "../game/persistence/gameProgress";
import {
  completeCampaign,
  refreshCyberProfile,
  useCyberProfile,
} from "../game/state/cyberProfile";
import {
  enqueuePendingSettlement,
  removePendingSettlement,
} from "../game/state/pendingSettlements";
import { newId } from "../lib/id";

/**
 * Single-mission page: briefing → preparation → waves → result.
 *
 * `useGameEngine` restores an unfinished run from local storage, so an
 * accidental refresh does not lose the mission (spec section 43). When the
 * match ends, the result is settled server-side and the settled reward is shown
 * (Stage2.md step 5.6); a network failure leaves a durable pending record rather
 * than losing the reward.
 *
 * Cross-device unlocking uses the server campaign state once the profile is
 * available, with local Stage 1 progress only as a pre-import fallback.
 */
export default function CyberDefenseMissionPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const progress = useGameProgress();
  const profile = useCyberProfile();
  const [briefing, setBriefing] = useState(true);
  const [settlement, setSettlement] = useState<MissionSettlement | null>(null);

  useEffect(() => {
    void refreshCyberProfile();
  }, []);

  // Reset to the briefing when navigating directly between missions.
  useEffect(() => {
    setBriefing(true);
    setSettlement(null);
  }, [missionId]);

  const mission = missionId ? GAME_CATALOG.missionsById[missionId] : undefined;

  const talents = useFrozenHeroTalents(profile?.heroes);
  const towerProgress = useMemo(
    () => towerProgressFromUpgrades(profile?.tower_upgrades),
    [profile],
  );
  const catalog = useMemo(
    () => resolveCatalogHeroes(GAME_CATALOG, talents),
    [talents],
  );
  const runMission = useMemo(
    () =>
      mission
        ? { ...mission, emergencyRecovery: resilienceEmergencyRecovery(towerProgress) }
        : undefined,
    [mission, towerProgress],
  );

  const handleComplete = useCallback(
    async (
      report: PostmortemReport,
      context: { heroId?: string; durationMs: number },
    ) => {
      if (!mission) {
        return;
      }
      const payload = {
        stars: report.stars,
        health: report.health,
        duration_ms: Math.max(0, Math.round(context.durationMs)),
        hero_id: context.heroId ?? null,
      };
      // Persist before sending so a dropped connection cannot lose the reward.
      const record = enqueuePendingSettlement({
        kind: "campaign",
        missionId: mission.id,
        resultId: newId(),
        payload,
      });
      setSettlement({ status: "saving" });
      const result = await completeCampaign(mission.id, {
        result_id: record.resultId,
        ...payload,
      });
      if (result.ok) {
        removePendingSettlement(record.id);
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
          storyNodes: result.data.story_nodes_completed,
        });
      } else if (result.code === "network" || result.code === "internal_error") {
        setSettlement({ status: "pending" });
      } else {
        removePendingSettlement(record.id);
        setSettlement({ status: "error", message: result.message });
      }
    },
    [mission],
  );

  if (!mission) {
    return (
      <section>
        <h1>Mission not found</h1>
        <p className="muted">That Cyber Defense mission does not exist.</p>
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={() => navigate("/game")}
        >
          Back to missions
        </button>
      </section>
    );
  }

  const unlocked = isCyberCampaignMissionUnlocked(
    mission,
    profile?.campaign ?? null,
    progress,
  );
  const index = GAME_CATALOG.missions.findIndex((item) => item.id === mission.id);
  const nextMission = GAME_CATALOG.missions[index + 1];

  if (briefing) {
    return (
      <MissionBriefing
        mission={mission}
        catalog={catalog}
        lockedReason={
          unlocked
            ? undefined
            : "This mission is locked until you complete the previous one."
        }
        onStart={() => setBriefing(false)}
        onExit={() => navigate("/game")}
      />
    );
  }

  return (
    <GameErrorBoundary onReset={() => clearSession()}>
      <CyberDefenseGame
        mission={runMission ?? mission}
        catalog={catalog}
        hasNext={!!nextMission}
        onExit={() => navigate("/game")}
        onNext={() => {
          if (nextMission) {
            navigate(`/game/missions/${nextMission.id}`);
          }
        }}
        onComplete={handleComplete}
        settlement={settlement}
        resilienceIntel={resiliencePostmortemIntel(towerProgress)}
      />
    </GameErrorBoundary>
  );
}
