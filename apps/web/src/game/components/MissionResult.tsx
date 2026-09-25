import type { MissionDefinition } from "../models/mission";
import type { PostmortemReport } from "../engine/postmortem";
import MissionCelebration from "./MissionCelebration";

/**
 * Mission result and postmortem (spec sections 24, 25, and 38.5).
 *
 * One of the main learning surfaces: concise, mobile-friendly, and explicit
 * that the Bits figure is a preview rather than a settled reward. A cleared
 * mission gets a short celebratory burst behind the content.
 */
export interface MissionResultProps {
  report: PostmortemReport;
  mission: MissionDefinition;
  hasNext: boolean;
  onRetry: () => void;
  onContinue: () => void;
  onNext: () => void;
}

function stars(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars));
}

export default function MissionResult({
  report,
  mission,
  hasNext,
  onRetry,
  onContinue,
  onNext,
}: MissionResultProps) {
  const boss = mission.waves.some((wave) => wave.boss === true);
  return (
    <section
      className={`cyber-result${report.completed ? " is-celebrating" : ""}`}
      aria-labelledby="cyber-result-title"
    >
      {report.completed ? <MissionCelebration boss={boss} /> : null}
      <p
        className={`cyber-result-banner${
          report.completed ? " is-success" : " is-failure"
        }`}
      >
        {report.completed ? "MISSION COMPLETE" : "SYSTEM COMPROMISED"}
      </p>
      <h1 id="cyber-result-title">{mission.title}</h1>
      {report.completed ? (
        <p className="cyber-result-stars" aria-label={`${report.stars} of 3 stars`}>
          {stars(report.stars)}
        </p>
      ) : null}

      <dl className="cyber-result-stats">
        <div>
          <dt>System health</dt>
          <dd>
            {report.health} / {report.maxHealth}
          </dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd className={report.latencyOk ? "" : "is-warning"}>
            {report.latencyMs} ms (target {report.latencyTargetMs})
          </dd>
        </div>
        <div>
          <dt>Budget remaining</dt>
          <dd>
            {report.budgetRemaining} (spent {report.spent})
          </dd>
        </div>
        <div>
          <dt>Attacks blocked</dt>
          <dd>{report.blockedTotal}</dd>
        </div>
        <div>
          <dt>Credits earned</dt>
          <dd>{report.creditsEarned}</dd>
        </div>
      </dl>

      {report.blocked.length > 0 ? (
        <div className="cyber-result-tally">
          <h2>Blocked</h2>
          <ul>
            {report.blocked.map((entry) => (
              <li key={entry.attackId}>
                {entry.count} × {entry.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!report.completed && report.primaryCause ? (
        <p className="cyber-result-cause">
          Primary cause: <strong>{report.primaryCause.label}</strong>
        </p>
      ) : null}

      {report.mostEffectiveDefense ? (
        <p className="cyber-result-best">
          Most effective control:{" "}
          <strong>{report.mostEffectiveDefense.name}</strong>
        </p>
      ) : null}

      {report.backupRestored > 0 ? (
        <p className="cyber-result-best">
          Backup restored <strong>{report.backupRestored}</strong> system health
        </p>
      ) : null}

      <div className="cyber-result-lesson">
        <h2>Architecture note</h2>
        <p>{report.message}</p>
      </div>

      <p className="cyber-result-bits">
        Bits preview: <strong>+{report.bitsPreview}</strong>{" "}
        <span className="muted">
          (credited by the platform after it verifies the run)
        </span>
      </p>

      <div className="cyber-result-actions">
        {hasNext && report.completed ? (
          <button type="button" className="cyber-primary-button" onClick={onNext}>
            Next mission →
          </button>
        ) : null}
        <button
          type="button"
          className={report.completed && hasNext ? "cyber-secondary-button" : "cyber-primary-button"}
          onClick={onRetry}
        >
          Retry
        </button>
        <button type="button" className="cyber-secondary-button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}
