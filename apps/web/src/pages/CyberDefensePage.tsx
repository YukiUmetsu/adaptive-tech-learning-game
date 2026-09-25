import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/context";
import CoreArt from "../game/components/art/CoreArt";
import EnemyArt from "../game/components/art/EnemyArt";
import HeroArt from "../game/components/art/HeroArt";
import TowerArt from "../game/components/art/TowerArt";
import {
  BoltIcon,
  PlayIcon,
  ShieldIcon,
  SkullIcon,
  TargetIcon,
} from "../game/components/art/Icons";
import { GAME_CATALOG } from "../game/data";
import type { AttackType } from "../game/models/attack";
import type { MissionDefinition } from "../game/models/mission";
import {
  isMissionUnlocked,
  useGameProgress,
} from "../game/persistence/gameProgress";

/** Distinct attack types a mission sends, in the order they first appear. */
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

/** A mission is a boss mission when any of its waves is flagged as one. */
function isBossMission(mission: MissionDefinition): boolean {
  return mission.waves.some((wave) => wave.boss === true);
}

/** Tiny enemy silhouette used as a threat chip on a mission card. */
function ThreatGlyph({ attackType }: { attackType: AttackType }) {
  return (
    <svg
      className={`cyber-threat-glyph cyber-threat-glyph--${attackType}`}
      viewBox="-16 -16 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <EnemyArt attackType={attackType} />
    </svg>
  );
}

/** Positions of the towers guarding the core in the decorative diorama. */
const DIORAMA_TOWERS: Array<{ id: string; x: number; y: number }> = [
  { id: "waf", x: 214, y: 56 },
  { id: "traffic_blocker", x: 214, y: 184 },
  { id: "mfa", x: 258, y: 120 },
];

const DIORAMA_ENEMIES: Array<{ type: AttackType; x: number }> = [
  { type: "ddos", x: 48 },
  { type: "sql_injection", x: 98 },
  { type: "xss", x: 150 },
];

/**
 * Decorative, animated "battle at a glance" scene.
 *
 * Reuses the in-game vector art so the landing page and the board look like the
 * same product. Purely presentational: hidden from assistive tech, and every
 * animation collapses under `prefers-reduced-motion`.
 */
function DefenseDiorama() {
  return (
    <svg className="cyber-diorama" viewBox="0 0 340 240" focusable="false">
      <path className="cyber-diorama-lane" d="M0,120 H266" />
      <path className="cyber-diorama-flow" d="M0,120 H266" />

      {DIORAMA_ENEMIES.map((enemy, index) => (
        <g key={enemy.type} transform={`translate(${enemy.x} 120)`}>
          <g
            className="cyber-diorama-enemy"
            style={{ animationDelay: `${index * 0.45}s` }}
          >
            <EnemyArt attackType={enemy.type} />
          </g>
        </g>
      ))}

      {DIORAMA_TOWERS.map((tower, index) => {
        const defense = GAME_CATALOG.defensesById[tower.id];
        if (!defense) {
          return null;
        }
        return (
          <g key={tower.id} transform={`translate(${tower.x} ${tower.y})`}>
            <g
              className="cyber-diorama-tower"
              style={{ animationDelay: `${index * 0.3}s` }}
            >
              <TowerArt defense={defense} level={1} angle={Math.PI} />
            </g>
          </g>
        );
      })}

      <g transform="translate(300 120)">
        <g className="cyber-diorama-core">
          <CoreArt integrity={1} />
        </g>
      </g>
    </svg>
  );
}

/**
 * Cyber Defense home and mission select (spec sections 38.1 and 38.2).
 *
 * The page itself is public so signed-out visitors can see what the game is.
 * Playing a mission requires an account: the mission route is guarded, and the
 * primary action sends a signed-out visitor to sign in instead of straight into
 * a mission.
 */
