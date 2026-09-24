import { describe, expect, it } from "vitest";

import {
  addEdge,
  canConnect,
  firstSourceNodeId,
  hasEdge,
  removeEdge,
  toggleEdge,
  wellFormedEdges,
} from "./nodeConnection";

describe("nodeConnection edge helpers", () => {
  it("appends a directed edge in [from, to] order", () => {
    expect(addEdge([], "a", "b")).toEqual([["a", "b"]]);
    expect(addEdge([["a", "b"]], "a", "c")).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });

  it("rejects self-edges and empty endpoints", () => {
    expect(canConnect("a", "a")).toBe(false);
    expect(canConnect("", "b")).toBe(false);
    expect(canConnect("a", "")).toBe(false);
    expect(addEdge([], "a", "a")).toEqual([]);
  });

  it("does not insert a duplicate identical edge", () => {
    const edges = [["a", "b"]];
    expect(addEdge(edges, "a", "b")).toBe(edges);
    expect(addEdge(edges, "b", "a")).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
  });

  it("removes only the matching directed edge", () => {
    const edges = [
      ["a", "b"],
      ["b", "a"],
    ];
    expect(removeEdge(edges, "a", "b")).toEqual([["b", "a"]]);
    expect(removeEdge(edges, "a", "c")).toBe(edges);
  });

  it("toggles an edge on and off", () => {
    const added = toggleEdge([], "a", "b");
    expect(added).toEqual([["a", "b"]]);
    expect(toggleEdge(added, "a", "b")).toEqual([]);
  });

  it("reports edge membership", () => {
    expect(hasEdge([["a", "b"]], "a", "b")).toBe(true);
    expect(hasEdge([["a", "b"]], "b", "a")).toBe(false);
  });

  it("filters malformed edges from restored answers", () => {
    expect(
      wellFormedEdges([["a", "b"], ["c"], ["c", "c"], ["", "b"], ["b", "a"]]),
    ).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
  });

  it("extracts only the first canonical source node", () => {
    expect(
      firstSourceNodeId({
        type: "node_connection",
        edges: [
          ["a", "b"],
          ["a", "c"],
        ],
      }),
    ).toBe("a");
    expect(firstSourceNodeId({ type: "node_connection", edges: [] })).toBe(
      undefined,
    );
    expect(
      firstSourceNodeId({ type: "node_connection", edges: [["x"], ["c", "c"]] }),
    ).toBe(undefined);
    expect(firstSourceNodeId(undefined)).toBeUndefined();
  });
});
