import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { GlossaryTerm } from "../api/types";
import { parseRichText } from "../lib/inlineCode";
import { useGlossary } from "./glossaryContext";

interface InlineTextProps {
  /** Authored text that may contain backtick code terms and glossary terms. */
  text: string;
  /**
   * Overrides the surrounding glossary. Pass `[]` to disable term highlighting
   * inside interactive controls, where a nested button is not valid.
   */
  terms?: readonly GlossaryTerm[];
}

/** Distance kept between the explanation and the viewport edge, in pixels. */
const VIEWPORT_MARGIN = 12;
const POPOVER_MAX_WIDTH = 352;
const POPOVER_GAP = 8;

/** One glossary term with an inline, click-to-open explanation. */
function GlossaryTermText({
  text,
  definition,
}: {
  text: string;
  definition: string;
}) {
  const { registry } = useGlossary();
  const [first, setFirst] = useState(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // Highlight a term only on its first occurrence in the page. Claiming in a
  // layout effect (with release on unmount) keeps it correct under StrictMode's
  // double-invoked effects and avoids a flash before paint.
  useLayoutEffect(() => {
    if (registry.claim(text)) {
      setFirst(true);
      return () => registry.release(text);
    }
    return undefined;
  }, [registry, text]);

  // Keep the explanation inside the viewport, opening upward near the bottom.
  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    const popover = popoverRef.current;
    const width = popover?.offsetWidth || Math.min(POPOVER_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = popover?.offsetHeight ?? 0;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN),
    );

    let top = rect.bottom + POPOVER_GAP;
    if (height > 0 && top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - height - POPOVER_GAP;
      top =
        above >= VIEWPORT_MARGIN
          ? above
          : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    setCoords({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      place();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    // Close on scroll/resize so the fixed placement never drifts.
    const onViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  // Later occurrences stay plain text: one highlight per term per page.
  if (!first) {
    return <>{text}</>;
  }

  return (
    <span className="glossary-term-wrap" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="glossary-term"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {text}
        <span className="glossary-term-icon" aria-hidden="true">
          ⓘ
        </span>
      </button>
      {open ? (
        <span
          ref={popoverRef}
          id={panelId}
          role="note"
          className="glossary-popover"
          style={coords ? { top: coords.top, left: coords.left } : undefined}
        >
          <span className="glossary-popover-term">{text}</span>
          <span className="glossary-popover-definition">{definition}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * Renders authored text, styling backticked spans as inline code terms and
 * highlighting glossary terms as clickable explanations.
 *
 * Text without either convention renders unchanged.
 */
export default function InlineText({ text, terms }: InlineTextProps) {
  const { terms: contextTerms } = useGlossary();
  const activeTerms = terms ?? contextTerms;
  const segments = parseRichText(text, activeTerms);

  if (segments.length === 1 && segments[0].kind === "text") {
    return <>{segments[0].text}</>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "code") {
          return (
            <code key={index} className="inline-code">
              {segment.text}
            </code>
          );
        }
        if (segment.kind === "term") {
          return (
            <GlossaryTermText
              key={index}
              text={segment.text}
              definition={segment.definition}
            />
          );
        }
        return <Fragment key={index}>{segment.text}</Fragment>;
      })}
    </>
  );
}
