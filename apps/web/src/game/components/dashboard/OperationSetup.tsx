import { useState } from "react";

import { GAME_CATALOG } from "../../data";
import type { CyberProfile } from "../../state/cyberProfile";
import { clampThreatLevel } from "../../models/operation";
import { readLastHeroId, writeLastHeroId } from "../../persistence/heroSelection";
import { PlayIcon } from "../art/Icons";

/**
 * Compact pre-Operation chooser.
 *
 * ADHD-friendly by design: one operator row, one difficulty row, one button —
 * no multi-step setup screen. Only server-unlocked Threat Levels are offered,
 * and the last operator is remembered locally for convenience (the server still
 * validates the id).
 */
export interface OperationSetupProps {
  profile: CyberProfile;
  /** `confrontation` starts the story-gated climax template instead of a random run. */
  mode?: "operation" | "confrontation";
  starting: boolean;
  onStart: (choice: {
    heroId: string;
    threatLevel: number;
    templateId?: string;
  }) => void;
}

/** A short, non-spoiler role line for each operator. */
const HERO_ROLES: Record<string, string> = {
  security_engineer: "Hardens active controls",
  sre: "Absorbs incoming damage",
};

export const CONFRONTATION_TEMPLATE = "ghost7-confrontation";

export default function OperationSetup({
  profile,
  mode = "operation",
  starting,
  onStart,
}: OperationSetupProps) {
  const heroIds = GAME_CATALOG.heroes.map((hero) => hero.id);
  const [heroId, setHeroId] = useState<string>(
    () => readLastHeroId(heroIds) ?? heroIds[0] ?? "security_engineer",
  );

  const recommended = clampThreatLevel(profile.recommended_threat_level ?? 1);
  const unlocked = clampThreatLevel(profile.unlocked_threat_level ?? 3);
  const [threatLevel, setThreatLevel] = useState<number>(recommended);

  // Nearby choices first; only levels the server actually allows.
  const nearby = [recommended - 1, recommended, recommended + 1].filter(
    (level) => level >= 1 && level <= unlocked,
  );
  const allLevels = Array.from({ length: unlocked }, (_, index) => index + 1);

  const selectHero = (id: string) => {
    setHeroId(id);
    writeLastHeroId(id);
  };

  const start = () => {
    writeLastHeroId(heroId);
    onStart({
      heroId,
      threatLevel,
      templateId: mode === "confrontation" ? CONFRONTATION_TEMPLATE : undefined,
    });
  };

  const confrontation = mode === "confrontation";

  return (
    <div className="cyber-op-setup">
      <p className="cyber-hub-kicker">
        {confrontation ? "Stage 2 Climax" : "Recommended Operation"}
      </p>
      <h2 className="cyber-op-setup-title">
        {confrontation ? "The Confrontation" : "Continue Defense"}
      </h2>

      <div className="cyber-op-setup-row">
        <span className="cyber-op-setup-label" id="cyber-operator-label">
          Operator
        </span>
        <div
          className="cyber-op-setup-chips"
          role="radiogroup"
          aria-labelledby="cyber-operator-label"
        >
          {GAME_CATALOG.heroes.map((hero) => {
            const level =
              profile.heroes.find((entry) => entry.hero_id === hero.id)?.level ?? 1;
            const selected = hero.id === heroId;
            return (
              <button
                key={hero.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`cyber-chip${selected ? " is-selected" : ""}`}
                onClick={() => selectHero(hero.id)}
              >
                <span className="cyber-chip-name">
                  {hero.name} <span className="muted">Lv {level}</span>
                </span>
                <span className="cyber-chip-desc">
                  {HERO_ROLES[hero.id] ?? hero.abilityName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!confrontation ? (
        <div className="cyber-op-setup-row">
          <span className="cyber-op-setup-label" id="cyber-threat-label">
            Threat Level
          </span>
          <div
            className="cyber-op-setup-chips"
            role="radiogroup"
            aria-labelledby="cyber-threat-label"
          >
            {nearby.map((level) => {
              const selected = level === threatLevel;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`cyber-chip cyber-chip--threat${selected ? " is-selected" : ""}`}
                  onClick={() => setThreatLevel(level)}
                >
                  <span className="cyber-chip-name">
                    {level}
                    {level === recommended ? (
                      <span className="muted"> Recommended</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {allLevels.length > nearby.length ? (
              <label className="cyber-op-setup-advanced">
                <span className="muted">Advanced</span>
                <select
                  aria-label="Change difficulty"
                  value={threatLevel}
                  onChange={(event) => setThreatLevel(Number(event.target.value))}
                >
                  {allLevels.map((level) => (
                    <option key={level} value={level}>
                      Threat {level}
                      {level === recommended ? " (Recommended)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="cyber-cta"
        onClick={start}
        disabled={starting}
      >
        <PlayIcon size={16} />{" "}
        {starting
          ? "Preparing…"
          : confrontation
            ? "Begin Confrontation"
            : "Continue Defense"}
      </button>
    </div>
  );
}
