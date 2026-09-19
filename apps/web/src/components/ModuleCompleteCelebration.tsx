interface ModuleCompleteCelebrationProps {
  moduleTitle: string;
  unlockedCount: number;
  totalCount: number;
  nextModuleTitle: string | null;
  domainComplete: boolean;
  reducedMotion: boolean;
  startingQuiz: boolean;
  onContinue: () => void;
  onStartQuiz: () => void;
}

/**
 * Celebration shown when every node in a module is unlocked.
 *
 * It deliberately says "Module Complete" and "Path Unlocked", never
 * "Mastered": exploration is not retrieval evidence. Navigation is never
 * blocked.
 */
export default function ModuleCompleteCelebration({
  moduleTitle,
  unlockedCount,
  totalCount,
  nextModuleTitle,
  domainComplete,
  reducedMotion,
  startingQuiz,
  onContinue,
  onStartQuiz,
}: ModuleCompleteCelebrationProps) {
  return (
    <section
      className={`module-complete-celebration${
        reducedMotion ? "" : " module-complete-celebration--animated"
      }`}
      role="status"
      aria-live="polite"
    >
      {domainComplete ? (
        <>
          <p className="module-complete-kicker">DOMAIN FOUNDATION BUILT</p>
          <h2>Knowledge Map Complete</h2>
        </>
      ) : (
        <>
          <p className="module-complete-kicker">✦ MODULE COMPLETE ✦</p>
          <h2>{moduleTitle}</h2>
        </>
      )}

      <p className="module-complete-nodes">
        {unlockedCount} / {totalCount} Nodes Online
      </p>

      {!domainComplete && nextModuleTitle ? (
        <p className="module-complete-path">
          Path Unlocked: <strong>{nextModuleTitle}</strong>
        </p>
      ) : null}

      <div className="module-complete-actions">
        <button type="button" onClick={onContinue}>
          Continue Exploring
        </button>
        {domainComplete ? (
          <button
            type="button"
            className="primary"
            disabled={startingQuiz}
            onClick={onStartQuiz}
          >
            {startingQuiz ? "Starting…" : "🎯 Start Domain Quiz"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
