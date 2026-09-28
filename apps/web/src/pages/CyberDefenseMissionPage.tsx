import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import CyberDefenseGame from "../game/components/CyberDefenseGame";
import GameErrorBoundary from "../game/components/GameErrorBoundary";
import MissionBriefing from "../game/components/MissionBriefing";
import type { MissionSettlement } from "../game/components/MissionResult";
import type { PostmortemReport } from "../game/engine/postmortem";
import { GAME_CATALOG } from "../game/data";
import { clearSession } from "../game/persistence/gameCache";
import { isMissionUnlocked, useGameProgress } from "../game/persistence/gameProgress";
import { completeCampaign } from "../game/state/cyberProfile";
import { newId } from "../lib/id";

/**
 * Single-mission page: briefing → preparation → waves → result.
 *
 * `useGameEngine` restores an unfinished run from local storage, so an
 * accidental refresh does not lose the mission (spec section 43). When the
 * match ends, the result is settled server-side and the settled reward is shown
 * (Stage2.md step 5.6); offline attempts report a pending state rather than a
 * fake settled number.
 */
export default function CyberDefenseMissionPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const progress = useGameProgress();
  const [briefing, setBriefing] = useState(true);
  const [settlement, setSettlement] = useState<MissionSettlement | null>(null);

  // Reset to the briefing when navigating directly between missions.
  useEffect(() => {
    setBriefing(true);
    setSettlement(null);
  }, [missionId]);

  const mission = missionId ? GAME_CATALOG.missionsById[missionId] : undefined;

  const handleComplete = useCallback(
    async (
      report: PostmortemReport,
      context: { heroId?: string; durationMs: number },
    ) => {
      if (!mission) {
        return;
      }
      setSettlement({ status: "saving" });
      try {
        const result = await completeCampaign(mission.id, {
          result_id: newId(),
          stars: report.stars,
          health: report.health,
          duration_ms: Math.max(0, Math.round(context.durationMs)),
          hero_id: context.heroId ?? null,
        });
        if (result.ok) {
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
        } else {
          setSettlement({ status: "error", message: result.message });
        }
      } catch {
        setSettlement({ status: "pending" });
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

  const unlocked = isMissionUnlocked(mission, progress);
  const index = GAME_CATALOG.missions.findIndex((item) => item.id === mission.id);
  const nextMission = GAME_CATALOG.missions[index + 1];

  if (briefing) {
    return (
      <MissionBriefing
        mission={mission}
        catalog={GAME_CATALOG}
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
        mission={mission}
        hasNext={!!nextMission}
        onExit={() => navigate("/game")}
        onNext={() => {
          if (nextMission) {
            navigate(`/game/missions/${nextMission.id}`);
          }
        }}
        onComplete={handleComplete}
        settlement={settlement}
      />
    </GameErrorBoundary>
  );
}
