import type { DefenseDefinition } from "../../models/defense";

/**
 * Tower art: an actual turret on a platform.
 *
 * The platform is static; the turret head rotates to face its target, and the
 * barrel flashes when firing. Drawn centred on the origin (~radius 22) so the
 * board can place it on any build pad. When custom raster art is available the
 * sprite pipeline replaces this without touching the simulation.
 */

const INK = "#0a1322";
const STEEL = "#233650";
const BARREL_LENGTH = 20;

/** Distance from the tower centre to the barrel tip (beam origin). */
export const TOWER_MUZZLE_DISTANCE = BARREL_LENGTH;

export interface TowerArtProps {
  defense: DefenseDefinition;
  level: number;
  /** Turret facing, in radians (0 = +x). */
  angle?: number;
  firing?: boolean;
}

export default function TowerArt({
  defense,
  level,
  angle = 0,
  firing = false,
}: TowerArtProps) {
  const accent = defense.color;
  const upgraded = level > 1;
  const aims = defense.range > 0;
  const degrees = (angle * 180) / Math.PI;

  return (
    <g className="tower-art">
      {/* Platform */}
      <ellipse className="tower-shadow" cx={0} cy={16} rx={22} ry={8} fill="rgba(0,0,0,0.45)" />
      <polygon
        points="0,-21 18,-11 18,11 0,21 -18,11 -18,-11"
        fill={INK}
        stroke={accent}
        strokeWidth={2}
      />
      <polygon
        points="0,-15 13,-8 13,8 0,15 -13,8 -13,-8"
        fill="#0f1c33"
        stroke={STEEL}
        strokeWidth={1.5}
      />
      {upgraded ? (
        <polygon
          points="0,-24 20.8,-12 20.8,12 0,24 -20.8,12 -20.8,-12"
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.5}
          opacity={0.9}
        />
      ) : null}

      {/* Turret body */}
      <ellipse cx={0} cy={0} rx={12} ry={10} fill="#16233d" stroke={STEEL} strokeWidth={1.5} />
      <circle r={10} fill="none" stroke={accent} strokeWidth={1.4} opacity={0.7} />

      {/* Turret head (rotates toward the target) */}
      <g transform={`rotate(${degrees.toFixed(1)})`}>
        {aims ? (
          <>
            <rect
              x={6}
              y={-4.6}
              width={BARREL_LENGTH - 2}
              height={9.2}
              rx={4.6}
              fill={INK}
              stroke={accent}
              strokeWidth={1.8}
            />
            <rect
              x={BARREL_LENGTH + 1}
              y={-3.4}
              width={4.5}
              height={6.8}
              rx={2}
              fill={accent}
            />
          </>
        ) : null}
        <TurretHead id={defense.id} accent={accent} upgraded={upgraded} />
        {firing && aims ? (
          <g className="tower-muzzle">
            <circle cx={BARREL_LENGTH + 5} cy={0} r={6} fill={accent} opacity={0.7} />
            <circle cx={BARREL_LENGTH + 5} cy={0} r={2.8} fill="#ffffff" />
          </g>
        ) : null}
      </g>
    </g>
  );
}

function TurretHead({
  id,
  accent,
  upgraded,
}: {
  id: string;
  accent: string;
  upgraded: boolean;
}) {
  const glow = upgraded ? "#fde68a" : "#e6edf7";
  switch (id) {
    case "waf":
      return (
        <path
          d="M-6,-8 L6,-8 L6,0 C6,4 3,6.5 0,8 C-3,6.5 -6,4 -6,0 Z"
          fill="#12233f"
          stroke={accent}
          strokeWidth={2}
        />
      );
    case "rate_limiter":
      return (
        <g>
          <circle r={8} fill="#12233f" stroke={accent} strokeWidth={2} />
          <line x1={-8} y1={0} x2={8} y2={0} stroke={glow} strokeWidth={1.5} />
          <line x1={0} y1={-8} x2={0} y2={8} stroke={glow} strokeWidth={1.5} />
        </g>
      );
    case "traffic_blocker":
      return (
        <path d="M-9,5 A9,9 0 0 1 9,5 Z" fill="#12233f" stroke={accent} strokeWidth={2} />
      );
    case "traffic_analyzer":
      return (
        <g>
          <path d="M-9,3 Q0,-7 9,3" fill="none" stroke={accent} strokeWidth={2} />
          <line x1={0} y1={3} x2={0} y2={-6} stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <circle cx={0} cy={-6} r={2.6} fill={glow} />
          <circle cx={0} cy={6} r={2} fill={accent} />
        </g>
      );
    case "input_validation":
      return (
        <path d="M-8,-7 L8,-7 L3,0 L3,8 L-3,8 L-3,0 Z" fill="#12233f" stroke={accent} strokeWidth={2} />
      );
    case "parameterized_queries":
      return (
        <g>
          <circle r={8} fill="#12233f" stroke={accent} strokeWidth={2} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line
              key={a}
              x1={Math.cos((a * Math.PI) / 180) * 8}
              y1={Math.sin((a * Math.PI) / 180) * 8}
              x2={Math.cos((a * Math.PI) / 180) * 11}
              y2={Math.sin((a * Math.PI) / 180) * 11}
              stroke={accent}
              strokeWidth={2}
            />
          ))}
          <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={800} fill={glow}>
            {"{}"}
          </text>
        </g>
      );
    case "xss_protection":
      return (
        <g>
          <path d="M-8,3 L8,3 L5,9 L-5,9 Z" fill="#12233f" stroke={accent} strokeWidth={2} />
          <line x1={0} y1={-8} x2={0} y2={3} stroke={accent} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "mfa":
      return (
        <g>
          <rect x={-7} y={-5} width={14} height={11} rx={2} fill="#12233f" stroke={accent} strokeWidth={2} />
          <path d="M-4,-5 A4,4 0 0 1 4,-5" fill="none" stroke={glow} strokeWidth={2} />
          <circle cx={0} cy={0} r={1.8} fill={glow} />
        </g>
      );
    case "least_privilege":
      return (
        <g>
          <circle r={9} fill="#12233f" stroke={accent} strokeWidth={2} />
          <line x1={-9} y1={0} x2={9} y2={0} stroke={accent} strokeWidth={1.6} />
          <line x1={0} y1={-9} x2={0} y2={9} stroke={accent} strokeWidth={1.6} />
        </g>
      );
    case "monitoring":
      return (
        <g>
          <path d="M-9,0 Q0,-8 9,0 Q0,8 -9,0 Z" fill="#12233f" stroke={accent} strokeWidth={2} />
          <circle r={3} fill={accent} />
        </g>
      );
    case "backup":
      return (
        <g>
          <rect x={-9} y={-7} width={18} height={14} rx={2} fill="#12233f" stroke={accent} strokeWidth={2} />
          <path d="M0,-4 L0,3 M-3,0.5 L0,3.5 L3,0.5" fill="none" stroke={glow} strokeWidth={1.6} strokeLinecap="round" />
        </g>
      );
    default:
      return <circle r={7} fill={accent} />;
  }
}
