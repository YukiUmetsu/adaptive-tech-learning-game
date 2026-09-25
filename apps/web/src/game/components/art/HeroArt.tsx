/**
 * Animated hero art.
 *
 * Two emergency operators as caped, armored champions — a glowing aura, a
 * raised sword, and a visor. The idle bob and active aura are CSS-driven. Raster
 * hero images can replace these via the sprite pipeline.
 */
export interface HeroArtProps {
  heroId: string;
  active?: boolean;
  size?: number;
  /** Top-left position when nested in another SVG. Defaults to centred. */
  x?: number;
  y?: number;
}

export default function HeroArt({
  heroId,
  active = false,
  size = 52,
  x = -size / 2,
  y = -size / 2,
}: HeroArtProps) {
  const glowId = `hero-glow-${heroId}`;
  return (
    <svg
      className={`hero-art${active ? " is-active" : ""}`}
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="-26 -26 52 52"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor={heroId === "sre" ? "#fbbf24" : "#38bdf8"} stopOpacity={active ? 0.55 : 0.32} />
          <stop offset="100%" stopColor={heroId === "sre" ? "#fbbf24" : "#38bdf8"} stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx={0} cy={25} rx={14} ry={4} fill="rgba(0,0,0,0.45)" />
      <circle cx={0} cy={0} r={24} fill={`url(#${glowId})`} />
      {active ? (
        <circle className="hero-aura" r={23} fill="none" stroke={heroId === "sre" ? "#fbbf24" : "#38bdf8"} strokeWidth={2} />
      ) : null}

      <g className="hero-art-bob">
        {heroId === "sre" ? <SreChampion active={active} /> : <EngineerChampion active={active} />}
      </g>
    </svg>
  );
}

function EngineerChampion({ active }: { active: boolean }) {
  const accent = "#38bdf8";
  const visor = active ? "#fef9c3" : "#bae6fd";
  const glow = "#e0f2fe";
  return (
    <g>
      {/* cape */}
      <path d="M-9,-9 C-17,-2 -16,14 -6,20 L-2,12 L0,20 L3,12 L7,20 C15,12 15,-2 8,-9 Z" fill="#0e2a4a" stroke="#1d4ed8" strokeWidth={1.2} />
      {/* legs */}
      <path d="M-6,8 L-8,21 L-3,21 L-1,9 Z" fill="#16233d" stroke={accent} strokeWidth={1.4} />
      <path d="M6,8 L8,21 L3,21 L1,9 Z" fill="#16233d" stroke={accent} strokeWidth={1.4} />
      {/* torso */}
      <path d="M-9,-4 L9,-4 L8,9 L-8,9 Z" fill="#16233d" stroke={accent} strokeWidth={1.8} />
      <path d="M-5,-3 L0,3 L5,-3" fill="none" stroke={glow} strokeWidth={1.4} />
      {/* pauldrons */}
      <path d="M-10,-5 L-15,-1 L-11,3 Z" fill={accent} />
      <path d="M10,-5 L15,-1 L11,3 Z" fill={accent} />
      {/* head */}
      <circle cx={0} cy={-12} r={7} fill="#20304f" stroke={accent} strokeWidth={1.8} />
      <path d="M-9,-13 A9,9 0 0 1 9,-13 Z" fill={accent} opacity={0.95} />
      <path d="M-6,-11 L6,-11" stroke={visor} strokeWidth={2.4} strokeLinecap="round" />
      {/* raised sword */}
      <g transform="rotate(-18 11 -6)">
        <line x1={11} y1={-6} x2={20} y2={-24} stroke={glow} strokeWidth={3.4} strokeLinecap="round" />
        <line x1={11} y1={-6} x2={20} y2={-24} stroke="#ffffff" strokeWidth={1.2} strokeLinecap="round" />
        <line x1={7} y1={-8} x2={15} y2={-4} stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
        <circle cx={11} cy={-6} r={2.2} fill={glow} />
      </g>
    </g>
  );
}

function SreChampion({ active }: { active: boolean }) {
  const accent = "#fbbf24";
  const visor = active ? "#fef3c7" : "#fde68a";
  const glow = "#fef9c3";
  return (
    <g>
      <path d="M-9,-9 C-17,-2 -16,14 -6,20 L-2,12 L0,20 L3,12 L7,20 C15,12 15,-2 8,-9 Z" fill="#3a2c07" stroke="#b45309" strokeWidth={1.2} />
      <path d="M-6,8 L-8,21 L-3,21 L-1,9 Z" fill="#2b2410" stroke={accent} strokeWidth={1.4} />
      <path d="M6,8 L8,21 L3,21 L1,9 Z" fill="#2b2410" stroke={accent} strokeWidth={1.4} />
      <path d="M-10,-4 L10,-4 L8,9 L-8,9 Z" fill="#2b2410" stroke={accent} strokeWidth={1.8} />
      <path d="M-4,-3 L-4,7 M0,-3 L0,7 M4,-3 L4,7" stroke={accent} strokeWidth={1.2} />
      <path d="M-11,-5 L-16,-1 L-11,3 Z" fill={accent} />
      <path d="M11,-5 L16,-1 L11,3 Z" fill={accent} />
      <circle cx={0} cy={-12} r={7.4} fill="#3a3013" stroke={accent} strokeWidth={1.8} />
      <path d="M-9.5,-13 A9.5,9.5 0 0 1 9.5,-13 Z" fill={accent} opacity={0.95} />
      <path d="M-6,-11 L6,-11" stroke={visor} strokeWidth={2.4} strokeLinecap="round" />
      {/* raised greatsword */}
      <g transform="rotate(-14 11 -6)">
        <line x1={11} y1={-6} x2={22} y2={-25} stroke={glow} strokeWidth={4} strokeLinecap="round" />
        <line x1={11} y1={-6} x2={22} y2={-25} stroke="#ffffff" strokeWidth={1.4} strokeLinecap="round" />
        <line x1={6} y1={-9} x2={16} y2={-3} stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
        <circle cx={11} cy={-6} r={2.4} fill={glow} />
      </g>
    </g>
  );
}
