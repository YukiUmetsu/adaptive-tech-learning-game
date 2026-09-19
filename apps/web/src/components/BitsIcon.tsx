interface BitsIconProps {
  className?: string;
}

/**
 * The Bits motif: a faceted, softly glowing gem.
 *
 * Rendered as an inline SVG so it scales with font size and inherits the
 * surrounding accent color. Purely decorative, so it is hidden from assistive
 * technology.
 */
export default function BitsIcon({ className }: BitsIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2.5 21 9l-9 12.5L3 9z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M12 2.5 21 9l-9 12.5L3 9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M3 9h18M12 2.5 8.4 9l3.6 12.5L15.6 9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}
