import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { KnowledgeNode } from "../api/types";
import KnowledgeCard from "../components/KnowledgeCard";
import KnowledgeMap from "../components/KnowledgeMap";
import KnowledgeMapHud from "../components/KnowledgeMapHud";
import ModuleCompleteCelebration from "../components/ModuleCompleteCelebration";
import NodeUnlockCelebration from "../components/NodeUnlockCelebration";
import { useLearningDomain } from "../hooks/useLearningDomain";
import { prefersReducedMotion } from "../lib/motion";
import {
  deriveLearningState,
  loadDomainProgress,
  nextModuleAfter,
  revealPrompt,
  type DomainLearningProgress,
} from "../state/learningProgress";
import { startMission } from "../state/mission";
import {
  playModuleComplete,
  playNodeUnlock,
  playPathUnlock,
  playReveal,
} from "../state/sound";

function findNode(
  nodes: KnowledgeNode[],
  nodeId: string | null,
): KnowledgeNode | null {
  if (!nodeId) {
    return null;
  }
  return nodes.find((node) => node.id === nodeId) ?? null;
}

/**
 * Pre-quiz knowledge map for one certification domain.
 *
 * The map is curriculum-driven: modules, nodes, prompts, and relationships all
 * come from the API. This page only derives discovery state, persists reveals,
 * and animates/celebrates unlocks. Reveals are never scored.
 *
 * One knowledge-map group (module) is shown at a time. Opening a node swaps the
 * group canvas for its knowledge card, so the map never shifts under the
 * learner's pointer.
 */
