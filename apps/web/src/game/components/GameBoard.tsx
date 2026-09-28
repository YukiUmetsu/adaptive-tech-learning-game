import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { AttackDefinition } from "../models/attack";
import type { DefenseDefinition, PlacedDefense } from "../models/defense";
import type { HeroUnit } from "../models/hero";
import type { MissionMap } from "../models/map";
import type { GameCatalog } from "../data";
import { layoutMap, type MapOrientation } from "../engine/layout";
import { computePath } from "../engine/pathing";
import {
  GATE_QUEUE_RANGE,
  type EnemyState,
  type Engagement,
  type GameEffect,
  type HeroEngagement,
} from "../engine/simulation";
import {
  buildMapRoadGeometry,
  buildRoadPads,
  edgePoint,
  nearestEdgeAnchor,
  pathPoint,
  pathPointAt,
  type Point,
  type RoadPad,
} from "../engine/roadGeometry";
import { canPlaceDefense } from "../engine/combat";
import { attackLabel, attackTone } from "../lib/format";
import { hasSprite, towerSpriteKey, enemySpriteKey } from "../assets/sprites";
import Sprite from "../assets/Sprite";
import CoreArt from "./art/CoreArt";
import EnemyArt from "./art/EnemyArt";
import TowerArt, { TOWER_MUZZLE_DISTANCE } from "./art/TowerArt";
import HackerArt from "./art/HackerArt";
import AdversaryArt from "./art/AdversaryArt";
import HeroArt from "./art/HeroArt";

/**
 * The game board.
 *
 * Every edge of the architecture graph is drawn, so a branching map visibly
 * splits and merges. Each attack is positioned by its own logical `enemy.path`
 * (never by another attack's target), which keeps the renderer and the
 * simulation in agreement about which route an attack is on. Rendering is
 * driven by the pure simulation's `engagements` and `effects`.
 */

export const ENEMY_RENDER_CAP = 26;

const BOARD_LAYOUT = {
  horizontal: { layerSpacing: 290, nodeSpacing: 132, margin: 150, stagger: 46 },
  vertical: { layerSpacing: 200, nodeSpacing: 132, margin: 140, stagger: 44 },
};

/** Enemy inspection callout geometry (SVG user units on the board). */
const CALLOUT_WIDTH = 212;
const CALLOUT_PAD = 9;
const CALLOUT_LINE = 12.5;
const CALLOUT_TITLE_BLOCK = 30;
const CALLOUT_STAT_BLOCK = 18;
/** Tallest possible callout, used to decide whether it fits above an attack. */
const CALLOUT_MAX_HEIGHT =
  CALLOUT_PAD * 2 + CALLOUT_TITLE_BLOCK + 3 * CALLOUT_LINE + CALLOUT_STAT_BLOCK;

/** Greedy word wrap for SVG text, which cannot wrap on its own. */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

interface EnemyCalloutProps {
  attack?: AttackDefinition;
  attackType: EnemyState["attackType"];
  hidden: boolean;
  boss: boolean;
  health: number;
  maxHealth: number;
  systemDamage: number;
  radius: number;
  offsetX: number;
  side: "above" | "below";
}

/**
 * Persistent info card shown above a tapped attack until it is destroyed.
 *
 * Answers "what kind of attack is this?" without pausing the wave: the selected
 * enemy keeps its callout as it travels, and the caller drops the card once the
 * attack is gone. Hidden attacks stay unidentified until Detection is online.
 */
