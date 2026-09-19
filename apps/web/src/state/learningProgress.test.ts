import { beforeEach, describe, expect, it } from "vitest";

import {
  LEARNING_PROGRESS_KEY,
  clearDomainProgress,
  deriveLearningState,
  emptyDomainProgress,
  isNodeUnlocked,
  loadDomainProgress,
  revealPrompt,
} from "./learningProgress";
import { learningFixture } from "../test/learningFixture";

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
