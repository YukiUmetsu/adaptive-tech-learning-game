/**
 * Adversary emblems.
 *
 * A distinct, neon line-art sigil per recurring adversary so the Threat Intel
 * dossier reads as a roster of named characters rather than text. Drawn centred
 * on the origin (~radius 30) to sit inside a circular medallion. Purely
 * decorative: callers mark the wrapper `aria-hidden`.
 */

/** Accent colour per adversary, matching the adversary data. */
const ADVERSARY_COLORS: Record<string, string> = {
  "ghost-7": "#a78bfa",
  null: "#38bdf8",
  viper: "#f87171",
};

export interface AdversaryArtProps {
  adversaryId: string;
  size?: number;
}

export default function AdversaryArt({
  adversaryId,
  size = 56,
}: AdversaryArtProps) {
  const accent = ADVERSARY_COLORS[adversaryId] ?? "#94a3b8";
  return (
    <svg
      className="adversary-art"
      width={size}
      height={size}
      viewBox="-32 -32 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {adversaryId === "ghost-7" ? (
        <GhostSeven accent={accent} />
      ) : adversaryId === "null" ? (
        <NullEmblem accent={accent} />
      ) : adversaryId === "viper" ? (
        <ViperEmblem accent={accent} />
      ) : (
        <circle r={22} fill="none" stroke={accent} strokeWidth={2} />
      )}
    </svg>
  );
}

/** GHOST-7: a hooded identity thief with a keyhole and a "7" rune. */
function GhostSeven({ accent }: { accent: string }) {
  return (
    <g>
      <path
        d="M-15,20 C-18,2 -11,-16 0,-16 C11,-16 18,2 15,20 Z"
        fill="#1a1330"
        stroke={accent}
        strokeWidth={2}
      />
      <path
        d="M-9,-2 L9,-2 L7,10 L-7,10 Z"
        fill="#0c0a1a"
        stroke={accent}
        strokeWidth={1.2}
      />
      <path
        d="M-7,-1 L7,-1"
        stroke="#ede9fe"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      {/* keyhole: a stolen credential */}
      <circle cx={0} cy={13} r={3.4} fill="none" stroke={accent} strokeWidth={2} />
      <path d="M0,15 L0,20" stroke={accent} strokeWidth={2} strokeLinecap="round" />
      <text
        x={15}
        y={-12}
        fontSize={12}
        fontWeight={800}
        fill={accent}
        textAnchor="middle"
      >
        7
      </text>
    </g>
  );
}

/** NULL: a void pointer — broken ring, slash, and a hex rune. */
function NullEmblem({ accent }: { accent: string }) {
  return (
    <g>
      <circle r={18} fill="none" stroke={accent} strokeWidth={2} />
      <line
        x1={-13}
        y1={13}
        x2={13}
        y2={-13}
        stroke={accent}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <text
        x={0}
        y={5}
        fontSize={11}
        fontWeight={800}
        fill={accent}
        textAnchor="middle"
      >
        0x0
      </text>
      {/* glitch fragments */}
      <rect x={-24} y={-7} width={6} height={3} fill={accent} opacity={0.75} />
      <rect x={18} y={6} width={7} height={3} fill={accent} opacity={0.75} />
      <rect x={-3} y={-25} width={3} height={6} fill={accent} opacity={0.75} />
    </g>
  );
}

/** VIPER: a fanged snake head over a padlock — impact and recovery. */
function ViperEmblem({ accent }: { accent: string }) {
  return (
    <g>
      <path
        d="M-16,10 L-8,-15 L8,-15 L16,10 L0,4 Z"
        fill="#2a0d10"
        stroke={accent}
        strokeWidth={2}
      />
      <path d="M-8,-4 L-2,-6 L-3,1 Z" fill="#fca5a5" />
      <path d="M8,-4 L2,-6 L3,1 Z" fill="#fca5a5" />
      <path
        d="M-5,6 L-5,12 M5,6 L5,12"
        stroke="#fca5a5"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* ransomware padlock */}
      <g transform="translate(0 19)">
        <rect
          x={-6}
          y={-2}
          width={12}
          height={9}
          rx={2}
          fill="#3a1010"
          stroke={accent}
          strokeWidth={1.6}
        />
        <path
          d="M-3,-2 V-4 a3,3 0 0 1 6 0 v2"
          fill="none"
          stroke={accent}
          strokeWidth={1.6}
        />
      </g>
    </g>
  );
}