function EnemyCallout({
  attack,
  attackType,
  hidden,
  boss,
  health,
  maxHealth,
  systemDamage,
  radius,
  offsetX,
  side,
}: EnemyCalloutProps) {
  const title = hidden ? "Unknown attack" : (attack?.name ?? attackLabel(attackType));
  const subtitle = hidden
    ? "Hidden threat"
    : `${attackLabel(attackType)}${boss ? " · BOSS" : ""}`;
  const descriptionLines = hidden
    ? ["Deploy Monitoring / IDS to identify hidden attacks."]
    : wrapText(attack?.description ?? "", 40, 3);
  const stat = `${Math.max(0, Math.round(health))} / ${Math.round(
    maxHealth,
  )} HP · Breach ${systemDamage}`;

  const height =
    CALLOUT_PAD * 2 +
    CALLOUT_TITLE_BLOCK +
    descriptionLines.length * CALLOUT_LINE +
    CALLOUT_STAT_BLOCK;
  const left = -CALLOUT_WIDTH / 2;
  const gap = 18;
  const top =
    side === "above" ? -(radius + height + gap) : radius + gap;
  const textX = left + CALLOUT_PAD;
  const titleY = top + CALLOUT_PAD + 12;
  const subtitleY = titleY + 13;
  const statY = top + height - CALLOUT_PAD;
  const boxEdge = side === "above" ? top + height : top;
  const tipY = side === "above" ? boxEdge + 8 : boxEdge - 8;

  return (
    <g
      className="cyber-enemy-callout"
      transform={`translate(${offsetX}, 0)`}
      aria-hidden="true"
    >
      <polygon
        className="cyber-enemy-callout-pointer"
        points={`-6,${boxEdge} 6,${boxEdge} 0,${tipY}`}
      />
      <rect
        className="cyber-enemy-callout-box"
        x={left}
        y={top}
        width={CALLOUT_WIDTH}
        height={height}
        rx={8}
      />
      <text className="cyber-enemy-callout-title" x={textX} y={titleY}>
        {title}
      </text>
      <text className="cyber-enemy-callout-sub" x={textX} y={subtitleY}>
        {subtitle}
      </text>
      {descriptionLines.map((line, index) => (
        <text
          key={line + index}
          className="cyber-enemy-callout-desc"
          x={textX}
          y={subtitleY + CALLOUT_LINE * (index + 1)}
        >
          {line}
        </text>
      ))}
      <text className="cyber-enemy-callout-stat" x={textX} y={statY}>
        {stat}
      </text>
    </g>
  );
}

export interface PadSelection {
  id: string;
  nodeId: string;
  nodeType: string;
  partnerId?: string;
  roadPosition?: number;
  /** Edge the pad belongs to, so a gate only spans one branch. */
  edgeFrom?: string;
  edgeTo?: string;
}

export interface GameBoardProps {
  map: MissionMap;
  orientation: MapOrientation;
  catalog: GameCatalog;
  placed: PlacedDefense[];
  enemies: EnemyState[];
  effects: GameEffect[];
  engagements: Engagement[];
  heroUnits: HeroUnit[];
  heroEngagements: HeroEngagement[];
  selectedPadId: string | null;
  selectedPlacementId: string | null;
  armedDefense: DefenseDefinition | null;
  armedHeroId: string | null;
  detectionActive: boolean;
  primaryTargetNodeId: string | null;
  /** Recurring adversary for Operations; shows its intel emblem at the spawn. */
  adversaryId?: string;
  integrity: number;
  reducedMotion: boolean;
  elapsedMs: number;
  onSelectPad: (pad: PadSelection) => void;
  onSelectPlacement: (placementId: string) => void;
  onDeployHero: (
    heroId: string,
    position: number,
    anchor?: { from: string; to: string; fraction: number },
  ) => void;
}

