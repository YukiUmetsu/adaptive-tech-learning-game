import type { KnowledgePrompt as KnowledgePromptData } from "../api/types";
import {
  comparisonGridClass,
  comparisonPlaceholderColumns,
} from "../lib/comparison";
import { PROMPT_KIND_META, promptAccessibleName, promptWords } from "../state/learningVocabulary";
import RevealContent from "./RevealContent";

interface KnowledgePromptProps {
  prompt: KnowledgePromptData;
  revealed: boolean;
  /** Reveal is disabled while the node is locked or the map is busy. */
  disabled?: boolean;
  onReveal: (promptId: string) => void;
}

/**
 * One progressive-reveal prompt on a knowledge card.
 *
 * Before reveal the learner sees the prompt and its blank; activating the blank
 * reveals the authored information. No grading happens here.
 */
export default function KnowledgePrompt({
  prompt,
  revealed,
  disabled = false,
  onReveal,
}: KnowledgePromptProps) {
  const meta = PROMPT_KIND_META[prompt.kind];
  const accessibleName = promptAccessibleName(prompt);
  // A comparison prompt mirrors its columns in the blank, so show the blank as
  // aligned column cells instead of one running line.
  const columnSegments =
    prompt.reveal.type === "comparison"
      ? comparisonPlaceholderColumns(prompt.placeholder)
      : [];
  const hasColumns = columnSegments.length > 1;

  return (
    <li
      className={`knowledge-prompt knowledge-prompt--${meta.className}${
        revealed ? " knowledge-prompt--revealed" : ""
      }`}
    >
      <div className="knowledge-prompt-heading">
        <span className="knowledge-prompt-icon" aria-hidden="true">
          {meta.icon}
        </span>
        <span className="knowledge-prompt-label">{promptWords(prompt)}</span>
        <span
          className="knowledge-prompt-state"
          aria-label={revealed ? "Revealed" : "Not revealed yet"}
        >
          {revealed ? "✓" : "□"}
        </span>
      </div>

      {revealed ? (
        <RevealContent reveal={prompt.reveal} />
      ) : (
        <button
          type="button"
          className={`knowledge-prompt-blank${
            hasColumns ? " knowledge-prompt-blank--columns" : ""
          }`}
          aria-label={`Reveal ${accessibleName}`}
          aria-expanded={false}
          disabled={disabled}
          onClick={() => onReveal(prompt.id)}
        >
          {hasColumns ? (
            <span
              className={`comparison-grid ${comparisonGridClass(columnSegments.length)}`}
              data-columns={columnSegments.length}
            >
              {columnSegments.map((segment, index) => (
                <span
                  key={`${index}-${segment}`}
                  className="knowledge-prompt-blank-cell"
                >
                  {segment}
                </span>
              ))}
            </span>
          ) : (
            prompt.placeholder
          )}
        </button>
      )}
    </li>
  );
}
