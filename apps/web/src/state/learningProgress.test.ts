import { beforeEach, describe, expect, it } from "vitest";

import {
  LEARNING_PROGRESS_KEY,
  LEGACY_LEARNING_PROGRESS_KEY,
  clearDomainProgress,
  deriveLearningState,
  emptyDomainProgress,
  isNodeUnlocked,
  isPromptComplete,
  loadDomainProgress,
  revealAnnotation,
  revealPrompt,
} from "./learningProgress";
import { learningFixture } from "../test/learningFixture";
import { codeLearningFixture } from "../test/codeLearningFixture";

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

describe("v1 to v2 migration", () => {
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
    expect(loaded?.revealedAnnotationIds).toEqual({});
    expect(window.localStorage.getItem(LEGACY_LEARNING_PROGRESS_KEY)).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(LEARNING_PROGRESS_KEY) ?? "{}",
    );
    expect(stored.version).toBe(2);

    const state = deriveLearningState(learningFixture, loaded);
    expect(state.nodeState.n1).toBe("unlocked");
    expect(state.unlockedNodeIds.has("ghost-node")).toBe(false);
  });

  it("prefers existing v2 progress without rereading v1", () => {
    revealPrompt("v1", "domain-1", "test-content-v1", "n1", "what");
    window.localStorage.setItem(
      LEGACY_LEARNING_PROGRESS_KEY,
      JSON.stringify({ version: 1, domains: {} }),
    );

    const loaded = loadDomainProgress("v1", "domain-1");
    expect(loaded?.revealedPromptIds.n1).toEqual(["what"]);
  });
});

describe("code annotation progress", () => {
  const seed = (annotationId: string) =>
    revealAnnotation(
      "v1",
      "domain-code",
      "test-code-v1",
      "n-code",
      "versions",
      annotationId,
    );

  it("persists revealed annotation ids per node and prompt", () => {
    seed("terraform-version");
    seed("provider-source");
    seed("terraform-version"); // idempotent

    const stored = loadDomainProgress("v1", "domain-code");
    expect(stored?.revealedAnnotationIds["n-code"]["versions"]).toEqual([
      "terraform-version",
      "provider-source",
    ]);
  });

  it("keeps normal prompt progress when annotations are revealed", () => {
    revealPrompt("v1", "domain-code", "test-code-v1", "n-code", "versions");
    seed("terraform-version");

    const stored = loadDomainProgress("v1", "domain-code");
    expect(stored?.revealedPromptIds["n-code"]).toEqual(["versions"]);
    expect(stored?.revealedAnnotationIds["n-code"]["versions"]).toEqual([
      "terraform-version",
    ]);
  });

  it("completes a code-file prompt when every required annotation is revealed", () => {
    const prompt = codeLearningFixture.modules[0].nodes[0].prompts[0];
    expect(
      isPromptComplete(prompt, new Set(), new Set(["terraform-version"])),
    ).toBe(false);
    expect(
      isPromptComplete(
        prompt,
        new Set(),
        new Set(["terraform-version", "provider-source"]),
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

  it("treats a table prompt as an ordinary prompt reveal", () => {
    const tablePrompt = codeLearningFixture.modules[1].nodes[0].prompts[0];
    expect(
      isPromptComplete(tablePrompt, new Set(["constraints"]), new Set()),
    ).toBe(true);
    expect(isPromptComplete(tablePrompt, new Set(), new Set())).toBe(false);
  });
});
