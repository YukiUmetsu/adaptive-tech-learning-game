import { attackLabel, formatClock } from "../lib/format";
import type { AttackType } from "../models/attack";
import type { GamePhase, WaveState } from "../engine/simulation";
import {
  BackupIcon,
  BoltIcon,
  ClockIcon,
  CoinIcon,
  HelpIcon,
  PauseIcon,
  PlayIcon,
  ShieldIcon,
  SkullIcon,
} from "./art/Icons";

/**
 * Combat HUD.
 *
 * Shows only the high-value numbers during play: system integrity, credits,
 * latency, wave, and a boss health bar when a boss is active. During the build
 * phase it surfaces a next-wave preview and a "call wave early" button for a
 * bonus — a classic tower-defense risk/reward choice.
 */

export interface WavePreviewEntry {
  attackId: string;
  name: string;
  attackType: AttackType;
  count: number;
}

export interface GameHudProps {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  budget: number;
  latencyMs: number;
  latencyTargetMs: number;
  waveIndex: number;
  waveCount: number;
  waveState: WaveState;
  intermissionRemainingMs: number;
  elapsedMs: number;
  paused: boolean;
  speed: number;
  autoPause: boolean;
  bossHealth: { health: number; maxHealth: number } | null;
  nextWavePreview: WavePreviewEntry[];
  earlyCallBonusPerSecond: number;
  onTogglePause: () => void;
  onSpeedChange: (speed: number) => void;
  onToggleAutoPause: () => void;
  onCallNextWave: () => void;
  onShowTutorial: () => void;
  /** Preparation phase: show the prominent "Start wave" control. */
  showStartWave: boolean;
  onStartWave: () => void;
  /**
   * Backup status for the placed recovery control, or `null` when none is
   * deployed. "ready" until its one restore is spent, then "used".
   */
  backupStatus: "ready" | "used" | null;
}

function healthPercent(health: number, maxHealth: number): number {
  if (maxHealth <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((health / maxHealth) * 100)));
}

