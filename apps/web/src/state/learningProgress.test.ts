import { beforeEach, describe, expect, it } from "vitest";

import { elementId } from "../lib/learningElements";
import {
  LEARNING_PROGRESS_KEY,
  LEGACY_LEARNING_PROGRESS_KEY,
  V2_LEARNING_PROGRESS_KEY,
  clearDomainProgress,
  deriveLearningState,
  emptyDomainProgress,
  isNodeUnlocked,
  isPromptComplete,
  loadDomainProgress,
  nodePromptProgress,
  revealElement,
  revealPrompt,
} from "./learningProgress";
import { learningFixture } from "../test/learningFixture";
import { codeLearningFixture } from "../test/codeLearningFixture";
import { progressiveTableFixture } from "../test/progressiveTableFixture";

beforeEach(() => {
  window.localStorage.clear();
});

function revealedMapping(
  entries: Array<[string, string[]]>,
): Record<string, string[]> {
  return Object.fromEntries(entries);
}

describe("deriveLearningState", () => {
  it("starts with only the first node ready and later paths locked", () => {
    const state = deriveLearningState(learningFixture, null);

    expect(state.nodeState.n1).toBe("ready");
    expect(state.nodeState.n2).toBe("locked");
    expect(state.nodeState.n3).toBe("locked");
    expect(state.moduleProgress.m1.complete).toBe(false);
    expect(state.moduleProgress.m2.available).toBe(false);
    expect(state.unlockedCount).toBe(0);
    expect(state.totalNodeCount).toBe(3);
    expect(state.nextNodeId).toBe("n1");
  });

  it("marks a partially revealed node as in progress", () => {
    const state = deriveLearningState(learningFixture, {
      ...emptyDomainProgress("v1", "domain-1", "test-content-v1"),
      revealedPromptIds: revealedMapping([["n1", ["what"]]]),
    });

    expect(state.nodeState.n1).toBe("in_progress");
    expect(state.nodeState.n2).toBe("locked");
  });

  it("unlocks a node when all required prompts are revealed", () => {
    const state = deriveLearningState(learningFixture, {
      ...emptyDomainProgress("v1", "domain-1", "test-content-v1"),
      revealedPromptIds: revealedMapping([["n1", ["what", "look"]]]),
    });

    expect(state.nodeState.n1).toBe("unlocked");
    expect(state.unlockedNodeIds.has("n1")).toBe(true);
    // The dependent node becomes ready.
    expect(state.nodeState.n2).toBe("ready");
  });

  it("completes a module and unlocks the next module's path", () => {
    const state = deriveLearningState(learningFixture, {
      ...emptyDomainProgress("v1", "domain-1", "test-content-v1"),
      revealedPromptIds: revealedMapping([
        ["n1", ["what", "look"]],
        ["n2", ["sequence"]],
      ]),
    });

    expect(state.moduleProgress.m1.complete).toBe(true);
    expect(state.moduleProgress.m2.available).toBe(true);
    expect(state.nodeState.n3).toBe("ready");
    expect(state.domainComplete).toBe(false);
  });

  it("detects domain completion across every module", () => {
    const state = deriveLearningState(learningFixture, {
      ...emptyDomainProgress("v1", "domain-1", "test-content-v1"),
      revealedPromptIds: revealedMapping([
        ["n1", ["what", "look"]],
        ["n2", ["sequence"]],
        ["n3", ["compare"]],
      ]),
    });

    expect(state.domainComplete).toBe(true);
    expect(state.unlockedCount).toBe(3);
  });

  it("ignores unknown node and prompt ids from an older revision", () => {
    const state = deriveLearningState(learningFixture, {
      ...emptyDomainProgress("v1", "domain-1", "test-content-v1"),
      revealedPromptIds: revealedMapping([
        ["ghost-node", ["ghost-prompt"]],
        ["n1", ["what", "removed-prompt"]],
      ]),
    });

    expect(state.nodeState.n1).toBe("in_progress");
    expect(state.unlockedNodeIds.has("ghost-node")).toBe(false);
  });
});

