/**
 * Sprite registry (hybrid art pipeline).
 *
 * The game ships with hand-authored vector art so it looks complete today. When
 * custom raster art is ready, set `src` here (files live in
 * `apps/web/public/game/`) and the board will render the image instead of the
 * vector fallback — no engine or component changes required.
 *
 * Sprite sheets declare `frameWidth`/`frameHeight`/`frames`/`fps` so the
 * animation layer can play them; single images leave those unset.
 */

export interface SpriteEntry {
  /** Public URL, e.g. "/game/towers/waf.png". Omit to use vector art. */
  src?: string;
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
  fps?: number;
  loop?: boolean;
}

const DEFENSE_IDS = [
  "waf",
  "rate_limiter",
  "traffic_analyzer",
  "traffic_blocker",
  "input_validation",
  "parameterized_queries",
  "xss_protection",
  "mfa",
  "least_privilege",
  "monitoring",
  "backup",
] as const;

const ATTACK_TYPES = [
  "ddos",
  "sql_injection",
  "xss",
  "credential_stuffing",
  "ransomware",
  "prompt_injection",
] as const;

/** Start with all entries empty: vector art renders until a `src` is added. */
export const GAME_SPRITES: Record<string, SpriteEntry> = {
  ...Object.fromEntries(DEFENSE_IDS.map((id) => [`tower:${id}`, {}])),
  ...Object.fromEntries(
    ATTACK_TYPES.map((id) => [`enemy:${id}`, {}]),
  ),
  "enemy:boss": {},
  "board:core": {},
  "board:core-damaged": {},
  "board:background": {},
  "ui:banner-wave": {},
  "ui:banner-boss": {},
};

export function spriteFor(key: string): SpriteEntry | undefined {
  return GAME_SPRITES[key];
}

/** Whether a real image is registered for this key. */
export function hasSprite(key: string): boolean {
  return Boolean(GAME_SPRITES[key]?.src);
}

/** Tower sprite key for a defense id. */
export function towerSpriteKey(defenseId: string): string {
  return `tower:${defenseId}`;
}

/** Enemy sprite key for an attack type (bosses use a dedicated key). */
export function enemySpriteKey(attackType: string, boss: boolean): string {
  return boss ? "enemy:boss" : `enemy:${attackType}`;
}
