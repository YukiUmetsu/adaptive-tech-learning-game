/**
 * The protected asset: a database core inside a shield ring. Drawn centred on
 * the origin (~radius 34). Integrity drives the shield colour and cracks.
 */
export interface CoreArtProps {
  /** 0..1 remaining system health. */
  integrity: number;
}

export default function CoreArt({ integrity }: CoreArtProps) {
  const healthy = Math.max(0, Math.min(1, integrity));
  const color = healthy > 0.6 ? "#34d399" : healthy > 0.3 ? "#fbbf24" : "#f87171";
  const cracked = healthy <= 0.45;
  return (
    <g className="core-art">
      <circle r={34} fill="none" stroke={color} strokeWidth={2} opacity={0.35} />
      <circle r={27} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="7 6" opacity={0.7} />
      <g>
        <ellipse cx={0} cy={-12} rx={17} ry={7} fill="#0f2440" stroke={color} strokeWidth={2} />
        <path d="M-17,-12 L-17,10 A17,7 0 0 0 17,10 L17,-12" fill="#0c1c33" stroke={color} strokeWidth={2} />
        <ellipse cx={0} cy={-2} rx={17} ry={7} fill="none" stroke={color} strokeWidth={1.4} opacity={0.6} />
        <ellipse cx={0} cy={6} rx={17} ry={7} fill="none" stroke={color} strokeWidth={1.4} opacity={0.4} />
      </g>
      {cracked ? (
        <path
          d="M-10,-16 L-4,-8 L-9,-2 L-2,4 L-6,12"
          fill="none"
          stroke="#fca5a5"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ) : null}
    </g>
  );
}
