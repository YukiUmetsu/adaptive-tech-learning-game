import type { WaveBanner as WaveBannerState } from "../engine/simulation";

/**
 * Dramatic wave entrance banner. Pure presentation: the simulation owns the
 * countdown (`waveBanner.remainingMs`) so it pauses with the game.
 */
export interface WaveBannerProps {
  banner: WaveBannerState | null;
  waveCount: number;
}

export default function WaveBanner({ banner, waveCount }: WaveBannerProps) {
  if (!banner) {
    return null;
  }
  return (
    <div
      className={`cyber-wave-banner${banner.boss ? " is-boss" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="cyber-wave-banner-kicker">
        {banner.boss ? "WARNING" : `WAVE ${banner.waveIndex + 1} / ${waveCount}`}
      </span>
      <span className="cyber-wave-banner-title">
        {banner.boss ? "BOSS INCOMING" : "INCOMING"}
      </span>
    </div>
  );
}
