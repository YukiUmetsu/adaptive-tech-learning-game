import { memo } from "react";

interface AnimatedCheckProps {
  /** Pixel size of the square SVG. */
  size?: number;
  className?: string;
  /** Accessible label; pass `null` when the parent already announces success. */
  label?: string | null;
}

/**
 * A drawn checkmark used to celebrate a correct answer or a completed step.
 *
 * The mark animates by stroking itself on (CSS `stroke-dashoffset`). Under
 * reduced motion the final state is shown immediately, so the component is
 * always equally informative.
 */
function AnimatedCheck({
  size = 30,
  className,
  label = "Correct",
}: AnimatedCheckProps) {
  return (
    <svg
      className={`animated-check${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <circle className="animated-check-ring" cx="16" cy="16" r="13.5" />
      <path className="animated-check-mark" d="M9.5 16.8 L14 21.2 L22.5 11.2" />
    </svg>
  );
}

export default memo(AnimatedCheck);
