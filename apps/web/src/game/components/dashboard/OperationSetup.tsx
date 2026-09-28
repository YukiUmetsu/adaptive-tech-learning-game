import { useEffect, useMemo, useState } from "react";

import { GAME_CATALOG } from "../../data";
import { ATTACK_TYPE_LABELS, type AttackType } from "../../models/attack";
import { clampThreatLevel } from "../../models/operation";
import { readLastHeroId, writeLastHeroId } from "../../persistence/heroSelection";
import {
  getOperationOffers,
  type CyberOperationOffer,
  type CyberProfile,
} from "../../state/cyberProfile";
import { PlayIcon } from "../art/Icons";

/**
 * Compact pre-Operation chooser.
 *
 * The server issues up to three eligible Operation offers; the player picks
 * one, an operator, and a Threat Level. Selection is server-validated, so a
 * client can never start a locked template. When the offers endpoint is
 * unreachable the chooser falls back to a single server-selected Operation, so
 * the game stays playable offline.
 */
export interface OperationStartChoice {
  heroId: string;
  threatLevel: number;
  /** Opaque server-issued offer id, when the player chose an offer. */
  offerId?: string;
  /** Explicit template id, used only for the story confrontation. */
  templateId?: string;
}

export interface OperationSetupProps {
  profile: CyberProfile;
  /** `confrontation` makes the story climax the primary, default choice. */
  mode?: "operation" | "confrontation";
  starting: boolean;
  onStart: (choice: OperationStartChoice) => void;
}

/** A short, non-spoiler role line for each operator. */
const HERO_ROLES: Record<string, string> = {
  security_engineer: "Hardens active controls",
  sre: "Absorbs incoming damage",
};

/** Human label for an attack type id, tolerant of unknown values. */
function threatLabel(attackType: string): string {
  return ATTACK_TYPE_LABELS[attackType as AttackType] ?? attackType;
}

/** `~7 min` style estimate. */
function minutesLabel(minutes: number): string {
  return `~${minutes} min`;
}

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

  const confrontation = mode === "confrontation";
  const [offers, setOffers] = useState<CyberOperationOffer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [selectConfrontation, setSelectConfrontation] = useState(confrontation);

  // Offers are stable server-side; only the Threat Level changes the reward
  // previews, so refetch only when difficulty changes.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getOperationOffers(threatLevel);
      if (!active || !result.ok) {
        return;
      }
      setOffers(result.data.offers);
      setSelectedOfferId(
        (current) => current ?? result.data.offers[0]?.offer_id ?? null,
      );
    })();
    return () => {
      active = false;
    };
  }, [threatLevel]);

  const selectedOffer = useMemo(
    () =>
      offers.find((offer) => offer.offer_id === selectedOfferId) ?? offers[0],
    [offers, selectedOfferId],
  );

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
    if (selectConfrontation) {
      onStart({ heroId, threatLevel, templateId: CONFRONTATION_TEMPLATE });
      return;
    }
    if (selectedOffer) {
      onStart({ heroId, threatLevel, offerId: selectedOffer.offer_id });
      return;
    }
    // Offline fallback: the server still picks an eligible Operation.
    onStart({ heroId, threatLevel, templateId: undefined });
  };

  return (
    <div className="cyber-op-setup">
      <p className="cyber-hub-kicker">
        {selectConfrontation ? "Stage 2 Climax" : "Choose Operation"}
      </p>
      <h2 className="cyber-op-setup-title">
        {selectConfrontation ? "The Confrontation" : "Continue Defense"}
      </h2>

      <div
        className="cyber-op-setup-offers"
        role="radiogroup"
        aria-label="Operation offers"
      >
        {confrontation ? (
          <button
            type="button"
            role="radio"
            aria-checked={selectConfrontation}
            className={`cyber-op-offer is-story${selectConfrontation ? " is-selected" : ""}`}
            onClick={() => setSelectConfrontation(true)}
          >
            <span className="cyber-op-offer-title">The Confrontation</span>
            <span className="cyber-op-offer-meta">
              GHOST-7 · Campaign climax
            </span>
          </button>
        ) : null}

        {offers.map((offer) => {
          const selected = !selectConfrontation && offer.offer_id === selectedOfferId;
          return (
            <button
              key={offer.offer_id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`cyber-op-offer${selected ? " is-selected" : ""}`}
              onClick={() => {
                setSelectConfrontation(false);
                setSelectedOfferId(offer.offer_id);
              }}
            >
              <span className="cyber-op-offer-title">{offer.title}</span>
              <span className="cyber-op-offer-meta">
                {offer.adversary_name} · {offer.summary} ·{" "}
                {minutesLabel(offer.estimated_minutes)}
              </span>
              {offer.threat_summary.length > 0 ? (
                <span className="cyber-op-offer-threats">
                  {offer.threat_summary.map(threatLabel).join(", ")}
                </span>
              ) : null}
              <span className="cyber-op-offer-reward">
                {offer.reward_preview.bits} Bits ·{" "}
                {offer.reward_preview.career_xp} XP
              </span>
            </button>
          );
        })}

        {!confrontation && offers.length === 0 ? (
          <button
            type="button"
            role="radio"
            aria-checked={!selectConfrontation}
            className={`cyber-op-offer${!selectConfrontation ? " is-selected" : ""}`}
            onClick={() => setSelectConfrontation(false)}
          >
            <span className="cyber-op-offer-title">Continue Defense</span>
            <span className="cyber-op-offer-meta">
              The server selects an eligible Operation.
            </span>
          </button>
        ) : null}
      </div>

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

      <button
        type="button"
        className="cyber-cta"
        onClick={start}
        disabled={starting}
      >
        <PlayIcon size={16} />{" "}
        {starting
          ? "Preparing…"
          : selectConfrontation
            ? "Begin Confrontation"
            : selectedOffer
              ? "Deploy"
              : "Continue Defense"}
      </button>
    </div>
  );
}
