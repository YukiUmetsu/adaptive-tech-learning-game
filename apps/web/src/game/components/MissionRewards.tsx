import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { useCountUp } from "../../hooks/useCountUp";
import { emitBitsEarned } from "../../lib/bitsFly";
import { bitsAnimationsEnabled } from "../../state/preferences";
import { dossierLabelForFlag } from "../data/adversaries";
import { BookIcon, CoinIcon, EyeIcon, StarIcon, SwordIcon } from "./art/Icons";
import type { MissionSettlement } from "./MissionResult";

/**
 * The consolidated, server-settled reward panel shown on the result screen.
 *
 * Reward values count up, tiles pop in on a stagger, a level-up gets a glowing
 * banner, and intel/story unlocks are listed with icons. All motion is
 * decorative and disabled under reduced motion.
 */
export interface MissionRewardsProps {
  settlement: MissionSettlement;
}

type RewardTone = "bits" | "career" | "hero";

interface RewardTile {
  tone: RewardTone;
  icon: ReactNode;
  value: number;
  label: string;
}

function RewardTileView({
  tile,
  delay,
}: {
  tile: RewardTile;
  delay: number;
}) {
  const displayed = useCountUp(tile.value, { durationMs: 850 });
  return (
    <li
      className={`cyber-reward-tile is-${tile.tone}`}
      style={{ "--delay": `${delay}ms` } as CSSProperties}
    >
      <span className="cyber-reward-icon" aria-hidden="true">
        {tile.icon}
      </span>
      <span className="cyber-reward-value">+{displayed.toLocaleString()}</span>
      <span className="cyber-reward-label">{tile.label}</span>
    </li>
  );
}

export default function MissionRewards({ settlement }: MissionRewardsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const settled = settlement.status === "settled";
  const reward = settlement.reward;
  const bits = reward?.bits ?? 0;

  // Send the earned Bits flying to the wallet once, when settled.
  useEffect(() => {
    if (settled && bits > 0 && bitsAnimationsEnabled()) {
      emitBitsEarned(bits, panelRef.current);
    }
  }, [settled, bits]);

  if (!settled) {
    return (
      <div className="cyber-rewards is-pending" aria-live="polite">
        <p className="cyber-rewards-kicker">MISSION REWARDS</p>
        {settlement.status === "saving" ? (
          <p className="muted">Saving rewards…</p>
        ) : null}
        {settlement.status === "pending" ? (
          <p className="muted">
            Rewards pending. They will settle when you are back online.
          </p>
        ) : null}
        {settlement.status === "error" ? (
          <p className="muted">
            {settlement.message ?? "Could not save rewards. Retrying later."}
          </p>
        ) : null}
      </div>
    );
  }

  const tiles: RewardTile[] = [];
  if (bits > 0) {
    tiles.push({ tone: "bits", icon: <CoinIcon size={22} />, value: bits, label: "Bits" });
  }
  if ((reward?.careerXp ?? 0) > 0) {
    tiles.push({
      tone: "career",
      icon: <StarIcon size={22} />,
      value: reward?.careerXp ?? 0,
      label: "Career XP",
    });
  }
  if ((reward?.heroXp ?? 0) > 0) {
    tiles.push({
      tone: "hero",
      icon: <SwordIcon size={22} />,
      value: reward?.heroXp ?? 0,
      label: "Hero XP",
    });
  }

  return (
    <div ref={panelRef} className="cyber-rewards" aria-live="polite">
      <p className="cyber-rewards-kicker">MISSION REWARDS</p>

      {tiles.length > 0 ? (
        <ul className="cyber-reward-tiles">
          {tiles.map((tile, index) => (
            <RewardTileView key={tile.tone} tile={tile} delay={index * 110} />
          ))}
        </ul>
      ) : (
        <p className="muted">No rewards this time.</p>
      )}

      {settlement.career?.levelUp ? (
        <div className="cyber-levelup" role="status">
          <span className="cyber-levelup-badge" aria-hidden="true">
            {settlement.career.level}
          </span>
          <span className="cyber-levelup-body">
            <span className="cyber-levelup-kicker">LEVEL UP</span>
            <span className="cyber-levelup-rank">
              {settlement.career.rank} · Level {settlement.career.level}
            </span>
          </span>
        </div>
      ) : null}

      {settlement.dossierUnlocks && settlement.dossierUnlocks.length > 0 ? (
        <div className="cyber-reward-section">
          <p className="cyber-reward-section-label">NEW INTEL</p>
          <ul className="cyber-reward-intel">
            {settlement.dossierUnlocks.map((flag, index) => (
              <li
                key={flag}
                style={{ "--delay": `${index * 90}ms` } as CSSProperties}
              >
                <EyeIcon size={15} /> {dossierLabelForFlag(flag)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {settlement.storyNodes && settlement.storyNodes.length > 0 ? (
        <p className="cyber-story-advance">
          <BookIcon size={16} /> Story advanced
        </p>
      ) : null}
    </div>
  );
}
