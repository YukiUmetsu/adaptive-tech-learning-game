import { describe, expect, it } from "vitest";

import { OPERATION_MAPS } from "../data/operationMaps";
import { layoutMap } from "./layout";
import {
  buildMapRoadGeometry,
  buildRoadPads,
  edgeKey,
  nearestEdgeAnchor,
  pathPointAt,
} from "./roadGeometry";

function geometryFor(mapId: keyof typeof OPERATION_MAPS) {
  const map = OPERATION_MAPS[mapId];
  const layout = layoutMap(map, { orientation: "horizontal" });
  return buildMapRoadGeometry(map, layout);
}

const pathA = ["internet", "edge", "api", "db"];
const pathB = ["internet", "edge", "app", "db"];

describe("dual-service geometry", () => {
  it("renders both branch edges, not just one route", () => {
    const geometry = geometryFor("dual-service");
    expect(Object.keys(geometry.edges).sort()).toEqual(
      [
        edgeKey("internet", "edge"),
        edgeKey("edge", "api"),
        edgeKey("edge", "app"),
        edgeKey("api", "db"),
        edgeKey("app", "db"),
      ].sort(),
    );
  });

  it("places enemies on different positions after the fork", () => {
    const geometry = geometryFor("dual-service");
    const api = pathPointAt(geometry, pathA, 2);
    const app = pathPointAt(geometry, pathB, 2);
    expect(api).not.toBeNull();
    expect(app).not.toBeNull();
    expect(api).not.toEqual(app);
  });

  it("converges again at the shared Database node", () => {
    const geometry = geometryFor("dual-service");
    const endA = pathPointAt(geometry, pathA, 3);
    const endB = pathPointAt(geometry, pathB, 3);
    expect(endA).toEqual(endB);
  });

  it("builds pads on both branches", () => {
    const geometry = geometryFor("dual-service");
    const pads = buildRoadPads(geometry);
    const branches = new Set(pads.map((pad) => pad.edgeKey));
    expect(branches.has(edgeKey("edge", "api"))).toBe(true);
    expect(branches.has(edgeKey("edge", "app"))).toBe(true);
    // Every pad carries a node whose coverage the simulation can match.
    for (const pad of pads) {
      expect(geometry.positions[pad.nodeId]).toBeDefined();
    }
  });

  it("gives nearestEdgeAnchor a concrete branch edge", () => {
    const geometry = geometryFor("dual-service");
    const appNode = geometry.positions.app;
    const nearest = nearestEdgeAnchor(geometry, { x: appNode.x, y: appNode.y });
    expect(nearest).not.toBeNull();
    expect([edgeKey("edge", "app"), edgeKey("app", "db")]).toContain(
      edgeKey(nearest!.anchor.from, nearest!.anchor.to),
    );
  });
});

describe("map geometry regression", () => {
  it("generates geometry for every edge of every Operation map", () => {
    for (const [mapId, map] of Object.entries(OPERATION_MAPS)) {
      const geometry = geometryFor(mapId as keyof typeof OPERATION_MAPS);
      expect(geometry.edgeOrder.length, `${mapId} edge count`).toBe(
        map.edges.length,
      );
      for (const edge of map.edges) {
        expect(
          geometry.edges[edgeKey(edge.from, edge.to)],
          `${mapId} ${edge.from}->${edge.to}`,
        ).toBeDefined();
      }
      // Every node has a position; no dangling endpoints.
      for (const node of map.nodes) {
        expect(geometry.positions[node.id], `${mapId} ${node.id}`).toBeDefined();
      }
    }
  });

  it("builds at least one pad on every edge of every map", () => {
    for (const mapId of Object.keys(OPERATION_MAPS)) {
      const geometry = geometryFor(mapId as keyof typeof OPERATION_MAPS);
      const pads = buildRoadPads(geometry);
      const edgesWithPads = new Set(pads.map((pad) => pad.edgeKey));
      for (const key of geometry.edgeOrder) {
        expect(edgesWithPads.has(key), `${mapId} ${key}`).toBe(true);
      }
      // Deterministic pad ids for the same map.
      expect(buildRoadPads(geometry).map((pad) => pad.id)).toEqual(
        pads.map((pad) => pad.id),
      );
    }
  });

  it("keeps mobile branch nodes from overlapping and in view", () => {
    const map = OPERATION_MAPS["dual-service"];
    const layout = layoutMap(map, { orientation: "vertical" });
    const geometry = buildMapRoadGeometry(map, layout);
    const api = geometry.positions.api;
    const app = geometry.positions.app;
    // Same depth in vertical mode: they differ on the x axis, not on top of
    // each other.
    expect(api.y).toBe(app.y);
    expect(Math.abs(api.x - app.x)).toBeGreaterThan(0);
    for (const node of map.nodes) {
      const position = geometry.positions[node.id];
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(geometry.width);
      expect(position.y).toBeLessThanOrEqual(geometry.height);
    }
  });

  it("plays a linear map with exactly one pad-free-route concept unchanged", () => {
    // edge-basic is a straight line: its two nodes and one edge still render.
    const map = OPERATION_MAPS["edge-basic"];
    const geometry = geometryFor("edge-basic");
    expect(geometry.edgeOrder).toEqual([edgeKey("internet", "edge"), edgeKey("edge", "api")]);
    const pads = buildRoadPads(geometry);
    expect(pads.length).toBeGreaterThanOrEqual(4);
    expect(map.nodes.length).toBe(3);
  });
});
