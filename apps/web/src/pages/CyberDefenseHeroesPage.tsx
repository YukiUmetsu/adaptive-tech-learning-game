import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import HeroArt from "../game/components/art/HeroArt";
import { HERO_PROGRESSION } from "../game/data/heroProgression";
import { HEROES_BY_ID } from "../game/data/heroes";
import type { HeroTalentSelection } from "../game/models/hero";
import {
  refreshCyberProfile,
  setHeroTalents,
  useCyberProfile,
  useCyberProfileError,
  useCyberProfileLoading,
  type CyberHeroProgress,
} from "../game/state/cyberProfile";

/**
 * Persistent hero progression page (Stage2.md step 8.6).
 *
 * The two Stage 1 operators gain permanent levels and talent milestones between
 * missions. A milestone has exactly two mutually exclusive choices; selecting
 * one replaces the other, and respec is free.
 */

/** Milestone pips: one per talent milestone, filled when reached. */
function MilestonePips({
  milestones,
  level,
}: {
  milestones: number[];
  level: number;
}) {
  return (
    <span className="cyber-pips cyber-pips--milestones" aria-hidden="true">
      {milestones.map((milestone) => (
        <span
          key={milestone}
          className={`cyber-pip${level >= milestone ? " is-filled" : ""}`}
          title={`Level ${milestone}`}
        />
      ))}
    </span>
  );
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Safely reads the server's `selected_talents` (typed as `unknown`) as a map. */
function talentsOf(
  progress: CyberHeroProgress | undefined,
): HeroTalentSelection {
  const raw = progress?.selected_talents;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const selection: HeroTalentSelection = {};
  for (const [level, choice] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof choice === "string") {
      selection[level] = choice;
    }
  }
  return selection;
}