export default function CyberDefensePage() {
  const { status } = useAuth();
  const progress = useGameProgress();
  const missions = GAME_CATALOG.missions;
  const totalMissions = missions.length;
  const requiresSignIn = status === "anonymous";

  const cleared = missions.filter(
    (mission) => progress.missions[mission.id]?.completed === true,
  ).length;
  const totalStars = missions.reduce(
    (sum, mission) => sum + (progress.missions[mission.id]?.stars ?? 0),
    0,
  );
  const maxStars = totalMissions * 3;
  const campaignPercent =
    totalMissions > 0 ? Math.round((cleared / totalMissions) * 100) : 0;

  const nextMission =
    missions.find(
      (mission) =>
        isMissionUnlocked(mission, progress) &&
        progress.missions[mission.id]?.completed !== true,
    ) ?? missions[0];
  const allCleared = cleared === totalMissions && totalMissions > 0;

  const threatTypeCount = new Set(
    GAME_CATALOG.attacks.map((attack) => attack.attackType),
  ).size;

  return (
    <section className="cyber-home" aria-labelledby="cyber-home-title">
      <header className="cyber-home-hero">
        <div className="cyber-home-hero-copy">
          <p className="home-eyebrow">Cyber Defense</p>
          <h1 id="cyber-home-title">Protect systems from real cyber attacks.</h1>
          <p className="cyber-home-lede">
            Place real security controls on an application architecture, then
            hold the line against DDoS, SQL injection, credential stuffing, and
            more. Understand the trade-offs between protection, cost, and
            latency.
          </p>
          {nextMission ? (
            <div className="cyber-home-actions">
              <Link
                className="cyber-cta"
                to={
                  requiresSignIn
                    ? `/login?returnTo=${encodeURIComponent(
                        `/game/missions/${nextMission.id}`,
                      )}`
                    : `/game/missions/${nextMission.id}`
                }
              >
                <PlayIcon size={16} />
                {requiresSignIn
                  ? "Sign in to play"
                  : allCleared
                    ? "Replay a mission"
                    : cleared > 0
                      ? "Continue mission"
                      : "Start first mission"}
              </Link>
              {requiresSignIn ? (
                <span className="cyber-home-cta-note muted">
                  An account is required to play missions.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="cyber-home-hero-art" aria-hidden="true">
          <DefenseDiorama />
        </div>
      </header>

      <ul className="cyber-stat-strip">
        <li>
          <ShieldIcon size={16} className="cyber-stat-icon" />
          <span className="cyber-stat-value">
            {cleared}
            <span className="cyber-stat-total">/{totalMissions}</span>
          </span>
          <span className="cyber-stat-label">Systems secured</span>
        </li>
        <li>
          <span className="cyber-stat-icon cyber-stat-icon--star" aria-hidden="true">
            ★
          </span>
          <span className="cyber-stat-value">
            {totalStars}
            <span className="cyber-stat-total">/{maxStars}</span>
          </span>
          <span className="cyber-stat-label">Stars earned</span>
        </li>
        <li>
          <TargetIcon size={16} className="cyber-stat-icon" />
          <span className="cyber-stat-value">{campaignPercent}%</span>
          <span className="cyber-stat-label">Campaign cleared</span>
        </li>
        <li>
          <BoltIcon size={16} className="cyber-stat-icon" />
          <span className="cyber-stat-value">{threatTypeCount}</span>
          <span className="cyber-stat-label">Threat types</span>
        </li>
      </ul>

      <div className="cyber-mission-head">
        <h2>Missions</h2>
        <span className="cyber-mission-progress muted">
          {cleared} of {totalMissions} cleared
        </span>
      </div>

      <ul className="cyber-mission-list">
        {missions.map((mission, index) => {
          const entry = progress.missions[mission.id];
          const unlocked = isMissionUnlocked(mission, progress);
          const stars = entry?.stars ?? 0;
          const completed = entry?.completed ?? false;
          const boss = isBossMission(mission);
          const threatTypes = missionThreatTypes(mission);
          const requiredTitle =
            GAME_CATALOG.missionsById[mission.requiresMissionId ?? ""]?.title ??
            "the previous mission";

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
                    <span className="cyber-mission-title">{mission.title}</span>
                    {boss ? (
                      <span className="cyber-mission-tag">Boss</span>
                    ) : null}
                    {completed ? (
                      <span className="cyber-mission-tag is-cleared">
                        Cleared
                      </span>
                    ) : null}
                  </span>
                  <span className="cyber-mission-desc">
                    {mission.description}
                  </span>
                  <span className="cyber-mission-threats">
                    <span className="cyber-mission-threat-icons" aria-hidden="true">
                      {threatTypes.map((attackType) => (
                        <ThreatGlyph key={attackType} attackType={attackType} />
                      ))}
                    </span>
                    <span className="cyber-mission-threat-names muted">
                      {mission.threatSummary.join(" · ")}
                    </span>
                  </span>
                  {unlocked ? (
                    <span className="cyber-mission-meta muted">
                      Budget {mission.startingBudget.toLocaleString()} · Latency
                      target {mission.latencyTargetMs} ms · {mission.waves.length}{" "}
                      waves
                    </span>
                  ) : (
                    <span className="cyber-mission-locked">
                      🔒 Complete {requiredTitle} to unlock
                    </span>
                  )}
                </span>
                <span className="cyber-mission-side">
                  <span
                    className="cyber-mission-stars"
                    aria-label={stars > 0 ? `${stars} of 3 stars` : "Not completed"}
                  >
                    {stars > 0 ? "★".repeat(stars) : "—"}
                  </span>
                  <span className="cyber-mission-open" aria-hidden="true">
                    {unlocked
                      ? requiresSignIn
                        ? "Sign in ▸"
                        : "Deploy ▸"
                      : "Locked"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <section className="cyber-roster" aria-labelledby="cyber-roster-title">
        <h2 id="cyber-roster-title">Your operators</h2>
        <ul className="cyber-hero-cards">
          {GAME_CATALOG.heroes.map((hero) => (
            <li key={hero.id} className="cyber-hero-card">
              <span className="cyber-hero-card-art" aria-hidden="true">
                <HeroArt heroId={hero.id} active size={56} x={0} y={0} />
              </span>
              <span className="cyber-hero-card-body">
                <span className="cyber-hero-card-name">{hero.name}</span>
                <span className="cyber-hero-card-ability">
                  {hero.abilityName}
                </span>
                <span className="cyber-hero-card-desc">{hero.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="cyber-roster" aria-labelledby="cyber-arsenal-title">
        <h2 id="cyber-arsenal-title">Controls at your command</h2>
        <ul className="cyber-arsenal">
          {GAME_CATALOG.defenses.map((defense) => (
            <li
              key={defense.id}
              className="cyber-arsenal-item"
              style={{ "--tower-color": defense.color } as CSSProperties}
            >
              <span className="cyber-arsenal-thumb" aria-hidden="true">
                <svg viewBox="-24 -24 48 48">
                  <TowerArt defense={defense} level={1} />
                </svg>
              </span>
              <span className="cyber-arsenal-name">{defense.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
