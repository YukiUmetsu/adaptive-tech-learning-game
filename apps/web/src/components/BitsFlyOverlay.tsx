import { useEffect, useState, type CSSProperties } from "react";

import {
  BITS_EARNED_EVENT,
  bitsTargetCenter,
  type BitsEarnedDetail,
} from "../lib/bitsFly";
import { prefersReducedMotion } from "../lib/motion";
import { useUserPreferences } from "../state/preferences";
import { playBits } from "../state/sound";

interface Particle {
  id: number;
  dx: number;
  dy: number;
  delay: number;
}

interface Burst {
  id: number;
  amount: number;
  x: number;
  y: number;
  particles: Particle[];
}

/** Deterministic spread so the animation is stable and testable. */
const PARTICLE_OFFSETS = [
  { angle: -0.6, distance: 14 },
  { angle: -0.15, distance: 18 },
  { angle: 0.35, distance: 12 },
  { angle: 0.9, distance: 16 },
  { angle: 1.5, distance: 10 },
  { angle: 2.1, distance: 13 },
];

let burstCounter = 0;

/**
 * Renders Bits flying from their source into the wallet HUD.
 *
 * A single instance lives in the app shell. It listens for Bits-earned events,
 * plays the coin sound, and animates a small burst toward the wallet. Under
 * reduced motion the sound still plays but no motion is rendered, so the
 * experience stays informative without animation.
 */
export default function BitsFlyOverlay() {
  const preferences = useUserPreferences();
  const reduced =
    prefersReducedMotion() || !preferences.gamification.bitsAnimations;
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<BitsEarnedDetail>).detail;
      if (!detail || detail.amount <= 0) {
        return;
      }
      playBits();
      if (reduced) {
        return;
      }
      const target = bitsTargetCenter();
      if (!target) {
        return;
      }

      const count = Math.min(6, Math.max(3, Math.round(detail.amount / 3)));
      const particles: Particle[] = Array.from({ length: count }, (_, index) => {
        const offset = PARTICLE_OFFSETS[index % PARTICLE_OFFSETS.length];
        return {
          id: index,
          dx: target.x - detail.x + Math.cos(offset.angle) * offset.distance,
          dy: target.y - detail.y + Math.sin(offset.angle) * offset.distance,
          delay: index * 35,
        };
      });

      const id = (burstCounter += 1);
      setBursts((previous) => [
        ...previous,
        { id, amount: detail.amount, x: detail.x, y: detail.y, particles },
      ]);
      window.setTimeout(() => {
        setBursts((previous) => previous.filter((burst) => burst.id !== id));
      }, 1100);
    };

    window.addEventListener(BITS_EARNED_EVENT, handle);
    return () => window.removeEventListener(BITS_EARNED_EVENT, handle);
  }, [reduced]);

  if (bursts.length === 0) {
    return null;
  }

  return (
    <div className="bits-fly-layer" aria-hidden="true">
      {bursts.map((burst) => (
        <div
          key={burst.id}
          className="bits-fly-burst"
          style={{ left: burst.x, top: burst.y }}
        >
          <span
            className="bits-fly-label"
            style={
              {
                "--dx": `${burst.particles[0]?.dx ?? 0}px`,
                "--dy": `${burst.particles[0]?.dy ?? 0}px`,
              } as CSSProperties
            }
          >
            +{burst.amount}
          </span>
          {burst.particles.map((particle) => (
            <span
              key={particle.id}
              className="bits-fly-particle"
              style={
                {
                  "--dx": `${particle.dx}px`,
                  "--dy": `${particle.dy}px`,
                  animationDelay: `${particle.delay}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
