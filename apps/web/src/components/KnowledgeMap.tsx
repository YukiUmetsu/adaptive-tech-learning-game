import type {
  KnowledgeNode,
  LearningDomainResponse,
  LearningModule,
} from "../api/types";
import type { DerivedLearningState, NodeState } from "../state/learningProgress";

interface KnowledgeMapProps {
  domain: LearningDomainResponse;
  module: LearningModule;
  state: DerivedLearningState;
  justUnlockedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const NODE_ICON: Record<NodeState, string> = {
  locked: "🔒",
  ready: "●",
  in_progress: "◐",
  unlocked: "✓",
};

const NODE_STATE_LABEL: Record<NodeState, string> = {
  locked: "Locked",
  ready: "Ready to discover",
  in_progress: "In progress",
  unlocked: "Unlocked",
};

function requiredPrompts(node: KnowledgeNode) {
  const required = node.prompts.filter((prompt) => prompt.required !== false);
  return required.length > 0 ? required : node.prompts;
}

function nodeCharge(node: KnowledgeNode, revealed: readonly string[]): string {
  const required = requiredPrompts(node);
  const seen = new Set(revealed);
  const count = required.filter((prompt) => seen.has(prompt.id)).length;
  return `${count}/${required.length}`;
}

function unmetPrerequisiteTitles(
  node: KnowledgeNode,
  domain: LearningDomainResponse,
  state: DerivedLearningState,
): string[] {
  const titles: string[] = [];
  for (const prerequisiteId of node.prerequisite_node_ids ?? []) {
    if (!state.unlockedNodeIds.has(prerequisiteId)) {
      const prerequisite = domain.modules
        .flatMap((module) => module.nodes)
        .find((candidate) => candidate.id === prerequisiteId);
      if (prerequisite) {
        titles.push(prerequisite.title);
      }
    }
  }
  return titles;
}

/**
 * One knowledge-map group (a module) rendered as a vertical path.
 *
 * A single module is shown at a time so the map stays readable and does not
 * overwhelm the learner. Nodes are ordered by their authored map position and
 * joined by a path connector; state comes from discovery progress. There is no
 * absolute canvas, so nodes can never overlap and narrow screens need no
 * fallback layout.
 */
export default function KnowledgeMap({
  domain,
  module,
  state,
  justUnlockedNodeId,
  onSelectNode,
}: KnowledgeMapProps) {
  const progress = state.moduleProgress[module.id];
  const available = progress?.available ?? false;
  const lockedBy = (module.prerequisite_module_ids ?? [])
    .map((id) => domain.modules.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is LearningModule => candidate !== undefined);

  const orderedNodes = [...module.nodes].sort(
    (a, b) => a.map_position.y - b.map_position.y || a.map_position.x - b.map_position.x,
  );

  return (
    <section
      className={`knowledge-module${available ? "" : " knowledge-module--locked"}`}
      aria-label={module.title}
    >
      <header className="knowledge-module-header">
        <div>
          <h3>{module.title}</h3>
          <p className="muted">
            {progress ? `${progress.unlocked} / ${progress.total} Nodes Online` : ""}
          </p>
        </div>
        {progress?.complete ? (
          <span className="badge knowledge-module-complete">Module Complete</span>
        ) : null}
      </header>

      {!available && lockedBy.length > 0 ? (
        <p className="knowledge-module-lock-note">
          🔒 Complete {lockedBy.map((candidate) => candidate.title).join(", ")} to
          unlock this path.
        </p>
      ) : null}

      <ol className="knowledge-path" role="list" aria-label={module.title}>
        {orderedNodes.map((node, index) => {
          const previous = index > 0 ? orderedNodes[index - 1] : null;
          const nodeState = state.nodeState[node.id] ?? "locked";
          const lit =
            previous !== null &&
            state.unlockedNodeIds.has(previous.id) &&
            state.unlockedNodeIds.has(node.id);

          return (
            <li key={node.id} className="knowledge-path-item">
              {previous ? (
                <span
                  className={`knowledge-path-connector${
                    lit ? " knowledge-path-connector--lit" : ""
                  }${
                    justUnlockedNodeId === node.id
                      ? " knowledge-path-connector--animating"
                      : ""
                  }`}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                className={`knowledge-node knowledge-node--${nodeState}${
                  justUnlockedNodeId === node.id
                    ? " knowledge-node--just-unlocked"
                    : ""
                }`}
                aria-label={`${node.title}, ${NODE_STATE_LABEL[nodeState]}`}
                aria-disabled={nodeState === "locked"}
                onClick={() => {
                  if (nodeState !== "locked") {
                    onSelectNode(node.id);
                  }
                }}
              >
                <span className="knowledge-node-icon" aria-hidden="true">
                  {NODE_ICON[nodeState]}
                </span>
                <span className="knowledge-node-body">
                  <span className="knowledge-node-title">{node.title}</span>
                  <span className="knowledge-node-meta">
                    {metaText(node, nodeState, domain, state)}
                  </span>
                </span>
                <span className="knowledge-node-side">
                  {nodeState === "ready" ? (
                    <span className="knowledge-node-cta" aria-hidden="true">
                      Discover ›
                    </span>
                  ) : null}
                  {nodeState === "in_progress" || nodeState === "unlocked" ? (
                    <span className="knowledge-node-charge" aria-hidden="true">
                      <span className="knowledge-node-charge-bar">
                        <span
                          className="knowledge-node-charge-fill"
                          style={{
                            width: `${chargePercent(node, state.revealedPromptIds[node.id] ?? [])}%`,
                          }}
                        />
                      </span>
                      <span className="knowledge-node-charge-count">
                        {nodeCharge(node, state.revealedPromptIds[node.id] ?? [])}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function metaText(
  node: KnowledgeNode,
  nodeState: NodeState,
  domain: LearningDomainResponse,
  state: DerivedLearningState,
): string {
  if (nodeState === "locked") {
    const unmet = unmetPrerequisiteTitles(node, domain, state);
    return unmet.length > 0 ? `Locked · after ${unmet.join(", ")}` : "Locked";
  }
  return NODE_STATE_LABEL[nodeState];
}

function chargePercent(node: KnowledgeNode, revealed: readonly string[]): number {
  const required = requiredPrompts(node);
  if (required.length === 0) {
    return 0;
  }
  const seen = new Set(revealed);
  const count = required.filter((prompt) => seen.has(prompt.id)).length;
  return (count / required.length) * 100;
}