export default function GameHud(props: GameHudProps) {
  const {
    phase,
    health,
    maxHealth,
    budget,
    latencyMs,
    latencyTargetMs,
    waveIndex,
    waveCount,
    waveState,
    intermissionRemainingMs,
    elapsedMs,
    paused,
    speed,
    autoPause,
    bossHealth,
    nextWavePreview,
    earlyCallBonusPerSecond,
    onTogglePause,
    onSpeedChange,
    onToggleAutoPause,
    onCallNextWave,
    onShowTutorial,
    showStartWave,
    onStartWave,
    backupStatus,
  } = props;

  const percent = healthPercent(health, maxHealth);
  const latencyOver = latencyMs > latencyTargetMs;
  const waveLabel = `WAVE ${Math.min(waveIndex + 1, waveCount)} / ${waveCount}`;
  const building = waveState === "intermission" && phase === "running";
  const buildSeconds = Math.ceil(intermissionRemainingMs / 1000);
  const earlyBonus = Math.max(0, Math.round(buildSeconds * earlyCallBonusPerSecond));
  const bossPercent = bossHealth
    ? healthPercent(bossHealth.health, bossHealth.maxHealth)
    : 0;

  return (
    <div className="cyber-hud">
      <div className="cyber-hud-bar">
        <div className="cyber-hud-health" role="group" aria-label="System integrity">
          <span className="cyber-hud-icon" aria-hidden="true">
            <ShieldIcon />
          </span>
          <span className="cyber-hud-value">{percent}%</span>
          <span
            className={`cyber-health-bar${percent <= 30 ? " is-critical" : ""}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="System integrity"
          >
            <span className="cyber-health-fill" style={{ width: `${percent}%` }} />
          </span>
        </div>
        <div className="cyber-hud-stat" role="group" aria-label="Credits">
          <span className="cyber-hud-icon" aria-hidden="true">
            <CoinIcon />
          </span>
          <span className="cyber-hud-value">{budget.toLocaleString()}</span>
          <span className="cyber-hud-caption">credits</span>
        </div>
        <div
          className={`cyber-hud-stat${latencyOver ? " is-warning" : ""}`}
          role="group"
          aria-label={`Latency ${latencyMs} of ${latencyTargetMs} milliseconds`}
        >
          <span className="cyber-hud-icon" aria-hidden="true">
            <BoltIcon />
          </span>
          <span className="cyber-hud-value">{latencyMs}ms</span>
          <span className="cyber-hud-caption">
            {latencyOver ? `over ${latencyTargetMs}` : `≤ ${latencyTargetMs}`}
          </span>
        </div>
        {backupStatus ? (
          <div
            className={`cyber-hud-stat cyber-hud-backup is-${backupStatus}`}
            role="group"
            aria-label={
              backupStatus === "ready"
                ? "Backup ready to restore system health"
                : "Backup already used this mission"
            }
          >
            <span className="cyber-hud-icon" aria-hidden="true">
              <BackupIcon />
            </span>
            <span className="cyber-hud-value">
              {backupStatus === "ready" ? "Ready" : "Used"}
            </span>
            <span className="cyber-hud-caption">backup</span>
          </div>
        ) : null}
        <div className="cyber-hud-spacer" />
        <button
          type="button"
          className="cyber-hud-button"
          onClick={onTogglePause}
          aria-pressed={paused}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <div className="cyber-speed" role="group" aria-label="Game speed">
          {[1, 2].map((option) => (
            <button
              key={option}
              type="button"
              className={`cyber-speed-button${speed === option ? " is-active" : ""}`}
              aria-pressed={speed === option}
              onClick={() => onSpeedChange(option)}
            >
              {option}x
            </button>
          ))}
        </div>
        <button
          type="button"
          className="cyber-hud-button cyber-hud-button--ghost"
          onClick={onToggleAutoPause}
          aria-pressed={autoPause}
          title="Pause automatically while building"
        >
          {autoPause ? "AUTO-PAUSE" : "MANUAL"}
        </button>
        <button
          type="button"
          className="cyber-hud-button cyber-hud-button--ghost"
          onClick={onShowTutorial}
          aria-label="How to play"
          title="How to play"
        >
          <HelpIcon size={16} />
        </button>
        {showStartWave ? (
          <button
            type="button"
            className="cyber-primary-button cyber-hud-start"
            onClick={onStartWave}
          >
            <PlayIcon size={16} /> Start wave 1
          </button>
        ) : null}
      </div>

      {bossHealth ? (
        <div className="cyber-boss-bar" role="group" aria-label="Boss health">
          <span className="cyber-boss-label">
            <SkullIcon size={14} /> BOTNET
          </span>
          <span
            className="cyber-boss-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bossPercent}
            aria-label="Boss health"
          >
            <span className="cyber-boss-fill" style={{ width: `${bossPercent}%` }} />
          </span>
        </div>
      ) : null}

      <div className="cyber-hud-bar cyber-hud-bar--wave">
        <span className="cyber-wave-pill">{waveLabel}</span>
        <span className="cyber-hud-time" aria-label="Mission time">
          <ClockIcon size={14} /> {formatClock(elapsedMs)}
        </span>
        {building ? (
          <span className="cyber-build-note">
            Build phase · next wave in {buildSeconds}s
          </span>
        ) : null}
        {nextWavePreview.length > 0 ? (
          <span className="cyber-wave-preview" aria-label="Next wave">
            {nextWavePreview.map((entry) => (
              <span key={entry.attackId} className="cyber-wave-chip">
                <span className={`cyber-wave-dot cyber-wave-dot--${entry.attackType}`} />
                {attackLabel(entry.attackType)} ×{entry.count}
              </span>
            ))}
          </span>
        ) : null}
        <div className="cyber-hud-spacer" />
        {building ? (
          <button
            type="button"
            className="cyber-call-button"
            onClick={onCallNextWave}
          >
            Send next wave +{earlyBonus} <CoinIcon size={14} />
          </button>
        ) : null}
      </div>

      {latencyOver ? (
        <p className="cyber-hud-warning" role="status">
          ⚠ Latency target exceeded — current {latencyMs} ms, target{" "}
          {latencyTargetMs} ms.
        </p>
      ) : null}
    </div>
  );
}
