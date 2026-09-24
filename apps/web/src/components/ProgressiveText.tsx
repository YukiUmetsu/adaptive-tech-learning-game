import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type {
  LearningTextReveal,
  ProgressiveTextSegment,
} from "../lib/learningElements";
import { deriveProgressiveText, elementId } from "../lib/learningElements";
import InlineText from "./InlineText";

/**
 * Measures the rendered width of `text` in `font` using a hidden, off-screen
 * probe. The probe is attached and removed inside a layout effect, so it is
 * never painted and the phrase never persists in the document. Returns 0 when
 * measurement is unavailable (for example under jsdom), so the caller can fall
 * back to a CSS-only width.
 */
function measureTextWidth(text: string, font: string): number {
  if (typeof document === "undefined" || document.body === null) {
    return 0;
  }
  const probe = document.createElement("span");
  probe.textContent = text;
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.pointerEvents = "none";
  if (font) {
    probe.style.font = font;
  }
  document.body.appendChild(probe);
  try {
    const width = probe.getBoundingClientRect().width;
    return Number.isFinite(width) && width > 0 ? width : 0;
  } finally {
    probe.remove();
  }
}

/** Reads the CSS font shorthand of an element, rebuilding it if abbreviated. */
function cssFont(element: Element): string {
  const style = getComputedStyle(element);
  if (style.font) {
    return style.font;
  }
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`.trim();
}

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

  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const spanSegments = useMemo(
    () =>
      segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => segment.kind === "span"),
    [segments],
  );
  // Exact widths of the hidden phrases, keyed by segment index. Measuring the
  // real text keeps the sentence from re-wrapping when a span is revealed; the
  // phrase itself is passed to the canvas, never added to the DOM.
  const [measuredWidths, setMeasuredWidths] = useState<Record<number, number>>(
    {},
  );

  useLayoutEffect(() => {
    const paragraph = paragraphRef.current;
    if (!paragraph || spanSegments.length === 0) {
      return;
    }
    const measure = () => {
      const font = cssFont(paragraph);
      const next: Record<number, number> = {};
      for (const { segment, index } of spanSegments) {
        const width = measureTextWidth(segment.text, font);
        if (width > 0) {
          next[index] = width;
        }
      }
      setMeasuredWidths((current) => {
        const keys = Object.keys(next);
        const unchanged =
          keys.length === Object.keys(current).length &&
          keys.every((key) => current[Number(key)] === next[Number(key)]);
        return unchanged ? current : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    let active = true;
    // Web fonts can resolve after the first paint; re-measure once they settle.
    document.fonts?.ready
      .then(() => {
        if (active) {
          measure();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      window.removeEventListener("resize", measure);
    };
  }, [spanSegments]);

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
    // Reserve space in the sentence equal to the hidden phrase so revealing it
    // never reflows the surrounding prose. The character count seeds a CSS
    // fallback; once measured, the exact pixel width takes over. Neither value
    // exposes the phrase itself.
    const buttonStyle = {
      "--hidden-length": Math.max(segment.text.length, 3),
    } as CSSProperties;
    const measured = measuredWidths[index];
    const maskStyle: CSSProperties | undefined = measured
      ? { width: `${measured}px` }
      : undefined;
    return (
      <button
        key={index}
        type="button"
        className="progressive-text-reveal"
        style={buttonStyle}
        aria-label={label}
        aria-expanded={false}
        disabled={disabled}
        onClick={() => interaction?.onRevealElement(elementId.span(spanId))}
      >
        <span
          className="progressive-text-mask"
          aria-hidden="true"
          style={maskStyle}
        />
      </button>
    );
  };

  return (
    <>
      <p className="reveal reveal-text progressive-text" ref={paragraphRef}>
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
