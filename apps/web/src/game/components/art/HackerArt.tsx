/**
 * "Bad hacker" icon at the attacker spawn. Deliberately menacing: jagged hood,
 * horns, angry slanted glowing eyes, fanged grin, and a red aura. Drawn centred
 * on the origin (~radius 20).
 */
export default function HackerArt() {
  return (
    <g className="hacker-art">
      {/* menacing aura */}
      <circle className="hacker-aura" r={22} fill="none" stroke="#ef4444" strokeWidth={2} />

      {/* horns */}
      <path d="M-8,-13 L-13,-22 L-4,-16 Z" fill="#7f1d1d" stroke="#f87171" strokeWidth={1.4} />
      <path d="M8,-13 L13,-22 L4,-16 Z" fill="#7f1d1d" stroke="#f87171" strokeWidth={1.4} />

      {/* jagged hood */}
      <path
        d="M-16,14 L-19,0 L-12,-11 L-9,-15 L-4,-13 L0,-19 L4,-13 L9,-15 L12,-11 L19,0 L16,14 Z"
        fill="#160a12"
        stroke="#ef4444"
        strokeWidth={2}
      />

      {/* shadowed face */}
      <path d="M-10,1 L10,1 L8,11 L-8,11 Z" fill="#2a0b12" stroke="#b91c1c" strokeWidth={1.4} />

      {/* angry glowing eyes */}
      <path d="M-8,2 L-2,0 L-3,5 Z" fill="#fca5a5" />
      <path d="M8,2 L2,0 L3,5 Z" fill="#fca5a5" />
      <circle className="hacker-eye" cx={-4.4} cy={2.4} r={1} fill="#fff" />
      <circle className="hacker-eye" cx={4.4} cy={2.4} r={1} fill="#fff" />

      {/* fanged grin */}
      <path
        d="M-6,8 L-3,6 L-1,9 L1,6 L3,9 L6,7"
        fill="none"
        stroke="#fca5a5"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M-3,8 L-2.4,10.4 L-1.4,8 Z" fill="#fca5a5" />
      <path d="M1.4,8 L2.4,10.4 L3.4,8 Z" fill="#fca5a5" />
    </g>
  );
}
