/**
 * Tiny inline SVG icons for game chrome.
 *
 * Emoji render inconsistently across platforms (and disappear in some headless
 * environments), so critical HUD glyphs are drawn as vectors. They inherit
 * `currentColor`.
 */
export interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };
}

export function ShieldIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 3 L20 6 V12 C20 17 16.5 20.5 12 22 C7.5 20.5 4 17 4 12 V6 Z" />
    </svg>
  );
}

export function CoinIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5 V16.5 M9.5 9.5 H13 a2 2 0 0 1 0 4 H9.5" />
    </svg>
  );
}

export function BoltIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M13 2 L5 13 H11 L10 22 L19 10 H13 Z" />
    </svg>
  );
}

export function PauseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M7 5 L19 12 L7 19 Z" />
    </svg>
  );
}

export function SkullIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M12 2 C7 2 4 5.5 4 10 V14 L6.5 16 V20 H9.5 V17 H14.5 V20 H17.5 V16 L20 14 V10 C20 5.5 17 2 12 2 Z M9 9 a1.6 1.6 0 1 0 0.01 0 Z M15 9 a1.6 1.6 0 1 0 0.01 0 Z" />
    </svg>
  );
}

export function ClockIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7 V12 L15.5 14" strokeLinecap="round" />
    </svg>
  );
}

export function HelpIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path
        d="M9.5 9.2 A2.6 2.6 0 1 1 12 13 V14.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SwordIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3 L21 3 L21 9.5 L11 19.5 L4.5 13 Z" />
      <path d="M4.5 13 L3 21 L11 19.5" />
      <path d="M9 7 L17 15" />
    </svg>
  );
}

export function TargetIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 1.5 V6 M12 18 V22.5 M1.5 12 H6 M18 12 H22.5" strokeLinecap="round" />
    </svg>
  );
}

export function HourglassIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3 H18 M6 21 H18" />
      <path d="M7 3 V7 L12 12 L17 7 V3" />
      <path d="M7 21 V17 L12 12 L17 17 V21" />
    </svg>
  );
}

export function BackupIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7 V16 C5 17.7 8.1 19 12 19 C15.9 19 19 17.7 19 16 V7" />
      <path d="M12 10 V15 M9.8 12.8 L12 15 L14.2 12.8" />
    </svg>
  );
}
