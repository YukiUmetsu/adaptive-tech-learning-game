import type { AttackType } from "../../models/attack";

/**
 * Hand-authored vector enemy art (neon cyberpunk).
 *
 * Drawn centred on the origin. Attacks read as malware creatures with distinct
 * silhouettes so the player can tell threats apart at a glance, while the
 * underlying security lesson stays accurate.
 */

const INK = "#081120";

const ENEMY_COLORS: Record<AttackType, string> = {
  ddos: "#38bdf8",
  sql_injection: "#fbbf24",
  xss: "#f472b6",
  credential_stuffing: "#a78bfa",
  ransomware: "#f87171",
  prompt_injection: "#34d399",
};

export interface EnemyArtProps {
  attackType: AttackType;
  boss?: boolean;
}

export default function EnemyArt({ attackType, boss = false }: EnemyArtProps) {
  if (boss) {
    return <BossArt />;
  }
  const accent = ENEMY_COLORS[attackType];
  return (
    <g className="enemy-art">
      <Body attackType={attackType} accent={accent} />
      <Eyes accent={accent} />
    </g>
  );
}

function Eyes({ accent }: { accent: string }) {
  return (
    <g>
      <circle cx={-3.5} cy={-2} r={2.1} fill={INK} />
      <circle cx={3.5} cy={-2} r={2.1} fill={INK} />
      <circle cx={-3.2} cy={-2.2} r={0.9} fill={accent} />
      <circle cx={3.8} cy={-2.2} r={0.9} fill={accent} />
    </g>
  );
}

function Body({ attackType, accent }: { attackType: AttackType; accent: string }) {
  switch (attackType) {
    case "ddos":
      return (
        <g>
          <circle cx={0} cy={0} r={11} fill="#0f2440" stroke={accent} strokeWidth={2} />
          <path
            d="M-11,0 Q0,-9 11,0 Q0,9 -11,0 Z"
            fill="none"
            stroke={accent}
            strokeWidth={1.4}
            opacity={0.7}
          />
          <circle cx={-8} cy={7} r={4} fill="#0f2440" stroke={accent} strokeWidth={1.6} />
          <circle cx={8} cy={7} r={4} fill="#0f2440" stroke={accent} strokeWidth={1.6} />
        </g>
      );
    case "sql_injection":
      return (
        <g>
          <ellipse cx={0} cy={1} rx={11} ry={8} fill="#3a2c07" stroke={accent} strokeWidth={2} />
          <path d="M-11,1 Q0,-8 11,1" fill="none" stroke={accent} strokeWidth={1.6} />
          <path d="M-9,5 Q0,9 9,5" fill="none" stroke={accent} strokeWidth={1.2} opacity={0.7} />
          <rect x={-6} y={-4} width={12} height={4} rx={2} fill={INK} opacity={0.85} />
        </g>
      );
    case "xss":
      return (
        <g>
          <path d="M-9,-6 L-13,-10 M9,-6 L13,-10 M-10,1 L-14,1 M10,1 L14,1 M-9,7 L-13,11 M9,7 L13,11" stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <circle cx={0} cy={0} r={9} fill="#3a1030" stroke={accent} strokeWidth={2} />
          <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={800} fill="#ffe4f3">
            {"</>"}
          </text>
        </g>
      );
    case "credential_stuffing":
      return (
        <g>
          <path
            d="M-9,10 C-9,1 -4,-6 0,-6 C4,-6 9,1 9,10 Z"
            fill="#241a45"
            stroke={accent}
            strokeWidth={2}
          />
          <rect x={-6} y={-3} width={12} height={5} rx={1.5} fill={INK} opacity={0.8} />
          <circle cx={4} cy={9} r={3.4} fill="#241a45" stroke={accent} strokeWidth={1.6} />
          <path d="M4,9 L8,13" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      );
    case "ransomware":
      return (
        <g>
          <path d="M-7,-2 A7,7 0 0 1 7,-2" fill="none" stroke={accent} strokeWidth={3} />
          <rect x={-11} y={-2} width={22} height={14} rx={3} fill="#3a1010" stroke={accent} strokeWidth={2} />
          <circle cx={0} cy={4} r={2.6} fill={INK} />
          <line x1={0} y1={6} x2={0} y2={9} stroke={INK} strokeWidth={2} />
        </g>
      );
    case "prompt_injection":
      return (
        <g>
          <rect x={-11} y={-8} width={22} height={16} rx={3} fill="#0c2f28" stroke={accent} strokeWidth={2} />
          <path d="M-7,-3 L-3,0 L-7,3" fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <line x1={-1} y1={3} x2={6} y2={3} stroke={accent} strokeWidth={2} strokeLinecap="round" />
        </g>
      );
  }
}

function BossArt() {
  const accent = "#fbbf24";
  return (
    <g className="enemy-art enemy-art--boss">
      <path
        d="M-20,4 L-24,-10 L-14,-4 L-9,-16 L0,-6 L9,-16 L14,-4 L24,-10 L20,4 Z"
        fill="#3a2c07"
        stroke={accent}
        strokeWidth={2}
      />
      <circle cx={0} cy={6} r={17} fill="#241a05" stroke={accent} strokeWidth={2.5} />
      <circle cx={-6} cy={4} r={4.4} fill="#081120" />
      <circle cx={6} cy={4} r={4.4} fill="#081120" />
      <circle cx={-5} cy={3.4} r={1.6} fill="#f87171" />
      <circle cx={7} cy={3.4} r={1.6} fill="#f87171" />
      <path d="M-7,15 L-3,11 L0,15 L3,11 L7,15" fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
      <path d="M-17,-2 L-22,-8 M17,-2 L22,-8" stroke={accent} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}
