import { useMemo, type ReactNode } from "react";

import type {
  LearningTextReveal,
  ProgressiveTextSegment,
} from "../lib/learningElements";
import { deriveProgressiveText, elementId } from "../lib/learningElements";
import InlineText from "./InlineText";

/** Discovery state and callbacks for one progressive text reveal. */
export interface ProgressiveTextInteraction {
  /** Namespaced element ids the learner has already revealed. */
  revealedElementIds: readonly string[];
  /** Reveals one hidden span element. Never scored. */
  onRevealElement: (elementId: string) => void;
  /** Disables interaction while the node is locked or busy. */
  disabled?: boolean;
  /** Whether the prompt is complete (all required spans revealed). */
  complete?: boolean;
  /** Completes a reveal that has no required spans. */
  onComplete?: () => void;
}

interface ProgressiveTextProps {
  reveal: LearningTextReveal;
  interaction?: ProgressiveTextInteraction;
}

/**
 * Renders a sentence with authored spans hidden behind inline reveal controls.
 *
 * The whole sentence is visible from the start; only the authored words or
 * phrases are replaced by a small masked control. Activating a control reveals
 * that phrase and nothing else. Hidden phrases are never rendered before their
 * reveal, so they stay out of the DOM and the accessibility tree.
 *
 * A reveal whose spans are all optional has no required unit to complete; like a
 * code file without required annotations, it completes on an explicit
 * mark-as-reviewed action.
 */
export default function ProgressiveText({
  reveal,
  interaction,
}: ProgressiveTextProps) {
  const segments = useMemo(() => deriveProgressiveText(reveal), [reveal]);
  const revealed = useMemo(
    () => new Set(interaction?.revealedElementIds ?? []),
    [interaction?.revealedElementIds],
  );
  const hiddenOrdinals = useMemo(() => {
    const map = new Map<number, number>();
    let ordinal = 0;
    segments.forEach((segment, index) => {
      if (segment.kind === "span") {
        ordinal += 1;
        map.set(index, ordinal);
      }
    });
    return { map, total: ordinal };
  }, [segments]);

  const disabled = interaction?.disabled ?? false;
  const spans = reveal.progressive_reveal?.spans ?? [];
  const hasRequiredSpans = spans.some((span) => span.required !== false);
  const showCompleteButton =
    !hasRequiredSpans &&
    Boolean(interaction?.onComplete) &&
    !interaction?.complete;

  const renderSegment = (
    segment: ProgressiveTextSegment,
    index: number,
  ): ReactNode => {
    if (segment.kind === "text") {
      return <InlineText key={index} text={segment.text} />;
    }
    const spanId = segment.spanId ?? "";
    if (revealed.has(elementId.span(spanId))) {
      return (
        <span key={index} className="progressive-text-revealed">
          <InlineText text={segment.text} />
        </span>
      );
    }
    const ordinal = hiddenOrdinals.map.get(index) ?? 1;
    const label =
      hiddenOrdinals.total > 1
        ? `Reveal hidden phrase ${ordinal} of ${hiddenOrdinals.total}`
        : "Reveal hidden phrase";
    return (
      <button
        key={index}
        type="button"
        className="progressive-text-reveal"
        aria-label={label}
        aria-expanded={false}
        disabled={disabled}
        onClick={() => interaction?.onRevealElement(elementId.span(spanId))}
      >
        <span className="progressive-text-mask" aria-hidden="true" />
      </button>
    );
  };

  return (
    <>
      <p className="reveal reveal-text progressive-text">
        {segments.map(renderSegment)}
      </p>
      {showCompleteButton ? (
        <button
          type="button"
          className="progressive-text-complete"
          onClick={() => interaction?.onComplete?.()}
        >
          Mark as reviewed
        </button>
      ) : null}
    </>
  );
}
