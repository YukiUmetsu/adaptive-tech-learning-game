import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ChallengeSummaryDto } from "../api/types";
import { loadTrackDiscovery } from "../state/learningProgress";
import { startChallenge } from "../state/mission";
import InlineText from "./InlineText";

interface ChallengeListProps {
  trackId: string;
  trackVersion: string;
  challenges: ChallengeSummaryDto[];
}

/**
 * Authored challenges for a track, listed on the hub.
 *
 * Starting one issues a server-composed mission; the client then runs it
 * locally. Prerequisites are enforced server-side (a start returns a conflict
 * until they are met), so the list does not need its own unlock system.
 */
export default function ChallengeList({
  trackId,
  trackVersion,
  challenges,
}: ChallengeListProps) {
  const navigate = useNavigate();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (challenges.length === 0) {
    return null;
  }

  const start = async (challenge: ChallengeSummaryDto) => {
    setStartingId(challenge.id);
    setError(null);
    try {
      const mission = await startChallenge({
        certificationId: trackId,
        challengeId: challenge.id,
        discovery: loadTrackDiscovery(trackVersion),
      });
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start this challenge.",
      );
      setStartingId(null);
    }
  };

  return (
    <section className="hub-challenges" aria-label="Challenges">
      <div className="hub-practice-head">
        <h3>
          <span aria-hidden="true">🧩</span> Challenges
        </h3>
        <p className="muted">
          A guided sequence of activities that builds one larger reasoning
          journey. Progress is saved as you go, so you can resume any time.
        </p>
      </div>
      <ul className="hub-challenge-list">
        {challenges.map((challenge) => (
          <li key={challenge.id}>
            <div>
              <p className="hub-challenge-title">
                <InlineText text={challenge.title} />
              </p>
              {challenge.description ? (
                <p className="muted">
                  <InlineText text={challenge.description} />
                </p>
              ) : null}
              <p className="muted">
                {challenge.stage_count} stages · ~{challenge.estimated_minutes}{" "}
                min
              </p>
            </div>
            <button
              type="button"
              className="primary"
              disabled={startingId === challenge.id}
              onClick={() => void start(challenge)}
            >
              {startingId === challenge.id ? "Starting…" : "Start"}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
