import type { HeroDefinition, HeroRuntime } from "../models/hero";
import HeroArt from "./art/HeroArt";

/**
 * Compact hero roster beside the tower list. Chips are draggable onto the road
 * (and tappable for details). No permanent explanatory text.
 */
export interface HeroBarProps {
  heroes: HeroRuntime[];
  catalog: { heroesById: Record<string, HeroDefinition> };
  deployedHeroIds: string[];
  selectedHeroId: string | null;
  onSelect: (heroId: string) => void;
}

export default function HeroBar({
  heroes,
  catalog,
  deployedHeroIds,
  selectedHeroId,
  onSelect,
}: HeroBarProps) {
  if (heroes.length === 0) {
    return null;
  }

  return (
    <div className="cyber-heroes" role="toolbar" aria-label="Heroes">
      <span className="cyber-tray-label">Heroes</span>
      {heroes.map((runtime) => {
        const definition = catalog.heroesById[runtime.heroId];
        if (!definition) {
          return null;
        }
        const onCooldown = runtime.cooldownRemainingMs > 0;
        const active = deployedHeroIds.includes(runtime.heroId);
        const ready = !onCooldown && !active;
        return (
          <button
            key={runtime.heroId}
            type="button"
            className={`cyber-hero-chip${active ? " is-active" : ""}${
              onCooldown ? " is-cooldown" : ""
            }${selectedHeroId === runtime.heroId ? " is-selected" : ""}`}
            draggable={ready}
            onDragStart={(event) => {
              if (!ready) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData("text/plain", runtime.heroId);
              event.dataTransfer.effectAllowed = "move";
            }}
            aria-pressed={selectedHeroId === runtime.heroId}
            aria-label={`${definition.name}, ${definition.abilityName}. ${
              active
                ? "Deployed"
                : onCooldown
                  ? `Ready in ${Math.ceil(runtime.cooldownRemainingMs / 1000)} seconds`
                  : "Ready — drag onto the road"
            }`}
            onClick={() => onSelect(runtime.heroId)}
          >
            <HeroArt heroId={runtime.heroId} active={active} size={38} />
            <span className="cyber-hero-chip-text">
              <span className="cyber-hero-chip-name">{definition.name}</span>
              <span className="cyber-hero-chip-status">
                {active
                  ? "Fighting"
                  : onCooldown
                    ? `${Math.ceil(runtime.cooldownRemainingMs / 1000)}s`
                    : "Drag to road"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
