interface ModuleCompleteCelebrationProps {
  moduleTitle: string;
  unlockedCount: number;
  totalCount: number;
  nextModuleTitle: string | null;
  domainComplete: boolean;
  reducedMotion: boolean;
  startingQuiz: boolean;
  /** Whether the section has authored quiz questions to draw from. */
  sectionQuizAvailable: boolean;
  /** Whether this section's quiz has already been completed. */
  sectionQuizComplete: boolean;
  onContinue: () => void;
  onStartQuiz: () => void;
  onStartSectionQuiz: () => void;
}

/**
 * Celebration shown when every node in a module is unlocked.
 *
 * A section ends with a short, section-scoped retrieval quiz. The quiz is the
 * primary action, but navigation is never blocked: the learner can keep
 * exploring. This deliberately says "Module Complete" and "Path Unlocked",
 * never "Mastered", because exploration is not retrieval evidence.
 */
export default function ModuleCompleteCelebration({
  moduleTitle,
  unlockedCount,
  totalCount,
  nextModuleTitle,
  domainComplete,
  reducedMotion,
  startingQuiz,
  sectionQuizAvailable,
  sectionQuizComplete,
  onContinue,
  onStartQuiz,
  onStartSectionQuiz,
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

      {sectionQuizComplete ? (
        <p className="module-complete-quiz-done">
          <span aria-hidden="true">✓</span> Section quiz complete
        </p>
      ) : (
        <p className="module-complete-path">
          Finish this section with a one-question retrieval check.
        </p>
      )}

      <div className="module-complete-actions">
        {sectionQuizAvailable ? (
          <button
            type="button"
            className="primary"
            disabled={startingQuiz}
            onClick={onStartSectionQuiz}
          >
            {startingQuiz
              ? "Starting…"
              : sectionQuizComplete
                ? "🎯 Retake Section Quiz"
                : "🎯 Take Section Quiz"}
          </button>
        ) : null}
        <button type="button" onClick={onContinue}>
          Continue Exploring
        </button>
        {domainComplete ? (
          <button type="button" disabled={startingQuiz} onClick={onStartQuiz}>
            {startingQuiz ? "Starting…" : "🎯 Start Domain Quiz"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
