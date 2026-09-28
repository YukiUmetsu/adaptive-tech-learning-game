import { useEffect, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import InfoPopover from "../components/InfoPopover";
import AdversaryArt from "../game/components/art/AdversaryArt";
import { TargetIcon } from "../game/components/art/Icons";
import { ADVERSARIES, adversaryDossier } from "../game/data/adversaries";
import { OPERATION_MODIFIERS_BY_ID } from "../game/data/operationModifiers";
import { dossierPercent } from "../game/models/adversary";
import {
  refreshCyberProfile,
  useCyberProfile,
  useCyberProfileLoading,
} from "../game/state/cyberProfile";
import type { CyberProfile } from "../game/state/cyberProfile";

type AdversaryProgress = CyberProfile["adversaries"][number];

/** Server progress for one adversary, or `null` when never encountered. */
function progressFor(
  profile: CyberProfile | null,
  adversaryId: string,
): AdversaryProgress | null {
  return (
    profile?.adversaries.find((entry) => entry.adversary_id === adversaryId) ??
    null
  );
}

function BookGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 5 a2 2 0 0 1 2-2 h12 v18 H6 a2 2 0 0 1-2-2 Z" />
      <path d="M8 3 v18" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12 L10 18 L20 6" />
    </svg>
  );
}

function LockMark() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" />
    </svg>
  );
}

/**
 * Threat Intel / dossier page (Stage2.md step 15).
 *
 * Each recurring adversary is a named character with its own emblem, rank,
 * record, modifier pool, and a dossier that fills in over time. Locked dossier
 * entries render as a generic placeholder and never expose their hidden label
 * text in the DOM; the server owns which flags are unlocked.
 */
export default function CyberDefenseIntelPage() {
  const profile = useCyberProfile();
  const loading = useCyberProfileLoading();

  useEffect(() => {
    void refreshCyberProfile();
  }, []);

  const totalEntries = ADVERSARIES.reduce(
    (sum, adversary) => sum + adversaryDossier(adversary.id).length,
    0,
  );
  const knownEntries = ADVERSARIES.reduce((sum, adversary) => {
    const flags = progressFor(profile, adversary.id)?.dossier_flags ?? [];
    return (
      sum +
      adversaryDossier(adversary.id).filter((item) => flags.includes(item.id))
        .length
    );
  }, 0);

  return (
    <section className="cyber-intel" aria-labelledby="cyber-intel-title">
      <header className="cyber-page-head">
        <div>
          <p className="home-eyebrow">Cyber Defense</p>
          <h1 id="cyber-intel-title">Threat Intel</h1>
        </div>
        <ul className="cyber-page-chips">
          <li title="Adversaries tracked">
            <TargetIcon size={16} className="cyber-page-chip-icon" />
            <span className="cyber-page-chip-value">
              {ADVERSARIES.length}
            </span>
          </li>
          <li title="Dossier entries known">
            <span className="cyber-page-chip-icon" aria-hidden="true">
              <BookGlyph />
            </span>
            <span className="cyber-page-chip-value">
              {knownEntries} / {totalEntries}
            </span>
          </li>
        </ul>
      </header>

      <p className="cyber-home-lede">
        Adversary dossiers fill in as you fight them. Locked intel is revealed by
        the server when the right condition is met.
      </p>

      {profile === null && loading ? (
        <p className="muted">Loading intel…</p>
      ) : null}

      <div className="cyber-intel-grid">
        {ADVERSARIES.map((adversary) => {
          const entry = progressFor(profile, adversary.id);
          const flags = entry?.dossier_flags ?? [];
          const rank = entry?.rank ?? 1;
          const encounters = entry?.encounters ?? 0;
          const victories = entry?.victories ?? 0;
          const highestThreat = entry?.highest_threat_level_cleared ?? 0;

          const entries = adversaryDossier(adversary.id);
          const percent = dossierPercent(entries, flags);
          const knownCount = entries.filter((item) =>
            flags.includes(item.id),
          ).length;

          const modifiers = adversary.modifierIds
            .map((modifierId) => OPERATION_MODIFIERS_BY_ID[modifierId]?.name)
            .filter((name): name is string => Boolean(name));

          const headingId = `intel-${adversary.id}`;

          return (
            <section
              key={adversary.id}
              className="cyber-intel-card"
              aria-labelledby={headingId}
              style={{ "--accent": adversary.color } as CSSProperties}
            >
              <div className="cyber-intel-head">
                <span
                  className="cyber-intel-sigil"
                  style={{ "--pct": percent } as CSSProperties}
                  aria-hidden="true"
                >
                  <span className="cyber-intel-sigil-inner">
                    <AdversaryArt adversaryId={adversary.id} size={52} />
                  </span>
                </span>
                <div className="cyber-intel-id">
                  <h2 id={headingId}>{adversary.name}</h2>
                  <p className="cyber-intel-specialty">
                    {adversary.specialty}
                  </p>
                  <span className="cyber-intel-rank">Rank {rank}</span>
                </div>
                <span className="cyber-intel-dossier-tag">
                  Dossier {percent}%
                </span>
              </div>

              <p className="cyber-intel-theme">{adversary.theme}</p>

              <dl className="cyber-intel-stats">
                <div>
                  <dt>Encounters</dt>
                  <dd>{encounters}</dd>
                </div>
                <div>
                  <dt>Victories</dt>
                  <dd>{victories}</dd>
                </div>
                <div>
                  <dt>Top Threat</dt>
                  <dd>{highestThreat > 0 ? highestThreat : "None yet"}</dd>
                </div>
              </dl>

              <div className="cyber-intel-section">
                <h3>Modifier pool</h3>
                <ul className="cyber-intel-chips">
                  {modifiers.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>

              <div className="cyber-intel-section">
                <h3>
                  Dossier
                  <span className="sr-only">
                    , {knownCount} of {entries.length} entries known
                  </span>
                </h3>
                <ul className="cyber-intel-entries">
                  {entries.map((item) => {
                    const known = flags.includes(item.id);
                    if (known) {
                      return (
                        <li key={item.id} className="is-known">
                          <CheckMark />
                          <span className="sr-only">Known intel: </span>
                          <span className="cyber-intel-entry-label">
                            {item.label}
                          </span>
                          <InfoPopover
                            label={`${item.label} intel`}
                            accent={adversary.color}
                          >
                            <span className="game-popover-title">
                              {item.label}
                            </span>
                            <p className="cyber-intel-detail">{item.detail}</p>
                          </InfoPopover>
                        </li>
                      );
                    }
                    // Locked entries never render the hidden label text.
                    return (
                      <li key={item.id} className="is-locked">
                        <LockMark />
                        Locked intel
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </div>

      <div className="cyber-intel-footer">
        <Link className="cyber-secondary-button" to="/game">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
