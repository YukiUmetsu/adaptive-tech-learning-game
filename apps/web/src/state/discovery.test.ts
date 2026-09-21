import { describe, expect, it } from "vitest";

import type { DomainDiscoveryInput } from "../api/types";
import {
  mergeDiscoveryInputs,
  mergeDiscoveryLists,
  unionElementIds,
  unionPromptIds,
} from "./discovery";

function input(
  domainId: string,
  prompts: Record<string, string[]>,
  elements: Record<string, Record<string, string[]>> = {},
): DomainDiscoveryInput {
  return {
    domain_id: domainId,
    revealed_prompt_ids: prompts,
    revealed_element_ids: elements,
  };
}

describe("discovery set-union", () => {
  it("unions prompt ids with sorted, deduplicated values", () => {
    const merged = unionPromptIds(
      { n1: ["p2", "p1"] },
      { n1: ["p1", "p3"], n2: ["p1"] },
    );
    expect(merged).toEqual({
      n1: ["p1", "p2", "p3"],
      n2: ["p1"],
    });
  });

  it("unions nested element ids", () => {
    const merged = unionElementIds(
      { n1: { p1: ["annotation:a1"] } },
      { n1: { p1: ["annotation:a2"], p2: ["cell:r1:c1"] } },
    );
    expect(merged).toEqual({
      n1: {
        p1: ["annotation:a1", "annotation:a2"],
        p2: ["cell:r1:c1"],
      },
    });
  });

  it("merges two device states without losing either side", () => {
    const deviceA = input("d1", { n1: ["p1"] }, { n1: { p1: ["annotation:a1"] } });
    const deviceB = input("d1", { n1: ["p2"], n2: ["p1"] }, {});

    const merged = mergeDiscoveryInputs(deviceA, deviceB);
    expect(merged.revealed_prompt_ids).toEqual({
      n1: ["p1", "p2"],
      n2: ["p1"],
    });
    expect(merged.revealed_element_ids).toEqual({
      n1: { p1: ["annotation:a1"] },
    });
  });

  it("lets an older device state not remove newer reveals", () => {
    const newer = input("d1", { n1: ["p1", "p2"] });
    const older = input("d1", { n1: ["p1"] });
    expect(mergeDiscoveryInputs(newer, older).revealed_prompt_ids).toEqual({
      n1: ["p1", "p2"],
    });
  });

  it("merges domain lists by domain id", () => {
    const merged = mergeDiscoveryLists(
      [input("d2", { n1: ["p1"] }), input("d1", { n1: ["p1"] })],
      [input("d1", { n1: ["p2"] }), input("d3", { n1: ["p1"] })],
    );
    expect(merged.map((domain) => domain.domain_id)).toEqual(["d1", "d2", "d3"]);
    expect(merged[0].revealed_prompt_ids).toEqual({ n1: ["p1", "p2"] });
  });
});
