import { createContext, useContext } from "react";

import type { GlossaryTerm } from "../api/types";

/** Tracks which terms have already shown their affordance in a page. */
export interface GlossaryRegistry {
  /** Claims the first occurrence of a term. Returns true when newly claimed. */
  claim(term: string): boolean;
  /** Releases a claim when its occurrence unmounts. */
  release(term: string): void;
}

export interface GlossaryContextValue {
  terms: readonly GlossaryTerm[];
  registry: GlossaryRegistry;
}

const noopRegistry: GlossaryRegistry = {
  // Without a provider there is no page scope, so every occurrence highlights.
  claim: () => true,
  release: () => {},
};

/**
 * Domain glossary available to learner-facing text in the subtree.
 *
 * Learning domains carry a glossary in content JSON; wrapping the learning
 * surface lets `InlineText` highlight and explain those terms without threading
 * the list through every component. Defaults to empty (no highlighting).
 */
export const GlossaryContext = createContext<GlossaryContextValue>({
  terms: [],
  registry: noopRegistry,
});

export function useGlossary(): GlossaryContextValue {
  return useContext(GlossaryContext);
}
