import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { GAME_CATALOG } from "../../data";
import { ADVERSARIES_BY_ID } from "../../data/adversaries";
import { HERO_PROGRESSION } from "../../data/heroProgression";
import { STORY_NODES } from "../../data/story";
import type { AttackType } from "../../models/attack";
import type { MissionDefinition } from "../../models/mission";
import { unacknowledgedStoryNodes } from "../../persistence/storyAck";
import { useGameProgress } from "../../persistence/gameProgress";
import {
  maybeImportLegacyProgress,
  refreshCyberProfile,
  startOperation,
  useCyberProfile,
} from "../../state/cyberProfile";
import { trackCyberEvent } from "../../state/cyberTelemetry";
import CoreArt from "../art/CoreArt";
import EnemyArt from "../art/EnemyArt";
import HeroArt from "../art/HeroArt";
import TowerArt from "../art/TowerArt";
import { CoinIcon, PlayIcon, ShieldIcon, TargetIcon } from "../art/Icons";
import { BoltIcon, SkullIcon } from "../art/Icons";
import HubScene from "./HubScene";

/** Distinct attack types a mission sends, in first-seen order. */
function missionThreatTypes(mission: MissionDefinition): AttackType[] {
  const seen: AttackType[] = [];
  for (const wave of mission.waves) {
    for (const group of wave.groups) {
      const attack = GAME_CATALOG.attacksById[group.attackId];
      if (attack && !seen.includes(attack.attackType)) {
        seen.push(attack.attackType);
      }
    }
  }
  return seen;
}

/** One upgrade/entry tile in the hub. Icon-forward, one short label. */
function HubModule({
  to,
  label,
  value,
  hint,
  art,
}: {
  to: string;
  label: string;
  value: string;
  hint: string;
  art: ReactNode;
}) {
  return (
    <Link
      className="cyber-module"
      to={to}
      title={hint}
      aria-label={`${label}, ${value}. ${hint}`}
    >
      <span className="cyber-module-art" aria-hidden="true">
        {art}
      </span>
      <span className="cyber-module-body">
        <span className="cyber-module-label">{label}</span>
        <span className="cyber-module-value">{value}</span>
      </span>
    </Link>
  );
}

/**
 * Stage 2 command-center hub.
 *
 * A game-first dashboard: resource chips, a single prominent mission card, an
 * icon-forward upgrade grid, and the campaign. Detail lives in tooltips so the
 * surface stays scannable (Stage2.md step 17).
 */