describe("isNodeUnlocked", () => {
  it("requires every required prompt", () => {
    const [n1] = learningFixture.modules[0].nodes;
    expect(isNodeUnlocked(n1, new Set(["what"]))).toBe(false);
    expect(isNodeUnlocked(n1, new Set(["what", "look"]))).toBe(true);
  });
});

describe("discovery persistence", () => {
  it("persists reveals under a versioned key and restores them", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "look");

    expect(window.localStorage.getItem(LEARNING_PROGRESS_KEY)).not.toBeNull();
    const stored = loadDomainProgress("v1", "domain-1");
    expect(stored?.revealedPromptIds.n1).toEqual(["what", "look"]);

    const state = deriveLearningState(learningFixture, stored);
    expect(state.nodeState.n1).toBe("unlocked");
  });

  it("is idempotent when the same prompt is revealed twice", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");

    const stored = loadDomainProgress("v1", "domain-1");
    expect(stored?.revealedPromptIds.n1).toEqual(["what"]);
  });

  it("keeps stable node ids across a learning content version change", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    revealPrompt("v1", "domain-1", "test-content-v2", "n1", "look");

    const stored = loadDomainProgress("v1", "domain-1");
    expect(stored?.contentVersion).toBe("test-content-v2");
    expect(stored?.revealedPromptIds.n1).toEqual(["what", "look"]);
  });

  it("clears domain progress without touching other state", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    clearDomainProgress("v1", "domain-1");
    expect(loadDomainProgress("v1", "domain-1")).toBeNull();
  });

  it("returns null for a domain that was never explored", () => {
    expect(loadDomainProgress("v1", "domain-1")).toBeNull();
  });
});

