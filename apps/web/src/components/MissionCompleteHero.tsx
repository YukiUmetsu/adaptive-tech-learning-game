import type { CSSProperties } from "react";

import type { QuizCompletionPresentation } from "../state/quizModes";

interface MissionCompleteHeroProps {
  presentation: QuizCompletionPresentation;
  subtitle?: string;
  message: string;
}

const PARTICLES = Array.from({ length: 8 }, (_, index) => index);

/**
 * Celebration header for the shared completion screen.
 *
 * Particles are small digital Bits motifs, not confetti; reduced-motion users
 * see the static header. Full practice uses the stronger `celebration` variant.
 */
export default function MissionCompleteHero({
  presentation,
  subtitle,
  message,
}: MissionCompleteHeroProps) {
  return (
    <header className={`completion-hero hero-${presentation.heroVariant}`}>
      <div className="completion-particles" aria-hidden="true">
        {PARTICLES.map((index) => (
          <span
            key={index}
            className={`particle particle-${(index % 4) + 1}`}
            style={{ "--index": index } as CSSProperties}
          >
            {index % 2 === 0 ? "◇" : "✦"}
          </span>
        ))}
      </div>

      <p className="completion-kicker">Mission complete</p>
      <h1 id="completion-heading" className="completion-title">
        <span className="completion-title-icon" aria-hidden="true">
          {presentation.icon}
        </span>
        {presentation.title}
      </h1>
      {subtitle ? <p className="completion-subtitle">{subtitle}</p> : null}
      <p className="completion-message" data-testid="completion-message">
        {message}
      </p>
    </header>
  );
}
