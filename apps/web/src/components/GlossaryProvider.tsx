import { useMemo, useRef, type ReactNode } from "react";

import type { GlossaryTerm } from "../api/types";
import {
  GlossaryContext,
  type GlossaryContextValue,
  type GlossaryRegistry,
} from "./glossaryContext";

/**
 * Provides glossary terms to learner-facing text in the subtree.
 *
 * The card passes the node's page glossary merged with the domain glossary. The
 * registry ensures the "tap for explanation" affordance is shown only once per
 * term per mounted page, even when a term appears many times. A term that names
 * the page's own subject (`subject`) is skipped: the card is already about it,
 * so it is not a "special sub-term" needing an explanation.
 */
export default function GlossaryProvider({
  terms,
  subject,
  children,
}: {
  terms: readonly GlossaryTerm[];
  /** The page's own topic (for example the knowledge node title). */
  subject?: string;
  children: ReactNode;
}) {
  const claimed = useRef<Set<string>>(new Set());

  const registry = useMemo<GlossaryRegistry>(
    () => ({
      claim(term: string) {
        const key = term.trim().toLowerCase();
        if (claimed.current.has(key)) {
          return false;
        }
        claimed.current.add(key);
        return true;
      },
      release(term: string) {
        claimed.current.delete(term.trim().toLowerCase());
      },
    }),
    [],
  );

  const effectiveTerms = useMemo(() => {
    const normalizedSubject = subject?.trim().toLowerCase();
    if (!normalizedSubject) {
      return terms;
    }
    return terms.filter(
      (term) => term.term.trim().toLowerCase() !== normalizedSubject,
    );
  }, [terms, subject]);

  const value = useMemo<GlossaryContextValue>(
    () => ({ terms: effectiveTerms, registry }),
    [effectiveTerms, registry],
  );

  return (
    <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>
  );
}