export default function GameBoard({
  map,
  orientation,
  catalog,
  placed,
  enemies,
  effects,
  engagements,
  heroUnits,
  heroEngagements,
  selectedPadId,
  selectedPlacementId,
  armedDefense,
  armedHeroId,
  detectionActive,
  primaryTargetNodeId,
  adversaryId,
  integrity,
  reducedMotion,
  elapsedMs,
  onSelectPad,
  onSelectPlacement,
  onDeployHero,
}: GameBoardProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(null);
  const spacing = BOARD_LAYOUT[orientation];
  const layout = useMemo(
    () => layoutMap(map, { orientation, ...spacing }),
    [map, orientation, spacing],
  );

  const nodeMeta = useMemo(() => {
    const meta: Record<string, { type: string; label: string }> = {};
    for (const node of map.nodes) {
      meta[node.id] = { type: node.type, label: node.label };
    }
    return meta;
  }, [map]);

  // Graph geometry for every edge. Enemies are placed by their own path, so the
  // renderer never assumes a single "primary" route.
  const geometry = useMemo(
    () => buildMapRoadGeometry(map, layout),
    [map, layout],
  );

  // A reference path (the primary target's route) is only used to render
  // legacy hero units that predate edge anchors, and for the core portal.
  const referencePath = useMemo(
    () => (primaryTargetNodeId ? computePath(map, primaryTargetNodeId).path : []),
    [map, primaryTargetNodeId],
  );

  const pads = useMemo<RoadPad[]>(() => buildRoadPads(geometry), [geometry]);

  const padById = useMemo(() => {
    const byId = new Map<string, RoadPad>();
    for (const pad of pads) {
      byId.set(pad.id, pad);
    }
    return byId;
  }, [pads]);

  const towerMap = useMemo(() => {
    const result: Record<string, { position: Point; angle: number }> = {};
    for (const entry of placed) {
      const pad =
        (entry.padId ? padById.get(entry.padId) : undefined) ??
        pads.find((item) => item.nodeId === entry.nodeId);
      if (pad) {
        result[entry.id] = { position: pad.position, angle: pad.angle };
      }
    }
    return result;
  }, [placed, padById, pads]);

  const enemyById = useMemo(() => {
    const lookup = new Map<string, EnemyState>();
    for (const enemy of enemies) {
      lookup.set(enemy.id, enemy);
    }
    return lookup;
  }, [enemies]);

  // Clear the inspection callout once its attack is destroyed (or re-rendered
  // away). The callout is tied to a live enemy, so a stale id must not linger.
  useEffect(() => {
    if (selectedEnemyId && !enemyById.has(selectedEnemyId)) {
      setSelectedEnemyId(null);
    }
  }, [enemyById, selectedEnemyId]);

  const toggleEnemy = (enemyId: string) => {
    setSelectedEnemyId((previous) => (previous === enemyId ? null : enemyId));
  };

  const gateQueue = useMemo(
    () =>
      placed
        .filter((entry) => entry.gate && entry.gatePosition !== undefined)
        .map((entry) => ({
          id: entry.id,
          position: entry.gatePosition as number,
        })),
    [placed],
  );

  /** Spread queued swarm attacks to the left and right of a gate opening. */
  const queuedPoint = (enemy: EnemyState, base: Point): Point => {
    if (gateQueue.length === 0) {
      return base;
    }
    const position = enemy.pathIndex + enemy.progress;
    for (const gate of gateQueue) {
      if (enemy.admittedGates?.includes(gate.id)) {
        continue;
      }
      if (position >= gate.position) {
        continue;
      }
      if (gate.position - position > GATE_QUEUE_RANGE) {
        continue;
      }
      const seed = hashId(enemy.id);
      const side = seed % 2 === 0 ? 1 : -1;
      const lateral = 15 + (seed % 4) * 7;
      const back = 6 + (seed % 3) * 7;
      const behind =
        pathPointAt(geometry, enemy.path, Math.max(0, position - 0.04)) ?? base;
      const ahead = pathPointAt(geometry, enemy.path, position + 0.04) ?? base;
      const dx = ahead.x - behind.x;
      const dy = ahead.y - behind.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      return {
        x: base.x + nx * lateral * side - (dx / length) * back,
        y: base.y + ny * lateral * side - (dy / length) * back,
      };
    }
    return base;
  };

  const anchorFromEvent = (
    clientX: number,
    clientY: number,
  ): { from: string; to: string; fraction: number } | null => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    try {
      const ctm = svg.getScreenCTM();
      if (!ctm) {
        return null;
      }
      const local = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      const nearest = nearestEdgeAnchor(geometry, { x: local.x, y: local.y });
      return nearest ? nearest.anchor : null;
    } catch {
      return null;
    }
  };

  const handleHeroDrop = (event: React.DragEvent<SVGSVGElement>) => {
    const heroId =
      event.dataTransfer?.getData("text/plain") || armedHeroId || "";
    if (!heroId) {
      return;
    }
    event.preventDefault();
    const anchor = anchorFromEvent(event.clientX, event.clientY);
    if (anchor) {
      onDeployHero(heroId, anchor.fraction, anchor);
    }
  };

  const handleBoardClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!armedHeroId) {
      // Tapping empty board dismisses an open enemy inspection callout.
      setSelectedEnemyId(null);
      return;
    }
    const anchor = anchorFromEvent(event.clientX, event.clientY);
    if (anchor) {
      onDeployHero(armedHeroId, anchor.fraction, anchor);
    }
  };

  const rangePreview = useMemo(() => {
    const preview = (range: number, color: string, center: Point) => ({
      x: center.x,
      y: center.y,
      radius: range * spacing.layerSpacing,
      color,
    });
    if (selectedPlacementId) {
      const entry = placed.find((item) => item.id === selectedPlacementId);
      const defense = entry && catalog.defensesById[entry.defenseId];
      const tower = entry && towerMap[entry.id];
      if (entry && defense && tower && defense.range > 0) {
        return preview(defense.range, defense.color, tower.position);
      }
      return null;
    }
    if (armedDefense && selectedPadId && armedDefense.range > 0) {
      const pad = padById.get(selectedPadId);
      if (pad) {
        return preview(armedDefense.range, armedDefense.color, pad.position);
      }
    }
    return null;
  }, [
    selectedPlacementId,
    armedDefense,
    selectedPadId,
    placed,
    catalog,
    towerMap,
    padById,
    spacing,
  ]);

  const renderedEnemies = enemies.slice(0, ENEMY_RENDER_CAP);
  const capped = enemies.length > ENEMY_RENDER_CAP;
  const start = geometry.positions[map.entryNodeId] ?? null;
  const firstEdge = geometry.edgeOrder
    .map((key) => geometry.edges[key])
    .find((edge) => edge.from === map.entryNodeId);
  const startTangent = firstEdge
    ? normalize({
        x: firstEdge.points[1].x - firstEdge.points[0].x,
        y: firstEdge.points[1].y - firstEdge.points[0].y,
      })
    : { x: 1, y: 0 };
  const corePosition = primaryTargetNodeId
    ? layout.positions[primaryTargetNodeId]
    : null;

  return (
    <svg
      ref={svgRef}
      className={`cyber-map${armedHeroId ? " is-deploying" : ""}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Defense map. Tap a tower pad, tap an attack to inspect it, or drag a hero onto the road."
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={handleHeroDrop}
      onClick={handleBoardClick}
    >
      {/* Architecture: every graph edge is drawn, so branches are visible. */}
      {geometry.edgeOrder.map((key) => {
        const edge = geometry.edges[key];
        const points = edge.points.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <g key={key} className="cyber-road-group">
            <polyline className="cyber-road-edge" points={points} />
            <polyline className="cyber-road" points={points} />
            <polyline
              className={`cyber-road-line${reducedMotion ? " is-static" : ""}`}
              points={points}
            />
          </g>
        );
      })}

      {/* Rate-limiter gates: a barrier across the road with a small opening */}
      {placed.map((entry) => {
        if (!entry.gate || !entry.padId || !entry.gatePartnerPadId) {
          return null;
        }
        const a = padById.get(entry.padId);
        const b = padById.get(entry.gatePartnerPadId);
        if (!a || !b) {
          return null;
        }
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        const mid = {
          x: (a.position.x + b.position.x) / 2,
          y: (a.position.y + b.position.y) / 2,
        };
        const gap = 13;
        const gapA = { x: mid.x - ux * gap, y: mid.y - uy * gap };
        const gapB = { x: mid.x + ux * gap, y: mid.y + uy * gap };
        return (
          <g key={`gate-${entry.id}`} className="cyber-gate" aria-hidden="true">
            <line
              className="cyber-gate-bar"
              x1={a.position.x}
              y1={a.position.y}
              x2={gapA.x}
              y2={gapA.y}
            />
            <line
              className="cyber-gate-bar"
              x1={gapB.x}
              y1={gapB.y}
              x2={b.position.x}
              y2={b.position.y}
            />
            <circle className="cyber-gate-post" cx={a.position.x} cy={a.position.y} r={7} />
            <circle className="cyber-gate-post" cx={b.position.x} cy={b.position.y} r={7} />
          </g>
        );
      })}

      {rangePreview ? (
        <g className="cyber-range-preview" aria-hidden="true">
          <ellipse
            cx={rangePreview.x}
            cy={rangePreview.y}
            rx={orientation === "horizontal" ? rangePreview.radius : 72}
            ry={orientation === "horizontal" ? 72 : rangePreview.radius}
            className="cyber-range-fill"
            style={{ "--range-color": rangePreview.color } as CSSProperties}
          />
          <ellipse
            cx={rangePreview.x}
            cy={rangePreview.y}
            rx={orientation === "horizontal" ? rangePreview.radius : 72}
            ry={orientation === "horizontal" ? 72 : rangePreview.radius}
            className="cyber-range-ring"
            style={{ "--range-color": rangePreview.color } as CSSProperties}
          />
        </g>
      ) : null}

      {/* Attacker spawn: portal + the adversary's intel emblem (or a generic
          hacker for campaign missions with no named adversary). */}
      {start ? (
        <g
          className="cyber-portal"
          transform={`translate(${start.x}, ${start.y})`}
          aria-hidden="true"
        >
          <circle className="cyber-portal-ring" r={16} />
          <circle className="cyber-portal-core" r={7} />
          <g
            transform={`translate(${-startTangent.x * 44}, ${
              -startTangent.y * 44
            })`}
          >
            {adversaryId ? (
              <g transform="translate(-27 -27)">
                <AdversaryArt adversaryId={adversaryId} size={54} />
              </g>
            ) : (
              <HackerArt />
            )}
          </g>
        </g>
      ) : null}

      {/* Defended core with its layer label */}
      {corePosition ? (
        <g
          className="cyber-core"
          transform={`translate(${corePosition.x}, ${corePosition.y})`}
          aria-hidden="true"
        >
          <g className="cyber-core-badge">
            <CoreArt integrity={integrity} />
          </g>
          {primaryTargetNodeId ? (
            <text className="cyber-core-label" x={0} y={44} textAnchor="middle">
              {nodeMeta[primaryTargetNodeId]?.label ?? "Core"}
            </text>
          ) : null}
        </g>
      ) : null}

      {/* Tower pads */}
      {pads.map((pad, index) => {
        const occupied = placed.some(
          (entry) =>
            entry.padId === pad.id || entry.gatePartnerPadId === pad.id,
        );
        if (occupied) {
          return null;
        }
        const nodeType = nodeMeta[pad.nodeId]?.type ?? "edge";
        const armedFits =
          !!armedDefense && canPlaceDefense(armedDefense, nodeType as never).ok;
        const selected = pad.id === selectedPadId;
        return (
          <g
            key={pad.id}
            className={`cyber-pad${armedFits ? " is-available" : ""}${
              selected ? " is-selected" : ""
            }`}
            transform={`translate(${pad.position.x}, ${pad.position.y})`}
            role="button"
            tabIndex={0}
            aria-label={`Tower pad ${index + 1}`}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedEnemyId(null);
              onSelectPad({
                id: pad.id,
                nodeId: pad.nodeId,
                nodeType,
                partnerId: pad.partnerId,
                roadPosition: pad.roadPosition,
                edgeFrom: pad.edgeFrom,
                edgeTo: pad.edgeTo,
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                setSelectedEnemyId(null);
                onSelectPad({
                  id: pad.id,
                  nodeId: pad.nodeId,
                  nodeType,
                  partnerId: pad.partnerId,
                  roadPosition: pad.roadPosition,
                  edgeFrom: pad.edgeFrom,
                  edgeTo: pad.edgeTo,
                });
              }
            }}
          >
            {/* Enlarged transparent tap target for touch. */}
            <circle className="cyber-pad-hit" r={22} />
            <polygon className="cyber-pad-base" points="0,-20 17.3,-10 17.3,10 0,20 -17.3,10 -17.3,-10" />
            <polygon className="cyber-pad-ring" points="0,-20 17.3,-10 17.3,10 0,20 -17.3,10 -17.3,-10" />
            <text className="cyber-pad-plus" x={0} y={7} textAnchor="middle">
              +
            </text>
          </g>
        );
      })}

      {/* Towers */}
      {placed.map((entry) => {
        const defense = catalog.defensesById[entry.defenseId];
        const tower = towerMap[entry.id];
        if (!defense || !tower) {
          return null;
        }
        const engagement = engagements.find(
          (item) => item.defenseId === entry.id,
        );
        const target = engagement ? enemyById.get(engagement.enemyId) : undefined;
        const targetPoint = target
          ? pathPoint(geometry, target.path, target.pathIndex, target.progress)
          : null;
        const firing = !!targetPoint;
        const angle = targetPoint
          ? Math.atan2(
              targetPoint.y - tower.position.y,
              targetPoint.x - tower.position.x,
            )
          : tower.angle;
        const selected = entry.id === selectedPlacementId;
        const key = towerSpriteKey(defense.id);
        return (
          <g
            key={entry.id}
            className={`cyber-tower${selected ? " is-selected" : ""}${
              firing ? " is-firing" : ""
            }`}
            transform={`translate(${tower.position.x}, ${tower.position.y})`}
            style={{ "--tower-color": defense.color } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={`${defense.name}, level ${entry.level}`}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedEnemyId(null);
              onSelectPlacement(entry.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                setSelectedEnemyId(null);
                onSelectPlacement(entry.id);
              }
            }}
          >
            {hasSprite(key) ? (
              <g className="tower-art-bob">
                <Sprite spriteKey={key} x={0} y={0} width={54} height={54} />
              </g>
            ) : (
              <g className="tower-art-bob">
                <TowerArt
                  defense={defense}
                  level={entry.level}
                  angle={angle}
                  firing={firing}
                />
              </g>
            )}
            {entry.level < defense.maxLevel ? (
              <g className="cyber-tower-upgrade" transform="translate(15, -15)">
                <circle r={9} />
                <text x={0} y={4} textAnchor="middle">
                  +
                </text>
              </g>
            ) : null}
          </g>
        );
      })}

      {/* Projectiles: beams, cannon shells, bombs */}
      {engagements.map((engagement) => {
        const placedEntry = placed.find((item) => item.id === engagement.defenseId);
        const defense = placedEntry
          ? catalog.defensesById[placedEntry.defenseId]
          : undefined;
        const tower = towerMap[engagement.defenseId];
        const enemy = enemyById.get(engagement.enemyId);
        if (!defense || !tower || !enemy) {
          return null;
        }
        const to = pathPoint(geometry, enemy.path, enemy.pathIndex, enemy.progress);
        if (!to) {
          return null;
        }
        const angle = Math.atan2(to.y - tower.position.y, to.x - tower.position.x);
        const muzzle = {
          x: tower.position.x + Math.cos(angle) * TOWER_MUZZLE_DISTANCE,
          y: tower.position.y + Math.sin(angle) * TOWER_MUZZLE_DISTANCE,
        };
        const key = `${engagement.defenseId}-${engagement.enemyId}`;
        const projectile = defense.projectile ?? "beam";

        if (projectile === "beam") {
          return (
            <g key={key} className="cyber-beam" aria-hidden="true">
              <line
                className="cyber-beam-glow"
                x1={muzzle.x}
                y1={muzzle.y}
                x2={to.x}
                y2={to.y}
                stroke={defense.color}
              />
              <line
                className="cyber-beam-core"
                x1={muzzle.x}
                y1={muzzle.y}
                x2={to.x}
                y2={to.y}
                stroke={defense.color}
              />
              <circle className="cyber-impact" cx={to.x} cy={to.y} r={5} fill={defense.color} />
            </g>
          );
        }

        const travel = projectile === "bomb" ? 520 : 280;
        const fraction =
          (((elapsedMs + hashId(engagement.defenseId)) % travel) + travel) % travel / travel;
        const dx = to.x - muzzle.x;
        const dy = to.y - muzzle.y;
        const length = Math.hypot(dx, dy) || 1;
        if (projectile === "bomb") {
          const perpX = -dy / length;
          const perpY = dx / length;
          const lift = Math.sin(Math.PI * fraction) * 30;
          const shellX = muzzle.x + dx * fraction + perpX * lift;
          const shellY = muzzle.y + dy * fraction + perpY * lift;
          return (
            <g key={key} className="cyber-projectile" aria-hidden="true">
              <circle className="cyber-bomb" cx={shellX} cy={shellY} r={6} fill={defense.color} />
              {fraction > 0.62 ? (
                <circle className="cyber-blast" cx={to.x} cy={to.y} r={14} fill={defense.color} />
              ) : null}
            </g>
          );
        }
        const shellX = muzzle.x + dx * fraction;
        const shellY = muzzle.y + dy * fraction;
        return (
          <g key={key} className="cyber-projectile" aria-hidden="true">
            <circle className="cyber-shell" cx={shellX} cy={shellY} r={4.5} fill={defense.color} />
            <circle className="cyber-impact" cx={to.x} cy={to.y} r={4} fill={defense.color} />
          </g>
        );
      })}

      {/* Attacks */}
      {renderedEnemies.map((enemy) => {
        const base = pathPoint(
          geometry,
          enemy.path,
          enemy.pathIndex,
          enemy.progress,
        );
        if (!base) {
          return null;
        }
        const point = queuedPoint(enemy, base);
        const hidden = !enemy.revealed && !detectionActive;
        const healthPercent = Math.max(
          0,
          Math.min(100, (enemy.health / enemy.maxHealth) * 100),
        );
        const radius = enemy.boss ? 20 : 13;
        const key = enemySpriteKey(enemy.attackType, enemy.boss);
        const attack = catalog.attacksById[enemy.attackId];
        const selected = selectedEnemyId === enemy.id;
        const statusLabel = hidden
          ? "Unknown attack"
          : `${attack?.name ?? attackLabel(enemy.attackType)}, ${attackLabel(
              enemy.attackType,
            )}${enemy.boss ? ", boss" : ""}`;
        // Keep the callout on-screen even for attacks hugging a board edge.
        const calloutHalf = CALLOUT_WIDTH / 2 + 6;
        const clampedX = Math.min(
          Math.max(point.x, calloutHalf),
          Math.max(calloutHalf, layout.width - calloutHalf),
        );
        const neededSpace = CALLOUT_MAX_HEIGHT + radius + 18;
        const spaceAbove = point.y - 8;
        const spaceBelow = layout.height - point.y - 8;
        const calloutSide: "above" | "below" =
          spaceAbove >= neededSpace
            ? "above"
            : spaceBelow >= neededSpace
              ? "below"
              : spaceAbove >= spaceBelow
                ? "above"
                : "below";
        return (
          <g
            key={enemy.id}
            className={`cyber-enemy cyber-enemy--${attackTone(
              enemy.attackType,
            )}${enemy.boss ? " is-boss" : ""}${hidden ? " is-hidden" : ""}${
              selected ? " is-selected" : ""
            }`}
            transform={`translate(${point.x}, ${point.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${statusLabel}. ${Math.round(
              healthPercent,
            )} percent integrity. Tap to inspect.`}
            onClick={(event) => {
              event.stopPropagation();
              toggleEnemy(enemy.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                toggleEnemy(enemy.id);
              }
            }}
          >
            {/* Enlarged transparent tap target for touch. */}
            <circle className="cyber-enemy-hit" r={radius + 13} />
            <circle
              className="cyber-enemy-select-ring"
              r={radius + 9}
              aria-hidden="true"
            />
            {hidden ? (
              <g aria-hidden="true">
                <circle r={radius} className="cyber-enemy-body" />
                <text className="cyber-enemy-glyph" x={0} y={4} textAnchor="middle">
                  ?
                </text>
              </g>
            ) : (
              <g
                className={`enemy-art-bob${enemy.boss ? " is-boss" : ""}`}
                aria-hidden="true"
              >
                {hasSprite(key) ? (
                  <Sprite
                    spriteKey={key}
                    x={0}
                    y={0}
                    width={radius * 2.6}
                    height={radius * 2.6}
                  />
                ) : (
                  <EnemyArt attackType={enemy.attackType} boss={enemy.boss} />
                )}
              </g>
            )}
            <g className="cyber-enemy-health" aria-hidden="true">
              <rect
                className="cyber-enemy-health-bg"
                x={-16}
                y={-radius - 12}
                width={32}
                height={4}
                rx={2}
              />
              <rect
                className="cyber-enemy-health-fill"
                x={-16}
                y={-radius - 12}
                width={(32 * healthPercent) / 100}
                height={4}
                rx={2}
              />
            </g>
            {selected ? (
              <EnemyCallout
                attack={attack}
                attackType={enemy.attackType}
                hidden={hidden}
                boss={enemy.boss}
                health={enemy.health}
                maxHealth={enemy.maxHealth}
                systemDamage={enemy.systemDamage}
                radius={radius}
                offsetX={clampedX - point.x}
                side={calloutSide}
              />
            ) : null}
          </g>
        );
      })}

      {/* Deployed heroes */}
      {heroUnits.map((unit) => {
        const definition = catalog.heroesById[unit.heroId];
        const point = unit.anchor
          ? edgePoint(geometry, unit.anchor)
          : pathPointAt(geometry, referencePath, unit.position);
        if (!definition || !point) {
          return null;
        }
        const engagement = heroEngagements.find(
          (item) => item.heroUnitId === unit.id,
        );
        const target = engagement ? enemyById.get(engagement.enemyId) : undefined;
        const targetPoint = target
          ? pathPoint(geometry, target.path, target.pathIndex, target.progress)
          : null;
        const attacking = !!targetPoint;
        const facing = targetPoint && targetPoint.x < point.x ? -1 : 1;
        const ttlPercent = Math.max(
          0,
          Math.min(100, (unit.ttlMs / definition.durationMs) * 100),
        );
        let slashPath: string | null = null;
        let impact: { x: number; y: number } | null = null;
        if (attacking && targetPoint) {
          const dx = targetPoint.x - point.x;
          const dy = targetPoint.y - point.y;
          const slashAngle = Math.atan2(dy, dx);
          const radius = Math.min(30, Math.max(16, Math.hypot(dx, dy)));
          const a0 = slashAngle - 0.95;
          const a1 = slashAngle + 0.95;
          slashPath = `M ${(Math.cos(a0) * radius).toFixed(1)} ${(
            Math.sin(a0) * radius
          ).toFixed(1)} A ${radius} ${radius} 0 0 1 ${(Math.cos(a1) * radius).toFixed(
            1,
          )} ${(Math.sin(a1) * radius).toFixed(1)}`;
          impact = {
            x: Math.cos(slashAngle) * radius,
            y: Math.sin(slashAngle) * radius,
          };
        }
        return (
          <g
            key={unit.id}
            className={`cyber-hero-unit${attacking ? " is-attacking" : ""}`}
            transform={`translate(${point.x}, ${point.y})`}
            style={{ "--hero-color": definition.color } as CSSProperties}
            aria-hidden="true"
          >
            <circle className="cyber-hero-pad" r={22} />
            <circle
              className="cyber-hero-ttl"
              r={22}
              strokeDasharray={`${(ttlPercent / 100) * 138} 138`}
            />
            {attacking && targetPoint ? (
              <path
                className="cyber-hero-slash"
                d={slashPath ?? undefined}
                stroke={definition.color}
              />
            ) : null}
            {impact ? (
              <g
                className="cyber-hero-impact"
                transform={`translate(${impact.x.toFixed(1)}, ${impact.y.toFixed(
                  1,
                )})`}
              >
                <circle className="cyber-hero-impact-ring" r={8} />
                <path
                  className="cyber-hero-impact-spark"
                  d="M0,-10 L2.2,-2.2 L10,0 L2.2,2.2 L0,10 L-2.2,2.2 L-10,0 L-2.2,-2.2 Z"
                />
              </g>
            ) : null}
            <g transform={`scale(${facing}, 1)`}>
              <HeroArt heroId={unit.heroId} active size={46} />
            </g>
          </g>
        );
      })}

      {/* Blocked / breach bursts */}
      {effects.map((effect) => {
        const point = pathPointAt(geometry, effect.path, effect.position);
        if (!point) {
          return null;
        }
        return (
          <g
            key={effect.seq}
            className={`cyber-fx cyber-fx--${effect.kind}${
              effect.boss ? " is-boss" : ""
            }`}
            transform={`translate(${point.x}, ${point.y})`}
            aria-hidden="true"
          >
            {effect.kind === "hit" ? (
              <circle className="cyber-fx-hit" r={10} />
            ) : (
              <>
                <circle
                  className="cyber-fx-ring"
                  r={effect.kind === "restore" ? 22 : effect.boss ? 26 : 16}
                />
                <text
                  className="cyber-fx-label"
                  x={0}
                  y={effect.kind === "restore" ? -26 : effect.boss ? -30 : -22}
                  textAnchor="middle"
                >
                  {effect.kind === "blocked"
                    ? "BLOCKED"
                    : effect.kind === "timeout"
                      ? "CONGESTED"
                      : effect.kind === "restore"
                        ? `BACKUP +${effect.amount ?? 0}`
                        : "BREACH"}
                </text>
              </>
            )}
          </g>
        );
      })}

      {capped ? (
        <text
          className="cyber-map-cap-note"
          x={layout.width / 2}
          y={layout.height - 10}
          textAnchor="middle"
        >
          Showing {ENEMY_RENDER_CAP} of {enemies.length} attacks — the full swarm
          still counts.
        </text>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Road model                                                          */
/* ------------------------------------------------------------------ */

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 100000;
  }
  return hash;
}

