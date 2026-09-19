import type { LearningModule } from "../api/types";
import type { DerivedLearningState } from "../state/learningProgress";

type ModuleProgressMap = DerivedLearningState["moduleProgress"];

interface KnowledgeMapHudProps {
  /** Authored label, for example `Discovery Progress`. */
  label: string;
  domainName: string;
  unlockedCount: number;
  totalCount: number;
  domainComplete: boolean;
  /** Knowledge-map groups (modules), in authored order. */
  modules: LearningModule[];
  progress: ModuleProgressMap;
  activeModuleId: string;
  onSelectModule: (moduleId: string) => void;
}

/**
 * The knowledge-map command panel.
 *
 * Discovery progress and group selection live in one HUD: the overall meter
 * shows domain-wide charge, and each group is a card with its own charge bar,
 * so the learner reads and picks a group in the same place. One group is
 * rendered at a time.
 *
 * This is explicitly not mastery: it counts explored knowledge nodes only.
 */
export default function KnowledgeMapHud({
  label,
  domainName,
  unlockedCount,
  totalCount,
  domainComplete,
  modules,
  progress,
  activeModuleId,
  onSelectModule,
}: KnowledgeMapHudProps) {
  const percent = totalCount === 0 ? 0 : Math.round((unlockedCount / totalCount) * 100);

  return (
    <section className="knowledge-hud" aria-label={label}>
      <span className="knowledge-hud-scan" aria-hidden="true" />

      <header className="knowledge-hud-top">
        <div className="knowledge-hud-heading">
          <p className="knowledge-hud-label">{label}</p>
          <h2>{domainName}</h2>
        </div>
        <div className="knowledge-hud-power">
          <span className="knowledge-hud-power-value">
            {percent}
            <small>%</small>
          </span>
          <span className="knowledge-hud-power-caption">
            {unlockedCount} / {totalCount} Nodes Unlocked
          </span>
        </div>
      </header>

      <div
        className="knowledge-hud-meter"
        role="progressbar"
        aria-label={`${label}: ${unlockedCount} of ${totalCount} knowledge nodes unlocked`}
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-valuenow={unlockedCount}
      >
        <span
          className="knowledge-hud-meter-fill"
          style={{ width: `${percent}%` }}
        />
        <span className="knowledge-hud-meter-ticks" aria-hidden="true" />
      </div>

      {domainComplete ? (
        <p className="knowledge-hud-note">
          Knowledge Map complete — you built the foundation. Now see what you can
          recall.
        </p>
      ) : null}

      <nav className="knowledge-hud-groups" aria-label="Knowledge map groups">
        <ul className="knowledge-group-grid">
          {modules.map((module, index) => {
            const entry = progress[module.id];
            const available = entry?.available ?? false;
            const complete = entry?.complete ?? false;
            const active = module.id === activeModuleId;
            const state = complete ? "complete" : available ? "available" : "locked";
            const groupPercent =
              entry && entry.total > 0 ? (entry.unlocked / entry.total) * 100 : 0;
            const badge = complete ? "✓" : available ? String(index + 1) : "🔒";
            const stateLabel = complete ? "Online" : available ? "Ready" : "Locked";

            return (
              <li key={module.id}>
                <button
                  type="button"
                  className={`knowledge-group-card knowledge-group-card--${state}${
                    active ? " knowledge-group-card--active" : ""
                  }`}
                  data-state={state}
                  aria-current={active ? "true" : undefined}
                  aria-disabled={!available}
                  onClick={() => {
                    if (available) {
                      onSelectModule(module.id);
                    }
                  }}
                >
                  <span className="knowledge-group-card-top">
                    <span className="knowledge-group-badge" aria-hidden="true">
                      {badge}
                    </span>
                    <span className="knowledge-group-card-count">
                      {entry ? `${entry.unlocked} / ${entry.total}` : ""}
                    </span>
                  </span>
                  <span className="knowledge-group-card-title">{module.title}</span>
                  <span className="knowledge-group-card-bar" aria-hidden="true">
                    <span
                      className="knowledge-group-card-bar-fill"
                      style={{ width: `${groupPercent}%` }}
                    />
                  </span>
                  <span className="knowledge-group-card-state">{stateLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