export default function CyberDashboard() {
  const navigate = useNavigate();
  const profile = useCyberProfile();
  const localProgress = useGameProgress();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    trackCyberEvent("cyber_dashboard_view");
    void (async () => {
      await refreshCyberProfile();
      await maybeImportLegacyProgress();
    })();
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    await refreshCyberProfile();
    setRetrying(false);
  }, []);

  const handleStart = useCallback(async () => {
    if (!profile) {
      return;
    }
    setStarting(true);
    setNotice(null);
    trackCyberEvent("cyber_threat_level_selected", {
      threat_level: profile.recommended_threat_level,
    });
    const result = await startOperation({
      requested_threat_level: profile.recommended_threat_level,
    });
    if (result.ok) {
      trackCyberEvent("cyber_operation_started", {
        run_id: result.data.run_id,
        template_id: result.data.template_id,
        adversary_id: result.data.adversary_id,
        threat_level: result.data.threat_level,
        hero_id: result.data.hero_id ?? undefined,
      });
      navigate(`/game/operations/${result.data.run_id}`);
    } else if (result.activeRunId) {
      navigate(`/game/operations/${result.activeRunId}`);
    } else {
      setNotice(result.message);
    }
    setStarting(false);
  }, [navigate, profile]);

  const completedCampaign = new Set(
    (profile?.campaign ?? [])
      .filter((row) => row.completed)
      .map((row) => row.mission_id),
  );
  const isMissionComplete = (missionId: string) =>
    completedCampaign.has(missionId) ||
    localProgress.missions[missionId]?.completed === true;
  const isMissionUnlocked = (mission: MissionDefinition) =>
    !mission.requiresMissionId || isMissionComplete(mission.requiresMissionId);

  const totalMissions = GAME_CATALOG.missions.length;
  const clearedCount = GAME_CATALOG.missions.filter((mission) =>
    isMissionComplete(mission.id),
  ).length;
  const campaignComplete = clearedCount >= totalMissions;

  const nextMission =
    GAME_CATALOG.missions.find(
      (mission) => isMissionUnlocked(mission) && !isMissionComplete(mission.id),
    ) ?? GAME_CATALOG.missions[0];

  const unseenStory = profile
    ? unacknowledgedStoryNodes(profile.story.completed_nodes)
    : [];
  const unseenStoryNode = STORY_NODES.find((node) => node.id === unseenStory[0]);

  const activeRunId = profile?.active_operation_run_id ?? null;
  const adversary = profile?.adversaries
    .slice()
    .sort((a, b) => b.rank - a.rank || b.progress - a.progress)[0];
  const adversaryDefinition = adversary
    ? ADVERSARIES_BY_ID[adversary.adversary_id]
    : undefined;

  const career = profile?.career;
  const xpPercent =
    career && career.xp_for_next_level && career.xp_for_next_level > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((career.xp_into_level / career.xp_for_next_level) * 100),
          ),
        )
      : 100;

  const heroPrompt = (() => {
    if (!profile) {
      return null;
    }
    for (const definition of HERO_PROGRESSION) {
      const progress = profile.heroes.find(
        (hero) => hero.hero_id === definition.heroId,
      );
      const level = progress?.level ?? 1;
      const next = definition.milestones.find(
        (milestone) => milestone.level > level,
      );
      if (next) {
        const name =
          GAME_CATALOG.heroesById[definition.heroId]?.name ?? definition.heroId;
        return { name, nextLevel: next.level };
      }
    }
    return null;
  })();

  // The primary action, chosen explicitly rather than with nested ternaries.
  let primaryAction: ReactNode;
  let primaryKicker = "Campaign";
  let primaryTitle = nextMission?.title ?? "Cyber Defense";
  let primaryMeta = `${clearedCount} of ${totalMissions} missions cleared`;
  let primaryThreats = nextMission ? missionThreatTypes(nextMission) : [];

  if (activeRunId) {
    primaryKicker = adversaryDefinition?.name ?? "Operation";
    primaryTitle = "Operation in progress";
    primaryMeta = "Resume where you left off";
    primaryAction = (
      <Link
        className="cyber-cta"
        to={`/game/operations/${activeRunId}`}
        onClick={() =>
          trackCyberEvent("cyber_operation_resumed", { run_id: activeRunId })
        }
      >
        <PlayIcon size={16} /> Resume Operation
      </Link>
    );
  } else if (!campaignComplete && nextMission) {
    primaryAction = (
      <Link className="cyber-cta" to={`/game/missions/${nextMission.id}`}>
        <PlayIcon size={16} /> Continue Campaign
      </Link>
    );
  } else if (unseenStoryNode) {
    primaryKicker = "Story";
    primaryTitle = unseenStoryNode.title;
    primaryMeta = "A new chapter is available";
    primaryThreats = [];
    primaryAction = (
      <Link className="cyber-cta" to="/game/story">
        <PlayIcon size={16} /> Continue Story
      </Link>
    );
  } else if (profile) {
    primaryKicker = "Recommended Operation";
    primaryTitle = "Continue Defense";
    primaryMeta = `Threat Level ${profile.recommended_threat_level} · ~8 min · ${totalMissions} missions cleared`;
    primaryThreats = [];
    primaryAction = (
      <button
        type="button"
        className="cyber-cta"
        onClick={() => void handleStart()}
        disabled={starting}
      >
        <PlayIcon size={16} /> {starting ? "Preparing…" : "Continue Defense"}
      </button>
    );
  } else {
    primaryKicker = "Welcome";
    primaryTitle = "Continue Defense";
    primaryMeta = "Sign in to save progress";
    primaryThreats = [];
    primaryAction = (
      <Link className="cyber-cta" to="/login">
        <PlayIcon size={16} /> Sign in to continue
      </Link>
    );
  }

  const towerArtDefense = GAME_CATALOG.defensesById["waf"];
  const intelArtDefense = GAME_CATALOG.defensesById["traffic_analyzer"];

  return (
    <section className="cyber-hub" aria-labelledby="cyber-hub-title">
      {/* Command-center hero */}
      <header className="cyber-hub-hero">
        <div className="cyber-hub-identity">
          <p className="cyber-hub-eyebrow">Cyber Defense</p>
          <h1 id="cyber-hub-title" className="cyber-hub-rank">
            {career?.rank ?? "Junior Security Analyst"}
          </h1>
          <p className="cyber-hub-level">
            Level {career?.level ?? 1}
            <span className="cyber-hub-xp-text">
              {career?.next_level_xp === null ||
              career?.next_level_xp === undefined
                ? "Max level"
                : `${career?.xp ?? 0} / ${career.next_level_xp} XP`}
            </span>
          </p>
          <div
            className="cyber-xp-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={xpPercent}
            aria-label={`${career?.rank ?? "Security Analyst"}, level ${
              career?.level ?? 1
            }, ${career?.xp ?? 0} XP`}
          >
            <span style={{ width: `${xpPercent}%` }} />
          </div>

          <ul className="cyber-hub-resources">
            <li title="Settled Bits">
              <CoinIcon size={16} className="cyber-hub-resource-icon" />
              <span className="cyber-hub-resource-value">
                {(profile?.bits_balance ?? 0).toLocaleString()}
              </span>
              <span className="cyber-hub-resource-label">Bits</span>
            </li>
            <li title="Aggregate Tower level">
              <ShieldIcon size={16} className="cyber-hub-resource-icon" />
              <span className="cyber-hub-resource-value">
                Lv {profile?.tower_level ?? 1}
              </span>
              <span className="cyber-hub-resource-label">Tower</span>
            </li>
            <li title="Current adversary">
              <TargetIcon size={16} className="cyber-hub-resource-icon" />
              <span className="cyber-hub-resource-value">
                {adversaryDefinition?.name ?? "—"}
              </span>
              <span className="cyber-hub-resource-label">
                Rank {adversary?.rank ?? 1}
              </span>
            </li>
            <li title="Completed Operations">
              <BoltIcon size={16} className="cyber-hub-resource-icon" />
              <span className="cyber-hub-resource-value">
                {profile?.total_operations_completed ?? 0}
              </span>
              <span className="cyber-hub-resource-label">Ops</span>
            </li>
          </ul>
        </div>

        <div className="cyber-hub-hero-art">
          <HubScene />
        </div>
      </header>

      {!profile ? (
        <div className="cyber-hub-panel" role="status">
          <p className="muted">
            Could not load your persistent progress. The campaign is still
            playable below.
          </p>
          <button
            type="button"
            className="cyber-secondary-button"
            onClick={() => void retry()}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}

      {/* Single primary mission card */}
      <section className="cyber-hub-primary" aria-labelledby="cyber-primary-title">
        <div className="cyber-hub-primary-art" aria-hidden="true">
          {primaryThreats.length > 0 ? (
            <svg viewBox="-24 -24 48 48">
              <EnemyArt attackType={primaryThreats[0]} />
            </svg>
          ) : (
            <svg viewBox="-40 -40 80 80">
              <CoreArt integrity={1} />
            </svg>
          )}
        </div>
        <div className="cyber-hub-primary-body">
          <p className="cyber-hub-kicker">{primaryKicker}</p>
          <h2 id="cyber-primary-title">{primaryTitle}</h2>
          <p className="cyber-hub-primary-meta">{primaryMeta}</p>
          <div className="cyber-hub-primary-actions">
            {primaryAction}
            {notice ? <span className="cyber-notice">{notice}</span> : null}
          </div>
        </div>
      </section>

      {/* Icon-forward upgrade grid */}
      <nav className="cyber-hub-modules" aria-label="Permanent upgrades">
        <HubModule
          to="/game/tower"
          label="Tower"
          value={`Lv ${profile?.tower_level ?? 1}`}
          hint="Spend Bits on permanent HQ rooms"
          art={
            towerArtDefense ? (
              <svg viewBox="-26 -26 52 52">
                <TowerArt defense={towerArtDefense} level={2} angle={-Math.PI / 2} />
              </svg>
            ) : null
          }
        />
        <HubModule
          to="/game/heroes"
          label="Heroes"
          value={heroPrompt ? `Next Lv ${heroPrompt.nextLevel}` : "Maxed"}
          hint={
            heroPrompt
              ? `${heroPrompt.name} reaches a talent at level ${heroPrompt.nextLevel}`
              : "Level your operators and choose talents"
          }
          art={<HeroArt heroId="security_engineer" size={52} />}
        />
        <HubModule
          to="/game/intel"
          label="Threat Intel"
          value={`${profile?.adversaries.length ?? 0} tracked`}
          hint="Unlock adversary dossier intel"
          art={
            intelArtDefense ? (
              <svg viewBox="-26 -26 52 52">
                <TowerArt defense={intelArtDefense} level={1} angle={-Math.PI / 2} />
              </svg>
            ) : null
          }
        />
        <HubModule
          to="/game/story"
          label="Story"
          value={unseenStory.length > 0 ? "New" : "Archive"}
          hint="Read the campaign story so far"
          art={
            <svg viewBox="-16 -16 32 32" className="cyber-module-glyph">
              <rect x={-9} y={-11} width={18} height={22} rx={2} fill="#12233f" stroke="#a78bfa" strokeWidth={2} />
              <path d="M-5,-6 H5 M-5,-1 H5 M-5,4 H3" stroke="#a78bfa" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          }
        />
        <a
          className="cyber-module"
          href="#campaign"
          title="Replay the five Stage 1 missions"
          aria-label={`Campaign, ${clearedCount} of ${totalMissions} cleared. Replay the five Stage 1 missions`}
        >
          <span className="cyber-module-art" aria-hidden="true">
            <svg viewBox="-40 -40 80 80">
              <CoreArt integrity={totalMissions ? clearedCount / totalMissions : 0} />
            </svg>
          </span>
          <span className="cyber-module-body">
            <span className="cyber-module-label">Campaign</span>
            <span className="cyber-module-value">
              {clearedCount}/{totalMissions}
            </span>
          </span>
        </a>
      </nav>

      {/* Campaign */}
      <section
        id="campaign"
        className="cyber-hub-campaign"
        aria-labelledby="cyber-campaign-title"
      >
        <div className="cyber-mission-head">
          <h2 id="cyber-campaign-title">Campaign — Chapter 1</h2>
          <span className="cyber-mission-progress muted">
            {clearedCount} of {totalMissions} cleared
          </span>
        </div>
        <ul className="cyber-mission-list">
          {GAME_CATALOG.missions.map((mission, index) => {
            const unlocked = isMissionUnlocked(mission);
            const result = profile?.campaign.find(
              (row) => row.mission_id === mission.id,
            );
            const stars = result?.best_stars ?? 0;
            const completed = isMissionComplete(mission.id);
            const boss = mission.waves.some((wave) => wave.boss === true);
            const threats = missionThreatTypes(mission);
            return (
              <li key={mission.id}>
                <Link
                  className={`cyber-mission-card${unlocked ? "" : " is-locked"}${
                    completed ? " is-cleared" : ""
                  }${boss ? " is-boss" : ""}`}
                  to={unlocked ? `/game/missions/${mission.id}` : "#"}
                  aria-disabled={!unlocked}
                  onClick={(event) => {
                    if (!unlocked) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span className="cyber-mission-index" aria-hidden="true">
                    {boss ? <SkullIcon size={18} /> : index + 1}
                  </span>
                  <span className="cyber-mission-body">
                    <span className="cyber-mission-top">
                      <span className="cyber-mission-title">
                        {mission.title}
                      </span>
                      {completed ? (
                        <span className="cyber-mission-tag is-cleared">
                          Cleared
                        </span>
                      ) : null}
                    </span>
                    <span className="cyber-mission-threat-icons" aria-hidden="true">
                      {threats.map((attackType) => (
                        <svg
                          key={attackType}
                          className="cyber-threat-glyph"
                          viewBox="-16 -16 32 32"
                        >
                          <EnemyArt attackType={attackType} />
                        </svg>
                      ))}
                    </span>
                  </span>
                  <span className="cyber-mission-side">
                    <span
                      className="cyber-mission-stars"
                      aria-label={
                        stars > 0 ? `${stars} of 3 stars` : "Not completed"
                      }
                    >
                      {stars > 0 ? "★".repeat(stars) : "—"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
