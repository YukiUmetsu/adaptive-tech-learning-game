import { spriteFor } from "./sprites";

/**
 * Renders a registered sprite image, or nothing when the entry has no `src`
 * (in which case the caller draws its vector fallback).
 */
export interface SpriteProps {
  spriteKey: string;
  /** Centre x in the parent SVG's user units. */
  x: number;
  /** Centre y in the parent SVG's user units. */
  y: number;
  width: number;
  height: number;
}

export default function Sprite({ spriteKey, x, y, width, height }: SpriteProps) {
  const entry = spriteFor(spriteKey);
  if (!entry?.src) {
    return null;
  }
  return (
    <image
      href={entry.src}
      x={x - width / 2}
      y={y - height / 2}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