export default function DomainLearningPage() {
  const { certificationId, domainId } = useParams();
  const navigate = useNavigate();
  const { state, reload } = useLearningDomain(certificationId, domainId);

  const [progress, setProgress] = useState<DomainLearningProgress | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [unlockCelebration, setUnlockCelebration] = useState<string | null>(null);
  const [moduleCelebration, setModuleCelebration] = useState<string | null>(null);
  const [justUnlockedNodeId, setJustUnlockedNodeId] = useState<string | null>(null);
  const [startingQuiz, setStartingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);

  const data = state.status === "loaded" ? state.data : null;
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    if (!data) {
      return;
    }
    const key = `${data.certification_version}::${data.domain.id}`;
    if (loadedKeyRef.current === key) {
      return;
    }
    loadedKeyRef.current = key;
    setProgress(loadDomainProgress(data.certification_version, data.domain.id));
    setActiveModuleId(null);
    setSelectedNodeId(null);
    setUnlockCelebration(null);
    setModuleCelebration(null);
    setJustUnlockedNodeId(null);
  }, [data]);

  const derived = useMemo(
    () => (data ? deriveLearningState(data, progress) : null),
    [data, progress],
  );

  // Clear the one-shot map highlight after the celebration window so a later
  // re-render does not leave a stale animation class behind.
  useEffect(() => {
    if (!justUnlockedNodeId) {
      return;
    }
    const timeout = window.setTimeout(
      () => setJustUnlockedNodeId(null),
      reducedMotion ? 1400 : 900,
    );
    return () => window.clearTimeout(timeout);
  }, [justUnlockedNodeId, reducedMotion]);

  const nodes = useMemo(
    () => (data ? data.modules.flatMap((module) => module.nodes) : []),
    [data],
  );
  const selectedNode = findNode(nodes, selectedNodeId);
  const moduleForSelected =
    data && selectedNode
      ? data.modules.find((module) =>
          module.nodes.some((node) => node.id === selectedNode.id),
        ) ?? null
      : null;
  const nextNode =
    derived && derived.nextNodeId && derived.nextNodeId !== selectedNodeId
      ? findNode(nodes, derived.nextNodeId)
      : null;

  // Keep the visible group on an available module, defaulting to the first one.
  const activeModule =
    data && derived
      ? data.modules.find(
          (module) =>
            module.id === activeModuleId &&
            (derived.moduleProgress[module.id]?.available ?? false),
        ) ??
        data.modules.find(
          (module) => derived.moduleProgress[module.id]?.available ?? false,
        ) ??
        data.modules[0]
      : null;

  const selectNode = useCallback(
    (nodeId: string) => {
      if (!data) {
        return;
      }
      const module = data.modules.find((candidate) =>
        candidate.nodes.some((node) => node.id === nodeId),
      );
      if (module) {
        setActiveModuleId(module.id);
      }
      setSelectedNodeId(nodeId);
    },
    [data],
  );

  const selectModule = useCallback((moduleId: string) => {
    setActiveModuleId(moduleId);
    setSelectedNodeId(null);
  }, []);

  const reveal = useCallback(
    (node: KnowledgeNode, promptId: string) => {
      if (!data || !derived) {
        return;
      }
      // Locked nodes are never interactive, even if a stray event fires.
      if (derived.nodeState[node.id] === "locked") {
        return;
      }

      const before = derived;
      const updated = revealPrompt(
        data.certification_version,
        data.domain.id,
        data.content_version,
        node.id,
        promptId,
      );
      const after = deriveLearningState(data, updated);
      setProgress(updated);

      if (
        before.unlockedNodeIds.has(node.id) ||
        !after.unlockedNodeIds.has(node.id)
      ) {
        // A normal reveal, or a no-op on an already-unlocked node.
        playReveal();
        return;
      }

      // The node just unlocked. Fire once per completion, derived from state.
      const module = data.modules.find((candidate) =>
        candidate.nodes.some((candidateNode) => candidateNode.id === node.id),
      );
      const moduleJustCompleted =
        module !== undefined &&
        before.moduleProgress[module.id]?.complete === false &&
        after.moduleProgress[module.id]?.complete === true;

      setJustUnlockedNodeId(node.id);

      if (module !== undefined && moduleJustCompleted) {
        playModuleComplete();
        setModuleCelebration(module.id);
        setUnlockCelebration(null);
      } else {
        playNodeUnlock();
        setUnlockCelebration(node.id);
        const openedPath = Object.keys(after.nodeState).some(
          (id) => before.nodeState[id] === "locked" && after.nodeState[id] === "ready",
        );
        if (openedPath) {
          playPathUnlock();
        }
      }
    },
    [data, derived],
  );

  const startDomainQuiz = useCallback(async () => {
    if (!data) {
      return;
    }
    setStartingQuiz(true);
    setQuizError(null);
    try {
      const mission = await startMission({
        certificationId: data.certification_id,
        certificationVersion: data.certification_version,
        mode: "domain_quiz",
        domainId: data.domain.id,
      });
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setQuizError(caught instanceof Error ? caught.message : "Network error");
    } finally {
      setStartingQuiz(false);
    }
  }, [data, navigate]);

  if (state.status === "loading") {
    return <p role="status">Loading knowledge map…</p>;
  }

  if (state.status === "error") {
    return (
      <section>
        <h1>Learning map unavailable</h1>
        <p role="alert">{state.message}</p>
        <div className="knowledge-page-actions">
          <button type="button" onClick={() => void reload()}>
            Try again
          </button>
          <Link to={`/tracks/${certificationId ?? ""}`}>
            Back to {certificationId ?? "certification"}
          </Link>
        </div>
      </section>
    );
  }

  if (!data || !derived || !activeModule) {
    return null;
  }

  const moduleForCelebration = moduleCelebration
    ? data.modules.find((module) => module.id === moduleCelebration) ?? null
    : null;
  const celebrationProgress = moduleForCelebration
    ? derived.moduleProgress[moduleForCelebration.id]
    : null;
  const nextModule = moduleForCelebration
    ? nextModuleAfter(data, moduleForCelebration.id)
    : null;

  return (
    <section className="knowledge-page">
      <header className="knowledge-page-header">
        <div>
          <p className="muted">{data.certification_id} · Domain exploration</p>
          <h1>{data.domain.name}</h1>
          <p className="muted">
            Build the mental model first. {data.learning_design.mastery_note}
          </p>
        </div>
        <Link className="knowledge-page-back" to={`/tracks/${data.certification_id}`}>
          Back to dashboard
        </Link>
      </header>

      <KnowledgeMapHud
        label={data.learning_design.progress_label}
        domainName={data.domain.name}
        unlockedCount={derived.unlockedCount}
        totalCount={derived.totalNodeCount}
        domainComplete={derived.domainComplete}
        modules={data.modules}
        progress={derived.moduleProgress}
        activeModuleId={activeModule.id}
        onSelectModule={selectModule}
      />

      {unlockCelebration ? (
        <NodeUnlockCelebration
          nodeTitle={findNode(nodes, unlockCelebration)?.title ?? ""}
          reducedMotion={reducedMotion}
          onDone={() => setUnlockCelebration(null)}
        />
      ) : null}

      {moduleForCelebration && celebrationProgress ? (
        <ModuleCompleteCelebration
          moduleTitle={moduleForCelebration.title}
          unlockedCount={celebrationProgress.unlocked}
          totalCount={celebrationProgress.total}
          nextModuleTitle={nextModule?.title ?? null}
          domainComplete={derived.domainComplete}
          reducedMotion={reducedMotion}
          startingQuiz={startingQuiz}
          onContinue={() => {
            if (nextModule) {
              setActiveModuleId(nextModule.id);
            }
            setModuleCelebration(null);
          }}
          onStartQuiz={() => void startDomainQuiz()}
        />
      ) : null}

      {selectedNode && moduleForSelected ? (
        <KnowledgeCard
          node={selectedNode}
          moduleTitle={moduleForSelected.title}
          state={derived.nodeState[selectedNode.id] ?? "locked"}
          revealedPromptIds={derived.revealedPromptIds[selectedNode.id] ?? []}
          nextNode={nextNode}
          reducedMotion={reducedMotion}
          onReveal={(promptId) => reveal(selectedNode, promptId)}
          onClose={() => setSelectedNodeId(null)}
          onDiscoverNext={selectNode}
        />
      ) : (
        <KnowledgeMap
          domain={data}
          module={activeModule}
          state={derived}
          justUnlockedNodeId={justUnlockedNodeId}
          onSelectNode={selectNode}
        />
      )}

      {derived.domainComplete ? (
        <section className="knowledge-page-quiz" aria-label="Continue to quiz">
          <div>
            <h2>You built the foundation.</h2>
            <p className="muted">
              You&apos;ve explored the core concepts. Now test whether you can
              retrieve them.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            disabled={startingQuiz}
            onClick={() => void startDomainQuiz()}
          >
            {startingQuiz ? "Starting…" : "🎯 Start Domain Quiz"}
          </button>
        </section>
      ) : null}

      {quizError ? <p role="alert">{quizError}</p> : null}
    </section>
  );
}
