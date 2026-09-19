import type { KnowledgeNode } from "../api/types";
import type { NodeState } from "../state/learningProgress";
import KnowledgePrompt from "./KnowledgePrompt";

interface KnowledgeCardProps {
  node: KnowledgeNode;
  moduleTitle: string;
  state: NodeState;
  revealedPromptIds: readonly string[];
  nextNode: KnowledgeNode | null;
  reducedMotion: boolean;
  onReveal: (promptId: string) => void;
  onClose: () => void;
  onDiscoverNext: (nodeId: string) => void;
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
  nextNode,
  reducedMotion,
  onReveal,
  onClose,
  onDiscoverNext,
}: KnowledgeCardProps) {
  const revealed = new Set(revealedPromptIds);
  const requiredPrompts = node.prompts.filter((prompt) => prompt.required !== false);
  const counted = requiredPrompts.length > 0 ? requiredPrompts : node.prompts;
  const revealedCount = counted.filter((prompt) => revealed.has(prompt.id)).length;
  const total = counted.length;
  const unlocked = state === "unlocked";

  return (
    <section
      className={`knowledge-card-panel${unlocked ? " knowledge-card-panel--unlocked" : ""}`}
      aria-labelledby={`knowledge-card-title-${node.id}`}
    >
      <header className="knowledge-card-header">
        <div>
          <p className="knowledge-card-kicker">Knowledge Node · {moduleTitle}</p>
          <h2 id={`knowledge-card-title-${node.id}`}>{node.title}</h2>
        </div>
        <button type="button" className="knowledge-card-close" onClick={onClose}>
          Back to map
        </button>
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
            revealed={revealed.has(prompt.id)}
            onReveal={onReveal}
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
          <p className="knowledge-card-unlocked-node">{node.title}</p>
          <div className="knowledge-card-actions">
            <button type="button" onClick={onClose}>
              Continue to Knowledge Map
            </button>
            {nextNode && nextNode.id !== node.id ? (
              <button
                type="button"
                className="primary"
                onClick={() => onDiscoverNext(nextNode.id)}
              >
                Discover {nextNode.title} →
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