describe("v1 to v3 migration", () => {
  it("converts legacy prompt progress and drops the legacy key", () => {
    window.localStorage.setItem(
      LEGACY_LEARNING_PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        domains: {
          "v1::domain-1": {
            certificationVersion: "v1",
            domainId: "domain-1",
            contentVersion: "test-content-v1",
            revealedPromptIds: { n1: ["what", "look"], "ghost-node": ["ghost"] },
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    const loaded = loadDomainProgress("v1", "domain-1");
    expect(loaded?.revealedPromptIds.n1).toEqual(["what", "look"]);
    expect(loaded?.revealedElementIds).toEqual({});
    expect(window.localStorage.getItem(LEGACY_LEARNING_PROGRESS_KEY)).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(LEARNING_PROGRESS_KEY) ?? "{}",
    );
    expect(stored.version).toBe(3);

    const state = deriveLearningState(learningFixture, loaded);
    expect(state.nodeState.n1).toBe("unlocked");
    expect(state.unlockedNodeIds.has("ghost-node")).toBe(false);
  });

  it("prefers existing v3 progress without rereading v1", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    window.localStorage.setItem(
      LEGACY_LEARNING_PROGRESS_KEY,
      JSON.stringify({ version: 1, domains: {} }),
    );

    const loaded = loadDomainProgress("v1", "domain-1");
    expect(loaded?.revealedPromptIds.n1).toEqual(["what"]);
  });
});

describe("v2 to v3 migration", () => {
  it("preserves prompts and namespaces code annotations", () => {
    window.localStorage.setItem(
      V2_LEARNING_PROGRESS_KEY,
      JSON.stringify({
        version: 2,
        domains: {
          "v1::domain-code": {
            certificationVersion: "v1",
            domainId: "domain-code",
            contentVersion: "test-code-v1",
            revealedPromptIds: { "n-code": ["read"] },
            revealedAnnotationIds: {
              "n-code": { versions: ["terraform-version", "provider-source"] },
            },
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    const loaded = loadDomainProgress("v1", "domain-code");
    expect(loaded?.revealedPromptIds["n-code"]).toEqual(["read"]);
    expect(loaded?.revealedElementIds["n-code"]["versions"]).toEqual([
      "annotation:terraform-version",
      "annotation:provider-source",
    ]);
    expect(window.localStorage.getItem(V2_LEARNING_PROGRESS_KEY)).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(LEARNING_PROGRESS_KEY) ?? "{}",
    );
    expect(stored.version).toBe(3);
  });

  it("is idempotent when migration runs twice", () => {
    const seed = JSON.stringify({
      version: 2,
      domains: {
        "v1::domain-code": {
          certificationVersion: "v1",
          domainId: "domain-code",
          contentVersion: "test-code-v1",
          revealedPromptIds: {},
          revealedAnnotationIds: { "n-code": { versions: ["terraform-version"] } },
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });
    window.localStorage.setItem(V2_LEARNING_PROGRESS_KEY, seed);
    loadDomainProgress("v1", "domain-code");

    // A second read sees v3 and never re-migrates or duplicates ids.
    const loaded = loadDomainProgress("v1", "domain-code");
    expect(loaded?.revealedElementIds["n-code"]["versions"]).toEqual([
      "annotation:terraform-version",
    ]);
  });
});

describe("code annotation progress", () => {
  const seed = (annotationId: string) =>
    revealElement(
      "v1",
      "domain-code",
      "test-code-v1",
      "n-code",
      "versions",
      elementId.annotation(annotationId),
    );

  it("persists revealed annotation ids per node and prompt", () => {
    seed("terraform-version");
    seed("provider-source");
    seed("terraform-version"); // idempotent

    const stored = loadDomainProgress("v1", "domain-code");
    expect(stored?.revealedElementIds["n-code"]["versions"]).toEqual([
      "annotation:terraform-version",
      "annotation:provider-source",
    ]);
  });

  it("keeps normal prompt progress when annotations are revealed", () => {
    revealPrompt("v1", "domain-code", "test-code-v1", "n-code", "versions");
    seed("terraform-version");

    const stored = loadDomainProgress("v1", "domain-code");
    expect(stored?.revealedPromptIds["n-code"]).toEqual(["versions"]);
    expect(stored?.revealedElementIds["n-code"]["versions"]).toEqual([
      "annotation:terraform-version",
    ]);
  });

  it("completes a code-file prompt when every required annotation is revealed", () => {
    const prompt = codeLearningFixture.modules[0].nodes[0].prompts[0];
    expect(
      isPromptComplete(
        prompt,
        new Set(),
        new Set(["annotation:terraform-version"]),
      ),
    ).toBe(false);
    expect(
      isPromptComplete(
        prompt,
        new Set(),
        new Set([
          "annotation:terraform-version",
          "annotation:provider-source",
        ]),
      ),
    ).toBe(true);
  });

  it("does not complete a code file from optional annotations alone", () => {
    seed("provider-version");

    const state = deriveLearningState(
      codeLearningFixture,
      loadDomainProgress("v1", "domain-code"),
    );
    expect(state.nodeState["n-code"]).toBe("in_progress");
    expect(state.unlockedNodeIds.has("n-code")).toBe(false);
  });

  it("unlocks the node once required annotations are revealed", () => {
    seed("terraform-version");
    let state = deriveLearningState(
      codeLearningFixture,
      loadDomainProgress("v1", "domain-code"),
    );
    expect(state.nodeState["n-code"]).toBe("in_progress");

    seed("provider-source");
    state = deriveLearningState(
      codeLearningFixture,
      loadDomainProgress("v1", "domain-code"),
    );
    expect(state.nodeState["n-code"]).toBe("unlocked");
    expect(state.nodeState["n-read"]).toBe("ready");
  });

  it("completes an annotation-less code file on an explicit reveal", () => {
    seed("terraform-version");
    seed("provider-source");

    let state = deriveLearningState(
      codeLearningFixture,
      loadDomainProgress("v1", "domain-code"),
    );
    expect(state.nodeState["n-read"]).toBe("ready");

    revealPrompt("v1", "domain-code", "test-code-v1", "n-read", "main");
    state = deriveLearningState(
      codeLearningFixture,
      loadDomainProgress("v1", "domain-code"),
    );
    expect(state.nodeState["n-read"]).toBe("unlocked");
  });

  it("treats a static table prompt as an ordinary prompt reveal", () => {
    const tablePrompt = codeLearningFixture.modules[1].nodes[0].prompts[0];
    expect(
      isPromptComplete(tablePrompt, new Set(["constraints"]), new Set()),
    ).toBe(true);
    expect(isPromptComplete(tablePrompt, new Set(), new Set())).toBe(false);
  });
});

describe("node prompt progress consistency", () => {
  it("counts element-based completion the same way unlock does", () => {
    const node = codeLearningFixture.modules[0].nodes[0]; // one code_file prompt
    const revealedElements = new Set([
      "annotation:terraform-version",
      "annotation:provider-source",
    ]);
    const elementMap = new Map([["versions", revealedElements]]);

    const progress = nodePromptProgress(node, new Set(), elementMap);
    expect(progress).toEqual({ completed: 1, total: 1 });
    expect(isNodeUnlocked(node, new Set(), elementMap)).toBe(true);
  });

  it("never reports partial progress for an unlocked mixed node", () => {
    const node = {
      ...codeLearningFixture.modules[0].nodes[0],
      prompts: [
        codeLearningFixture.modules[0].nodes[0].prompts[0], // code_file
        {
          id: "what",
          kind: "what" as const,
          label: "WHAT?",
          placeholder: "",
          required: true,
          reveal: { type: "text" as const, text: "An IaC tool." },
        },
      ],
    };

    const revealedPrompts = new Set(["what"]);
    const revealedElements = new Map([
      [
        "versions",
        new Set(["annotation:terraform-version", "annotation:provider-source"]),
      ],
    ]);

    expect(nodePromptProgress(node, revealedPrompts, revealedElements)).toEqual({
      completed: 2,
      total: 2,
    });
    expect(isNodeUnlocked(node, revealedPrompts, revealedElements)).toBe(true);
  });
});

describe("progressive table progress", () => {
  const promptFor = (nodeId: string) =>
    progressiveTableFixture.modules[0].nodes.find(
      (node) => node.id === nodeId,
    )!.prompts[0];

  it("counts row units as required and ignores given rows", () => {
    const prompt = promptFor("n-row");
    // The service column is given; both rows still have hidden cells.
    expect(
      isPromptComplete(prompt, new Set(), new Set(["row:cloudwatch"])),
    ).toBe(false);
    expect(
      isPromptComplete(
        prompt,
        new Set(),
        new Set(["row:cloudwatch", "row:cloudtrail"]),
      ),
    ).toBe(true);
  });

  it("counts column units and excludes initially visible columns", () => {
    const prompt = promptFor("n-column");
    expect(
      isPromptComplete(prompt, new Set(), new Set(["column:stateful"])),
    ).toBe(false);
    expect(
      isPromptComplete(
        prompt,
        new Set(),
        new Set(["column:stateful", "column:rules"]),
      ),
    ).toBe(true);
  });

  it("counts every hidden cell and excludes explicitly given cells", () => {
    const prompt = promptFor("n-cell");
    const required = [
      "cell:weighted:basis",
      "cell:weighted:health",
      "cell:latency:basis",
      "cell:latency:health",
      "cell:latency:use",
    ];
    expect(isPromptComplete(prompt, new Set(), new Set(required.slice(0, 4)))).toBe(
      false,
    );
    expect(isPromptComplete(prompt, new Set(), new Set(required))).toBe(true);
  });

  it("persists row, column, and cell progress and unlocks nodes", () => {
    const row = (id: string) =>
      revealElement(
        "v1",
        "domain-progressive",
        "test-progressive-v1",
        "n-row",
        "rows",
        `row:${id}`,
      );
    row("cloudwatch");
    let state = deriveLearningState(
      progressiveTableFixture,
      loadDomainProgress("v1", "domain-progressive"),
    );
    expect(state.nodeState["n-row"]).toBe("in_progress");

    row("cloudtrail");
    state = deriveLearningState(
      progressiveTableFixture,
      loadDomainProgress("v1", "domain-progressive"),
    );
    expect(state.nodeState["n-row"]).toBe("unlocked");
    expect(state.nodeState["n-column"]).toBe("ready");
  });

  it("ignores stale element ids safely", () => {
    revealElement(
      "v1",
      "domain-progressive",
      "test-progressive-v1",
      "n-row",
      "rows",
      "row:no-longer-exists",
    );
    const state = deriveLearningState(
      progressiveTableFixture,
      loadDomainProgress("v1", "domain-progressive"),
    );
    expect(state.nodeState["n-row"]).toBe("in_progress");
    expect(state.unlockedNodeIds.has("n-row")).toBe(false);
  });
});
