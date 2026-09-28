import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import { CoinIcon } from "../game/components/art/Icons";
import TowerArt from "../game/components/art/TowerArt";
import { GAME_CATALOG } from "../game/data";
import {
  TOWER_UPGRADES,
  TOWER_UPGRADES_BY_ID,
} from "../game/data/towerUpgrades";
import {
  nextTowerBenefit,
  nextTowerCost,
  towerLevel,
  towerPrerequisitesMet,
  type TowerRoomId,
  type TowerUpgradeDefinition,
} from "../game/models/tower";
import {
  purchaseTowerUpgrade,
  refreshCyberProfile,
  useCyberProfile,
  useCyberProfileError,
  useCyberProfileLoading,
  type CyberProfile,
} from "../game/state/cyberProfile";
import { prefersReducedMotionPreference } from "../state/preferences";
import { playUpgrade } from "../state/sound";
import { newId } from "../lib/id";
import { trackCyberEvent } from "../game/state/cyberTelemetry";

/** Spark directions for the upgrade burst, in degrees. */
const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Persistent Tower / Cyber Defense HQ (Stage2.md step 7.6).
 *
 * The primary long-term Bits sink: one card per room with in-game art, level
 * pips, the next benefit, cost, and prerequisites. The server settles every
 * purchase; this page only previews affordability.
 */

/** Representative turret art for each HQ room. */
const ROOM_ART: Record<TowerRoomId, string> = {
  soc: "monitoring",
  threat_intelligence: "traffic_analyzer",
  training_center: "mfa",
  engineering_lab: "parameterized_queries",
  resilience_center: "backup",
};

/** Current room levels keyed by upgrade id. */
function roomLevels(profile: CyberProfile): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const room of profile.tower_upgrades) {
    levels[room.upgrade_id] = room.level;
  }
  return levels;
}

/** Human-readable prerequisite list, for example "Threat Intelligence Lv 2". */
function prerequisiteLabel(definition: TowerUpgradeDefinition): string {
  return (definition.prerequisites ?? [])
    .map((requirement) => {
      const room = TOWER_UPGRADES_BY_ID[requirement.upgradeId];
      return `${room?.name ?? requirement.upgradeId} Lv ${requirement.level}`;
    })
    .join(", ");
}

/** Filled level pips for a room, with the newest level popping in. */
function LevelPips({
  level,
  max,
  highlightLevel,
}: {
  level: number;
  max: number;
  highlightLevel?: number;
}) {
  return (
    <span className="cyber-pips" aria-hidden="true">
      {Array.from({ length: max }, (_, index) => {
        const pipLevel = index + 1;
        return (
          <span
            key={index}
            className={`cyber-pip${index < level ? " is-filled" : ""}${
              highlightLevel === pipLevel ? " is-new" : ""
            }`}
          />
        );
      })}
    </span>
  );
}

