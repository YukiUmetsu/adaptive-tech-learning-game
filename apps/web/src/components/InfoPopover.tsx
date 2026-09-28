import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * A small (i) trigger with an anchored info card.
 *
 * Clicking the (i) opens a card above the trigger at a high z-index — no
 * backdrop, no dimming. It closes when the pointer leaves the trigger/card, on
 * Escape, on an outside click, or by clicking the (i) again.
 */
export interface InfoPopoverProps {
  /** Accessible name for the trigger. */
  label: string;
  /** Optional accent colour for the card's edge. */
  accent?: string;
  children: ReactNode;
  /** Custom trigger content. Defaults to the (i) glyph. */
  trigger?: ReactNode;
  /** Extra class on the trigger button. */
  triggerClassName?: string;
  /** Which edge of the trigger the card aligns to. Defaults to `right`. */
  align?: "left" | "right";
}

export default function InfoPopover({
  label,
  accent,
  children,
  trigger,
  triggerClassName,
  align = "right",
}: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const rootRef = useRef<HTMLSpanElement>(null);
  const cardId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    // Flip below when there is not enough room above the trigger.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPlacement(rect.top < 340 ? "bottom" : "top");
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span
      className="game-popover"
      ref={rootRef}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={[
          "game-popover-trigger",
          trigger ? "game-popover-trigger--custom" : "",
          triggerClassName ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? "i"}
      </button>
      {open ? (
        <span
          className={`game-popover-panel game-popover-panel--${placement}${
            align === "left" ? " game-popover-panel--left" : ""
          }`}
        >
          <span
            id={cardId}
            className="game-popover-card"
            role="tooltip"
            style={{ "--accent": accent ?? "var(--accent)" } as CSSProperties}
          >
            {children}
          </span>
        </span>
      ) : null}
    </span>
  );
}
