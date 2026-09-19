import { useMemo } from "react";

import type { LearningReveal } from "../api/types";
import {
  annotateCodeLines,
  tokenClassName,
  type CodeAnnotationTarget,
} from "../lib/syntaxHighlight";

/** The `code_file` arm of the shared reveal union. */
export type CodeFileReveal = Extract<LearningReveal, { type: "code_file" }>;

/** Discovery state and callbacks for one interactive code file. */
export interface CodeFileInteraction {
  /** Annotation ids the learner has already opened. */
  revealedAnnotationIds: readonly string[];
  /** Reveals one annotation explanation. Never scored. */
  onRevealAnnotation: (annotationId: string) => void;
  /** Disables interaction while the node is locked or busy. */
  disabled?: boolean;
  /** Whether the prompt is complete (all required annotations revealed). */
  complete?: boolean;
  /** Completes a file that has no required annotations. */
  onComplete?: () => void;
}

interface CodeFileProps {
  reveal: CodeFileReveal;
  interaction?: CodeFileInteraction;
}

/**
 * A read-only, syntax-highlighted file with clickable annotation regions.
 *
 * The source is rendered as highlighted text and is never editable or executed.
 * Annotations are located by line/text anchors, so the raw `code` string stays
 * valid, copyable source. Explanations appear only after their region is
 * activated, and the revealed set is restored from discovery progress.
 */
export default function CodeFile({ reveal, interaction }: CodeFileProps) {
  const revealed = useMemo(
    () => new Set(interaction?.revealedAnnotationIds ?? []),
    [interaction?.revealedAnnotationIds],
  );
  const targets = useMemo<CodeAnnotationTarget[]>(
    () =>
      (reveal.annotations ?? []).map((annotation) => ({
        annotationId: annotation.id,
        line: annotation.anchor.line,
        text: annotation.anchor.text,
        occurrence: annotation.anchor.occurrence ?? 1,
      })),
    [reveal.annotations],
  );
  const lines = useMemo(
    () => annotateCodeLines(reveal.code, reveal.language, targets),
    [reveal.code, reveal.language, targets],
  );
  const annotationById = useMemo(
    () => new Map((reveal.annotations ?? []).map((a) => [a.id, a])),
    [reveal.annotations],
  );

  const annotations = reveal.annotations ?? [];
  const hasRequiredAnnotations = annotations.some((a) => a.required === true);
  const showCompleteButton =
    !hasRequiredAnnotations &&
    Boolean(interaction?.onComplete) &&
    !interaction?.complete;
  const revealedAnnotations = annotations.filter((a) => revealed.has(a.id));
  const lineNumbers = reveal.line_numbers !== false;

  return (
    <div className="learning-code-file">
      <div className="learning-code-file-bar">
        <span className="learning-code-file-name">{reveal.filename}</span>
        <span className="learning-code-file-language">{reveal.language}</span>
      </div>
      <pre
        className={`learning-code${lineNumbers ? " learning-code--numbered" : ""}`}
        data-language={reveal.language}
      >
        <code>
          {lines.map((items, lineIndex) => (
            <span className="learning-code-line" key={lineIndex}>
              {lineNumbers ? (
                <span className="learning-code-line-number" aria-hidden="true">
                  {lineIndex + 1}
                </span>
              ) : null}
              {items.map((item, itemIndex) => {
                if (item.kind === "code") {
                  return (
                    <span key={itemIndex} className={tokenClassName(item.types)}>
                      {item.content}
                    </span>
                  );
                }
                const annotation = annotationById.get(item.annotationId);
                const isRevealed = revealed.has(item.annotationId);
                const label = annotation
                  ? `${annotation.title}: show explanation`
                  : "Show explanation";
                return (
                  <button
                    key={itemIndex}
                    type="button"
                    className={`code-annotation${
                      isRevealed ? " code-annotation--revealed" : ""
                    }`}
                    aria-label={label}
                    aria-expanded={isRevealed}
                    disabled={interaction?.disabled}
                    onClick={() => interaction?.onRevealAnnotation(item.annotationId)}
                  >
                    {item.parts.map((part, partIndex) => (
                      <span
                        key={partIndex}
                        className={tokenClassName(part.types)}
                      >
                        {part.content}
                      </span>
                    ))}
                  </button>
                );
              })}
            </span>
          ))}
        </code>
      </pre>

      {showCompleteButton ? (
        <button
          type="button"
          className="learning-code-complete"
          onClick={() => interaction?.onComplete?.()}
        >
          Mark as reviewed
        </button>
      ) : null}

      {revealedAnnotations.length > 0 ? (
        <div className="code-annotation-explanations" aria-live="polite">
          {revealedAnnotations.map((annotation) => (
            <section key={annotation.id} className="code-annotation-explanation">
              <h4>{annotation.title}</h4>
              <p>{annotation.explanation}</p>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
