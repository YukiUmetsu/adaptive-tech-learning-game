import { GAME_CATALOG } from "../../data";
import CoreArt from "../art/CoreArt";
import EnemyArt from "../art/EnemyArt";
import TowerArt from "../art/TowerArt";

/**
 * Decorative "command center" scene for the hub hero.
 *
 * Reuses the in-game vector art (turrets, malware creatures, the protected
 * core) so the dashboard reads as the same product as the board. Purely
 * presentational: hidden from assistive tech, and animations collapse under
 * `prefers-reduced-motion` via CSS.
 */
const ENEMIES: Array<{ type: "ddos" | "sql_injection" | "xss"; x: number }> = [
  { type: "ddos", x: 40 },
  { type: "sql_injection", x: 92 },
  { type: "xss", x: 144 },
];

const TOWERS: Array<{ id: string; x: number; y: number }> = [
  { id: "waf", x: 224, y: 70 },
  { id: "traffic_blocker", x: 224, y: 156 },
  { id: "mfa", x: 276, y: 113 },
];

export default function HubScene() {
  return (
    <svg className="cyber-hub-scene" viewBox="0 0 360 226" focusable="false">
      <path className="cyber-hub-lane" d="M0,113 H318" />
      <path className="cyber-hub-flow" d="M0,113 H318" />

      {ENEMIES.map((enemy, index) => (
        <g key={enemy.type} transform={`translate(${enemy.x} 113)`}>
          <g
            className="cyber-hub-enemy"
            style={{ animationDelay: `${index * 0.4}s` }}
          >
            <EnemyArt attackType={enemy.type} />
          </g>
        </g>
      ))}

      {TOWERS.map((tower, index) => {
        const defense = GAME_CATALOG.defensesById[tower.id];
        if (!defense) {
          return null;
        }
        return (
          <g key={tower.id} transform={`translate(${tower.x} ${tower.y})`}>
            <g
              className="cyber-hub-tower"
              style={{ animationDelay: `${index * 0.25}s` }}
            >
              <TowerArt defense={defense} level={1} angle={Math.PI} />
            </g>
          </g>
        );
      })}

      <g transform="translate(330 113)">
        <g className="cyber-hub-core">
          <CoreArt integrity={1} />
        </g>
      </g>
    </svg>
  );
}
