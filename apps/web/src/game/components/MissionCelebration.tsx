import type { CSSProperties } from "react";

/**
 * Decorative victory burst for the Cyber Defense result screen.
 *
 * A confetti shower, two shockwave rings, and a radial spark burst fire once
 * when a mission is cleared. Everything here is presentational: it is hidden
 * from assistive tech, and CSS hides it entirely when the learner asks for
 * reduced motion or turns reward animations off. The result content itself
 * (banner, stars, stats) is unaffected and remains the accessible source of
 * truth.
 */
export interface MissionCelebrationProps {
  /** True for a boss mission, which gets a warmer gold burst. */
  boss: boolean;
}

const CONFETTI_COUNT = 28;
const SPARK_COUNT = 12;

export default function MissionCelebration({ boss }: MissionCelebrationProps) {
  return (
    <div
      className={`cyber-celebration${boss ? " is-boss" : ""}`}
      aria-hidden="true"
    >
      <span className="cyber-celebration-flash" />
      <span className="cyber-celebration-wave" />
      <span className="cyber-celebration-wave cyber-celebration-wave--late" />

      <div className="cyber-celebration-confetti">
        {Array.from({ length: CONFETTI_COUNT }, (_, index) => (
          <span
            key={index}
            className={`cyber-confetti cyber-confetti--${(index % 5) + 1}`}
            style={
              {
                "--x": `${(index * 37) % 100}%`,
                "--delay": `${(index % 7) * 65}ms`,
                "--drift": `${((index % 5) - 2) * 28}px`,
                "--spin": `${(index % 2 === 0 ? 1 : -1) * (220 + (index % 4) * 120)}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="cyber-celebration-sparks">
        {Array.from({ length: SPARK_COUNT }, (_, index) => (
          <span
            key={index}
            className="cyber-spark"
            style={
              {
                "--angle": `${index * (360 / SPARK_COUNT)}deg`,
                "--delay": `${index * 35}ms`,
              } as CSSProperties
            }
          >
            {index % 2 === 0 ? "✦" : "◇"}
          </span>
        ))}
      </div>
    </div>
  );
}
