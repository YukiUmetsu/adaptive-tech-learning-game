import { describe, expect, it } from "vitest";

import { MISSIONS_BY_ID } from "../data/missions";
import { layoutMap } from "./layout";

const mission = MISSIONS_BY_ID["sql-injection"];

describe("layoutMap", () => {
  it("places nodes left-to-right in horizontal mode", () => {
    const layout = layoutMap(mission.map, { orientation: "horizontal" });
    expect(layout.positions["internet"].x).toBeLessThan(
      layout.positions["db"].x,
    );
    expect(layout.width).toBeGreaterThan(layout.height);
  });

  it("places nodes top-to-bottom in vertical mode", () => {
    const layout = layoutMap(mission.map, { orientation: "vertical" });
    expect(layout.positions["internet"].y).toBeLessThan(
      layout.positions["db"].y,
    );
    expect(layout.height).toBeGreaterThan(layout.width);
  });

  it("keeps depth ordering consistent between orientations", () => {
    const horizontal = layoutMap(mission.map, { orientation: "horizontal" });
    const vertical = layoutMap(mission.map, { orientation: "vertical" });
    for (const node of mission.map.nodes) {
      expect(horizontal.positions[node.id].depth).toBe(
        vertical.positions[node.id].depth,
      );
    }
  });
});
