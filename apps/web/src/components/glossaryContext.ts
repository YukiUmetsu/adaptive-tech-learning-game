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
 * Glossary terms available to learner-facing text in the subtree.
 *
 * A card provides the node's own page terms merged with the domain glossary;
 * wrapping the learning surface lets `InlineText` highlight and explain those
 * terms without threading the list through every component. Defaults to empty
 * (no highlighting).
 */
export const GlossaryContext = createContext<GlossaryContextValue>({
  terms: [],
  registry: noopRegistry,
});

export function useGlossary(): GlossaryContextValue {
  return useContext(GlossaryContext);
}

/**
 * Merges a domain glossary with a page/node glossary.
 *
 * The node terms are the page's own vocabulary and win over a domain term with
 * the same (case-insensitive) text, so a page can refine or override a shared
 * definition. A term defined only at the domain level stays available on every
 * page.
 */
export function mergeGlossaryTerms(
  domainTerms: readonly GlossaryTerm[],
  pageTerms: readonly GlossaryTerm[],
): GlossaryTerm[] {
  const merged = new Map<string, GlossaryTerm>();
  for (const term of pageTerms) {
    merged.set(term.term.trim().toLowerCase(), term);
  }
  for (const term of domainTerms) {
    const key = term.term.trim().toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, term);
    }
  }
  return [...merged.values()];
}
