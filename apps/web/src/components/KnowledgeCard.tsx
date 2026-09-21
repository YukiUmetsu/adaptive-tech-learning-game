import { useMemo, type ReactNode } from "react";

import type { KnowledgeNode, GlossaryTerm } from "../api/types";
import {
  isPromptComplete,
  nodePromptProgress,
  type NodeState,
} from "../state/learningProgress";
import GlossaryProvider from "./GlossaryProvider";
import InlineText from "./InlineText";import KnowledgePrompt from "./KnowledgePrompt";

interface KnowledgeCardProps {
  node: KnowledgeNode;
  moduleTitle: string;
  state: NodeState;
  revealedPromptIds: readonly string[];
  /** Prompt id to revealed namespaced discovery element ids for this node. */
  revealedElementIds: Readonly<Record<string, readonly string[]>>;
  nextNode: KnowledgeNode | null;
  reducedMotion: boolean;
  onReveal: (promptId: string) => void;
  onRevealElement: (promptId: string, elementId: string) => void;
  onClose: () => void;
  onDiscoverNext: (nodeId: string) => void;
  /**
   * Read-only review mode: every prompt is shown revealed and interactions are
   * disabled, so completed material can be revisited without any clicks.
   */
  readOnly?: boolean;
  /**
   * Replaces the "Back to map" header control. Pass `null` to hide it.
   * Omitted keeps the default, preserving existing map behavior.
   */
  headerAction?: ReactNode;
  /**
   * Replaces the default unlocked actions. Pass `null` to hide them.
   * Omitted keeps the default, preserving existing map behavior.
   */
  unlockedActions?: ReactNode;
  /** Domain glossary terms highlighted in the card's learner-facing text. */
  glossary?: readonly GlossaryTerm[];
}

/**
 * One interactive knowledge card.
 *
 * The card shows the information gap first, reveals one prompt at a time, and
 * visibly charges as the learner explores. Completion is discovery, not
 * mastery.
 */
export default function KnowledgeCard({
  node,
  moduleTitle,
  state,
  revealedPromptIds,
  revealedElementIds,
  nextNode,
  reducedMotion,
  onReveal,
  onRevealElement,
  onClose,
  onDiscoverNext,
  readOnly = false,
  headerAction,
  unlockedActions,
  glossary = [],
}: KnowledgeCardProps) {
  const elementSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [promptId, ids] of Object.entries(revealedElementIds)) {
      map.set(promptId, new Set(ids));
    }
    return map;
  }, [revealedElementIds]);
  const revealed = useMemo(() => new Set(revealedPromptIds), [revealedPromptIds]);
  const promptComplete = (prompt: KnowledgeNode["prompts"][number]) =>
    isPromptComplete(prompt, revealed, elementSets.get(prompt.id));
  const { completed: revealedCount, total } = nodePromptProgress(
    node,
    revealed,
    elementSets,
  );
  const unlocked = state === "unlocked" && !readOnly;

  return (
    <GlossaryProvider terms={glossary} subject={node.title}>
      <section
        className={`knowledge-card-panel${unlocked ? " knowledge-card-panel--unlocked" : ""}`}
        aria-labelledby={`knowledge-card-title-${node.id}`}
      >
      <header className="knowledge-card-header">
        <div>
          <p className="knowledge-card-kicker">
            Knowledge Node · <InlineText text={moduleTitle} terms={[]} />
          </p>
          <h2 id={`knowledge-card-title-${node.id}`}>
            <InlineText text={node.title} terms={[]} />
          </h2>
        </div>
        {headerAction === undefined ? (
          <button type="button" className="knowledge-card-close" onClick={onClose}>
            Back to map
          </button>
        ) : (
          headerAction
        )}
      </header>

      <div className="knowledge-card-charge">
        <div className="knowledge-card-charge-label">
          <span>Node charge</span>
          <span aria-label={`${revealedCount} of ${total} prompts revealed`}>
            {revealedCount} / {total}
          </span>
        </div>
        <div
          className="knowledge-card-charge-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={revealedCount}
        >
          <span
            className="knowledge-card-charge-fill"
            style={{ width: `${total === 0 ? 0 : (revealedCount / total) * 100}%` }}
          />
        </div>
      </div>

      <ul className="knowledge-card-prompts">
        {node.prompts.map((prompt) => (
          <KnowledgePrompt
            key={prompt.id}
            prompt={prompt}
            revealed={promptComplete(prompt)}
            revealedElementIds={revealedElementIds[prompt.id] ?? []}
            disabled={readOnly}
            onReveal={onReveal}
            onRevealElement={onRevealElement}
          />
        ))}
      </ul>

      {node.source_refs && node.source_refs.length > 0 ? (
        <details className="knowledge-sources">
          <summary>Sources</summary>
          <ul>
            {node.source_refs.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {unlocked ? (
        <div
          className={`knowledge-card-unlocked${
            reducedMotion ? "" : " knowledge-card-unlocked--animated"
          }`}
        >
          <p className="knowledge-card-unlocked-title">✨ UNLOCKED! ✨</p>
          <p className="knowledge-card-unlocked-node">
            <InlineText text={node.title} terms={[]} />
          </p>
          <div className="knowledge-card-actions">
            {unlockedActions === undefined ? (
              <>
                <button type="button" onClick={onClose}>
                  Continue to Knowledge Map
                </button>
                {nextNode && nextNode.id !== node.id ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onDiscoverNext(nextNode.id)}
                  >
                    Discover <InlineText text={nextNode.title} terms={[]} /> →
                  </button>
                ) : null}
              </>
            ) : (
              unlockedActions
            )}
          </div>
        </div>
      ) : null}
      </section>
    </GlossaryProvider>
  );
}
