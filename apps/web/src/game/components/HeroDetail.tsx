import type { HeroDefinition, HeroRuntime } from "../models/hero";
import { HERO_ROLES } from "../models/hero";
import HeroArt from "./art/HeroArt";
import StatsRow, { type Stat } from "./art/Stats";
import { ClockIcon, HourglassIcon, SwordIcon, TargetIcon } from "./art/Icons";

/**
 * Hero detail card shown when a hero is tapped. Holds the description, stats,
 * and deployment instructions; the roster stays compact.
 */
export interface HeroDetailProps {
  definition: HeroDefinition;
  runtime: HeroRuntime;
  deployed: boolean;
  onClose: () => void;
}

export default function HeroDetail({
  definition,
  runtime,
  deployed,
  onClose,
}: HeroDetailProps) {
  const onCooldown = runtime.cooldownRemainingMs > 0;
  const status = deployed
    ? "Fighting on the road."
    : onCooldown
      ? `Ready in ${Math.ceil(runtime.cooldownRemainingMs / 1000)}s.`
      : "Drag me onto the road (or tap the road) to deploy.";
  const stats: Stat[] = [
    { icon: <SwordIcon size={14} />, label: "Attack", value: `${definition.attackDamage}`, tone: "danger" },
    { icon: <ClockIcon size={14} />, label: "Attack interval", value: `${definition.attackIntervalMs}ms` },
    { icon: <TargetIcon size={14} />, label: "Reach", value: `${definition.attackRange}` },
    { icon: <HourglassIcon size={14} />, label: "Fights for", value: `${definition.durationMs / 1000}s` },
    { icon: <ClockIcon size={14} />, label: "Cooldown", value: `${definition.cooldownMs / 1000}s` },
  ];

  return (
    <div className="cyber-shop-detail cyber-hero-detail">
      <div className="cyber-shop-detail-head">
        <h2>{definition.name}</h2>
        <span className="muted">{HERO_ROLES[definition.kind]}</span>
      </div>
      <div className="cyber-hero-detail-body">
        <HeroArt heroId={definition.id} active={deployed} size={68} />
        <div>
          <p className="cyber-defense-desc">{definition.description}</p>
          <StatsRow stats={stats} />
          <p className="cyber-defense-hint" role="note">
            {status}
          </p>
        </div>
      </div>
      <div className="cyber-shop-actions">
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