export default function CyberDefenseTowerPage() {
  const profile = useCyberProfile();
  const loading = useCyberProfileLoading();
  const error = useCyberProfileError();
  const reducedMotion = prefersReducedMotionPreference();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  // Nonce lets the same room re-run the celebration on a repeat upgrade.
  const [celebration, setCelebration] = useState<{
    id: string;
    level: number;
    spent: number;
    nonce: number;
  } | null>(null);
  const celebrationTimer = useRef<number | null>(null);

  useEffect(() => {
    void refreshCyberProfile();
  }, []);

  useEffect(
    () => () => {
      if (celebrationTimer.current !== null) {
        window.clearTimeout(celebrationTimer.current);
      }
    },
    [],
  );

  const handleUpgrade = async (definition: TowerUpgradeDefinition) => {
    setBusyId(definition.id);
    try {
      const result = await purchaseTowerUpgrade(definition.id, newId());
      setMessages((current) => {
        const next = { ...current };
        if (result.ok) {
          delete next[definition.id];
        } else {
          next[definition.id] = result.message;
        }
        return next;
      });
      if (result.ok) {
        playUpgrade();
        trackCyberEvent("cyber_tower_upgrade_purchased", {
          defense_id: definition.id,
        });
        if (!reducedMotion) {
          setCelebration({
            id: definition.id,
            level: result.data.level,
            spent: result.data.spent,
            nonce: Date.now(),
          });
          if (celebrationTimer.current !== null) {
            window.clearTimeout(celebrationTimer.current);
          }
          celebrationTimer.current = window.setTimeout(
            () => setCelebration(null),
            1100,
          );
        }
      }
    } catch {
      // `purchaseTowerUpgrade` normally resolves online/offline as a result, but
      // a direct rejection must never escape and hang the button.
      setMessages((current) => ({
        ...current,
        [definition.id]: "Could not reach the server. Try again.",
      }));
    } finally {
      // Always release the button, even if the request rejects unexpectedly.
      setBusyId(null);
    }
  };

  if (!profile) {
    return (
      <section className="cyber-tower-page" aria-busy={loading}>
        <Link className="cyber-secondary-button cyber-back" to="/game">
          ← Back to dashboard
        </Link>
        <p className="home-eyebrow">Cyber Defense HQ</p>
        <h1>Tower</h1>
        {error ? (
          <p className="muted" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Loading your Tower…</p>
        )}
      </section>
    );
  }

  const levels = roomLevels(profile);
  const maxTowerLevel = towerLevel(
    TOWER_UPGRADES.map((definition) => definition.maxLevel),
  );

  return (
    <section className="cyber-tower-page" aria-labelledby="cyber-tower-title">
      <Link className="cyber-secondary-button cyber-back" to="/game">
        ← Back to dashboard
      </Link>
      <header className="cyber-page-head">
        <div>
          <p className="home-eyebrow">Cyber Defense HQ</p>
          <h1 id="cyber-tower-title">Tower</h1>
        </div>
        <ul className="cyber-page-chips">
          <li title="Aggregate Tower level">
            <span className="cyber-page-chip-icon" aria-hidden="true">
              {GAME_CATALOG.defensesById["waf"] ? (
                <svg viewBox="-26 -26 52 52" className="cyber-page-chip-art">
                  <TowerArt
                    defense={GAME_CATALOG.defensesById["waf"]}
                    level={1}
                    angle={-Math.PI / 2}
                  />
                </svg>
              ) : null}
            </span>
            <span className="cyber-page-chip-value">
              {profile.tower_level} of {maxTowerLevel}
            </span>
          </li>
          <li title="Available Bits">
            <CoinIcon size={16} className="cyber-page-chip-icon" />
            <span className="cyber-page-chip-value">
              {profile.bits_balance.toLocaleString()} Bits
            </span>
          </li>
        </ul>
      </header>

      <ul className="cyber-room-grid">
        {TOWER_UPGRADES.map((definition) => {
          const level = levels[definition.id] ?? 0;
          const maxed = level >= definition.maxLevel;
          const cost = nextTowerCost(definition, level);
          const benefit = nextTowerBenefit(definition, level);
          const prereqMet = towerPrerequisitesMet(definition, levels);
          const affordable = cost !== null && profile.bits_balance >= cost;
          const canUpgrade = !maxed && prereqMet && affordable;
          const busy = busyId === definition.id;
          const message = messages[definition.id];
          const blockedReason = maxed
            ? "Maximum level reached"
            : !prereqMet
              ? `Requires ${prerequisiteLabel(definition)}`
              : !affordable && cost !== null
                ? `${(cost - profile.bits_balance).toLocaleString()} more Bits needed`
                : null;
          const accessibleName = maxed
            ? `${definition.name} is fully upgraded`
            : `Upgrade ${definition.name} to level ${level + 1}${
                cost !== null ? ` for ${cost} Bits` : ""
              }`;
          const defense = GAME_CATALOG.defensesById[ROOM_ART[definition.id]];
          const celebrationEntry =
            celebration?.id === definition.id ? celebration : null;
          const celebrateLevel = celebrationEntry?.level;

          return (
            <li
              key={definition.id}
              className={`cyber-room-card${canUpgrade ? " is-affordable" : ""}${
                maxed ? " is-maxed" : ""
              }${celebrationEntry ? " is-celebrating" : ""}`}
            >
              {celebrationEntry ? (
                <span
                  key={celebrationEntry.nonce}
                  className="cyber-upgrade-flash"
                  aria-hidden="true"
                />
              ) : null}
              <div className="cyber-room-top">
                <span className="cyber-room-art" aria-hidden="true">
                  {defense ? (
                    <svg viewBox="-30 -30 60 60">
                      <TowerArt
                        defense={defense}
                        level={Math.max(1, level)}
                        angle={-Math.PI / 2}
                      />
                    </svg>
                  ) : null}
                  {celebrationEntry ? (
                    <span
                      key={celebrationEntry.nonce}
                      className="cyber-upgrade-fx"
                    >
                      <span className="cyber-upgrade-ring" />
                      {SPARK_ANGLES.map((angle) => (
                        <span
                          key={angle}
                          className="cyber-upgrade-spark"
                          style={{ "--angle": `${angle}deg` } as CSSProperties}
                        />
                      ))}
                      <span className="cyber-upgrade-plus">+1</span>
                      <span className="cyber-upgrade-cost">
                        <CoinIcon size={12} /> -{celebrationEntry.spent}
                      </span>
                    </span>
                  ) : null}
                </span>
                <div className="cyber-room-id">
                  <h2>{definition.name}</h2>
                  <p className="cyber-room-level">
                    Level {level} <span className="muted">of {definition.maxLevel}</span>
                  </p>
                  <LevelPips
                    level={level}
                    max={definition.maxLevel}
                    highlightLevel={celebrateLevel}
                  />
                </div>
                {canUpgrade ? (
                  <span className="cyber-room-ready">Ready to build</span>
                ) : null}
              </div>

              {maxed ? (
                <p className="cyber-room-maxed">All upgrades complete.</p>
              ) : (
                <div className="cyber-room-next">
                  {benefit ? (
                    <p className="cyber-room-benefit">
                      <strong>Next:</strong> {benefit.description}
                    </p>
                  ) : null}
                  {cost !== null ? (
                    <p className="cyber-room-cost">
                      <CoinIcon size={15} /> <span>{cost}</span>
                    </p>
                  ) : null}
                </div>
              )}

              {blockedReason ? (
                <p className="cyber-room-blocked">{blockedReason}</p>
              ) : null}

              {message ? (
                <p className="cyber-room-error" role="alert">
                  {message}
                </p>
              ) : null}

              <button
                type="button"
                className="cyber-room-upgrade"
                aria-label={accessibleName}
                disabled={!canUpgrade || busy}
                onClick={() => void handleUpgrade(definition)}
              >
                {maxed ? "Fully upgraded" : busy ? "Upgrading…" : "Upgrade"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
