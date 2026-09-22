import type { KnowledgePrompt as KnowledgePromptData } from "../api/types";
import {
  comparisonGridClass,
  comparisonPlaceholderColumns,
} from "../lib/comparison";
import { isProgressiveTable, isProgressiveText } from "../lib/learningElements";
import { PROMPT_KIND_META, promptAccessibleName, promptWords } from "../state/learningVocabulary";
import InlineText from "./InlineText";
import RevealContent from "./RevealContent";

interface KnowledgePromptProps {
  prompt: KnowledgePromptData;
  revealed: boolean;
  /** Namespaced discovery element ids already revealed for this prompt. */
  revealedElementIds?: readonly string[];
  /** Reveal is disabled while the node is locked or the map is busy. */
  disabled?: boolean;
  onReveal: (promptId: string) => void;
  /** Reveals one discovery element inside its reveal. Never scored. */
  onRevealElement?: (promptId: string, elementId: string) => void;
}

/**
 * One progressive-reveal prompt on a knowledge card.
 *
 * Before reveal the learner sees the prompt and its blank; activating the blank
 * reveals the authored information. Some reveals are interactive from the
 * start instead: a `code_file` renders immediately and reveals individual
 * annotations, a progressive `table` renders immediately and reveals rows,
 * columns, or cells, and a progressive `text` renders its sentence immediately
 * and reveals individual spans. No grading happens here.
 */
export default function KnowledgePrompt({
  prompt,
  revealed,
  revealedElementIds,
  disabled = false,
  onReveal,
  onRevealElement,
}: KnowledgePromptProps) {
  const meta = PROMPT_KIND_META[prompt.kind];
  const accessibleName = promptAccessibleName(prompt);
  const isCodeFile = prompt.reveal.type === "code_file";
  const isProgressive = isProgressiveTable(prompt.reveal);
  const isProgressiveTextReveal = isProgressiveText(prompt.reveal);
  const interactive = isCodeFile || isProgressive || isProgressiveTextReveal;
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

      {interactive ? (
        <>
          {prompt.placeholder.trim().length > 0 ? (
            <p className="knowledge-prompt-context">
              <InlineText text={prompt.placeholder} />
            </p>
          ) : null}
          <RevealContent
            reveal={prompt.reveal}
            codeInteraction={
              isCodeFile
                ? {
                    revealedElementIds: revealedElementIds ?? [],
                    onRevealElement: (elementId) =>
                      onRevealElement?.(prompt.id, elementId),
                    disabled,
                    complete: revealed,
                    onComplete: () => onReveal(prompt.id),
                  }
                : undefined
            }
            tableInteraction={
              isProgressive
                ? {
                    revealedElementIds: revealedElementIds ?? [],
                    onRevealElement: (elementId) =>
                      onRevealElement?.(prompt.id, elementId),
                    disabled,
                  }
                : undefined
            }
            textInteraction={
              isProgressiveTextReveal
                ? {
                    revealedElementIds: revealedElementIds ?? [],
                    onRevealElement: (elementId) =>
                      onRevealElement?.(prompt.id, elementId),
                    disabled,
                    complete: revealed,
                    onComplete: () => onReveal(prompt.id),
                  }
                : undefined
            }
          />
        </>
      ) : revealed ? (
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
                  <InlineText text={segment} terms={[]} />
                </span>
              ))}
            </span>
          ) : (
            <InlineText text={prompt.placeholder} terms={[]} />
          )}
        </button>
      )}
    </li>
  );
}