export default function CyberDefenseHeroesPage() {
  const profile = useCyberProfile();
  const loading = useCyberProfileLoading();
  const error = useCyberProfileError();
  const [busyHeroId, setBusyHeroId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    void refreshCyberProfile();
  }, []);

  const chooseTalent = async (
    heroId: string,
    milestoneLevel: number,
    choiceId: string,
    current: HeroTalentSelection,
  ) => {
    const selection: HeroTalentSelection = {
      ...current,
      [String(milestoneLevel)]: choiceId,
    };
    setBusyHeroId(heroId);
    try {
      const result = await setHeroTalents(heroId, selection);
      setMessages((existing) => {
        const next = { ...existing };
        if (result.ok) {
          delete next[heroId];
        } else {
          next[heroId] = result.message;
        }
        return next;
      });
    } finally {
      // Always release the choices, even if the request rejects unexpectedly.
      setBusyHeroId(null);
    }
  };

  if (!profile) {
    return (
      <section className="cyber-heroes-page" aria-busy={loading}>
        <Link className="cyber-secondary-button cyber-back" to="/game">
          ← Back to dashboard
        </Link>
        <p className="home-eyebrow">Cyber Defense HQ</p>
        <h1>Operators</h1>
        {error ? (
          <p className="muted" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Loading your operators…</p>
        )}
      </section>
    );
  }

  return (
    <section className="cyber-heroes-page" aria-labelledby="cyber-heroes-title">
      <Link className="cyber-secondary-button cyber-back" to="/game">
        ← Back to dashboard
      </Link>
      <p className="home-eyebrow">Cyber Defense HQ</p>
      <h1 id="cyber-heroes-title">Operators</h1>
      <p className="cyber-home-lede">
        Your operators grow between missions. Choose one talent at each unlocked
        milestone; respec any time.
      </p>

      <ul className="cyber-hero-progress-list">
        {HERO_PROGRESSION.map((definition) => {
          const hero = HEROES_BY_ID[definition.heroId];
          const progress = profile.heroes.find(
            (entry) => entry.hero_id === definition.heroId,
          );
          const level = progress?.level ?? 1;
          const maxLevel = progress?.max_level ?? definition.maxLevel;
          const xp = progress?.xp ?? 0;
          const xpIntoLevel = progress?.xp_into_level ?? 0;
          const xpForNext = progress?.xp_for_next_level ?? null;
          const selection = talentsOf(progress);
          const maxed =
            progress !== undefined && (level >= maxLevel || xpForNext === null);
          const hasSpan = xpForNext !== null && xpForNext > 0;
          const percent = maxed
            ? 100
            : hasSpan
              ? clampPercent((xpIntoLevel / xpForNext) * 100)
              : 0;
          const barMax = maxed ? xp : hasSpan ? xpForNext : 1;
          const barNow = maxed ? xp : xpIntoLevel;
          const nextMilestone = definition.milestones.find(
            (milestone) => milestone.level > level,
          );
          const chosenEntries = definition.milestones
            .map((milestone) => {
              const choiceId = selection[String(milestone.level)];
              const choice = milestone.choices.find(
                (entry) => entry.id === choiceId,
              );
              return choice ? { level: milestone.level, name: choice.name } : null;
            })
            .filter(
              (entry): entry is { level: number; name: string } =>
                entry !== null,
            );
          const busy = busyHeroId === definition.heroId;
          const message = messages[definition.heroId];

          return (
            <li
              key={definition.heroId}
              className={`cyber-hero-progress${maxed ? " is-maxed" : ""}`}
            >
              <div className="cyber-hero-progress-head">
                <span className="cyber-hero-card-art" aria-hidden="true">
                  <HeroArt
                    heroId={definition.heroId}
                    active
                    size={56}
                    x={0}
                    y={0}
                  />
                </span>
                <div className="cyber-hero-progress-id">
                  <h2>{hero?.name ?? definition.heroId}</h2>
                  <p className="cyber-hero-progress-level">
                    Level {level}{" "}
                    <span className="muted">of {maxLevel}</span>
                  </p>
                  <MilestonePips
                    milestones={definition.milestones.map(
                      (milestone) => milestone.level,
                    )}
                    level={level}
                  />
                </div>
              </div>

              <div
                className="cyber-xp-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={barMax}
                aria-valuenow={barNow}
                aria-label={`${
                  hero?.name ?? definition.heroId
                } experience: ${xp} XP, level ${level} of ${maxLevel}`}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="cyber-xp-label muted">
                {maxed
                  ? "Max level"
                  : hasSpan
                    ? `${xpIntoLevel} / ${xpForNext} XP this level`
                    : "Awaiting first mission"}{" "}
                · {xp} XP total
              </p>

              <p className="cyber-hero-progress-milestone muted">
                {nextMilestone
                  ? `Next milestone: level ${nextMilestone.level}`
                  : "All milestones reached."}
              </p>

              <div className="cyber-hero-progress-talents">
                <h3>Talents</h3>
                {chosenEntries.length > 0 ? (
                  <ul>
                    {chosenEntries.map((entry) => (
                      <li key={entry.level}>
                        Level {entry.level}: {entry.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No talents chosen yet.</p>
                )}
              </div>

              <div className="cyber-hero-progress-milestones">
                {definition.milestones.map((milestone) => {
                  const unlocked = level >= milestone.level;
                  const chosen = selection[String(milestone.level)];
                  return (
                    <fieldset
                      key={milestone.level}
                      className="cyber-milestone"
                      disabled={!unlocked}
                    >
                      <legend>
                        Level {milestone.level} milestone
                        {unlocked ? "" : " (locked)"}
                      </legend>
                      {!unlocked ? (
                        <p className="cyber-milestone-locked muted">
                          Reach level {milestone.level} to unlock.
                        </p>
                      ) : null}
                      <div className="cyber-milestone-choices">
                        {milestone.choices.map((choice) => {
                          const selected = chosen === choice.id;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              className={`cyber-milestone-choice${
                                selected ? " is-selected" : ""
                              }`}
                              aria-pressed={selected}
                              aria-label={`${choice.name}: ${
                                choice.description
                              }${unlocked ? "" : " (locked)"}`}
                              disabled={!unlocked || busy}
                              onClick={() =>
                                void chooseTalent(
                                  definition.heroId,
                                  milestone.level,
                                  choice.id,
                                  selection,
                                )
                              }
                            >
                              <span className="cyber-milestone-choice-name">
                                {choice.name}
                              </span>
                              <span className="cyber-milestone-choice-desc muted">
                                {choice.description}
                              </span>
                              {selected ? (
                                <span className="cyber-milestone-selected">
                                  Selected
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>

              {message ? (
                <p className="cyber-hero-progress-error" role="alert">
                  {message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
