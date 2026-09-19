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
  /** Annotation ids already opened for this prompt's code file. */
  revealedAnnotationIds?: readonly string[];
  /** Reveal is disabled while the node is locked or the map is busy. */
  disabled?: boolean;
  onReveal: (promptId: string) => void;
  /** Reveals one annotation inside a code file. Never scored. */
  onRevealAnnotation?: (promptId: string, annotationId: string) => void;
}

/**
 * One progressive-reveal prompt on a knowledge card.
 *
 * Before reveal the learner sees the prompt and its blank; activating the blank
 * reveals the authored information. `code_file` is the exception: the file is
 * rendered immediately and the learner reveals individual annotations. No
 * grading happens here.
 */
export default function KnowledgePrompt({
  prompt,
  revealed,
  revealedAnnotationIds,
  disabled = false,
  onReveal,
  onRevealAnnotation,
}: KnowledgePromptProps) {
  const meta = PROMPT_KIND_META[prompt.kind];
  const accessibleName = promptAccessibleName(prompt);
  const isCodeFile = prompt.reveal.type === "code_file";
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

      {isCodeFile ? (
        <>
          {prompt.placeholder.trim().length > 0 ? (
            <p className="knowledge-prompt-context">{prompt.placeholder}</p>
          ) : null}
          <RevealContent
            reveal={prompt.reveal}
            codeInteraction={{
              revealedAnnotationIds: revealedAnnotationIds ?? [],
              onRevealAnnotation: (annotationId) =>
                onRevealAnnotation?.(prompt.id, annotationId),
              disabled,
              complete: revealed,
              onComplete: () => onReveal(prompt.id),
            }}
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
