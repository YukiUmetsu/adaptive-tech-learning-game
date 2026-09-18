/**
 * Learner-facing quiz-mode presentation.
 *
 * Question counts are server policy (`apps/api/src/selection.rs`); these values
 * exist only for the mode cards and are intentionally not client input.
 */
export interface QuizModePresentation {
  key: "quick_adaptive" | "domain_quiz" | "full_practice";
  label: string;
  shortLabel: string;
  questionLabel: string;
  duration: string;
  icon: string;
  horizon: string;
}

export const QUICK_QUIZ: QuizModePresentation = {
  key: "quick_adaptive",
  label: "Quick Quiz",
  shortLabel: "Quick Quiz",
  questionLabel: "10 adaptive questions",
  duration: "~6 min",
  icon: "⚡",
  horizon: "What should I practice right now?",
};

export const DOMAIN_QUIZ: QuizModePresentation = {
  key: "domain_quiz",
  label: "Domain Quiz",
  shortLabel: "Domain Quiz",
  questionLabel: "Practice one exam domain",
  duration: "~10–20 min",
  icon: "🎯",
  horizon: "Focus on a single objective area.",
};

export const FULL_PRACTICE: QuizModePresentation = {
  key: "full_practice",
  label: "Full Practice",
  shortLabel: "Full Practice",
  questionLabel: "65-question mixed certification challenge",
  duration: "~90–120 min",
  icon: "🏆",
  horizon: "How well do I know the whole certification?",
};

export const QUIZ_MODES: QuizModePresentation[] = [
  QUICK_QUIZ,
  DOMAIN_QUIZ,
  FULL_PRACTICE,
];

/** Human label for a mission's stored mode. */
export function quizModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "quick_adaptive":
      return QUICK_QUIZ.label;
    case "domain_quiz":
      return DOMAIN_QUIZ.label;
    case "full_practice":
      return FULL_PRACTICE.label;
    case "task_practice":
      return "Task Practice";
    default:
      return "Quiz";
  }
}
