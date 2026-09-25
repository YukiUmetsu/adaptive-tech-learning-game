import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import CyberDefenseGame from "../game/components/CyberDefenseGame";
import GameErrorBoundary from "../game/components/GameErrorBoundary";
import MissionBriefing from "../game/components/MissionBriefing";
import { GAME_CATALOG } from "../game/data";
import { clearSession } from "../game/persistence/gameCache";
import { isMissionUnlocked, useGameProgress } from "../game/persistence/gameProgress";

/**
 * Single-mission page: briefing → preparation → waves → result.
 *
 * `useGameEngine` restores an unfinished run from local storage, so an
 * accidental refresh does not lose the mission (spec section 43).
 */
export default function CyberDefenseMissionPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const progress = useGameProgress();
  const [briefing, setBriefing] = useState(true);

  // Reset to the briefing when navigating directly between missions.
  useEffect(() => {
    setBriefing(true);
  }, [missionId]);

  const mission = missionId ? GAME_CATALOG.missionsById[missionId] : undefined;

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
      />
    </GameErrorBoundary>
  );
}
