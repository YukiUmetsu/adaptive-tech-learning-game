import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { KnowledgeNode } from "../api/types";
import type { MissionRunner } from "../hooks/useMissionRunner";
import { useLearningDomain } from "../hooks/useLearningDomain";
import { prefersReducedMotion } from "../lib/motion";
import { recordStudyActivity } from "../state/focus";
import {
  deriveLearningState,
  loadDomainProgress,
  mergeServerDiscovery,
  revealElement as revealElementInProgress,
  revealPrompt,
  type DomainLearningProgress,
} from "../state/learningProgress";
import { loadServerDiscovery } from "../state/syncAuxiliary";
import FeedbackPanel from "./FeedbackPanel";
import InlineText from "./InlineText";
import KnowledgeCard from "./KnowledgeCard";
import QuestionCard from "./QuestionCard";
import QuizCompletionSummary from "./QuizCompletionSummary";

interface ChallengeRunnerProps {
  runner: MissionRunner;
  dailyReturnTo?: string;
}

/**
 * Runs one authored multi-stage challenge.
 *
 * A challenge is not a new interaction type: it orchestrates existing question
 * and knowledge-node activities in one ordered, resumable sequence. Question
 * stages reuse the ordinary mission runner (local scoring, queued events, one
 * sync boundary); node stages reuse the Knowledge Map card and its local
 * discovery progress. There is no per-stage network request.
 */
export default function ChallengeRunner({
  runner,
  dailyReturnTo,
}: ChallengeRunnerProps) {
  const challenge = runner.challenge;
  const stage = runner.currentStage;
  const total = runner.total;
  const isLast = runner.stageIndex >= total - 1;

  if (runner.phase === "summary") {
    return (
      <div className="mission-page">
        <QuizCompletionSummary
          mission={runner.mission!}
          attempts={runner.attempts}
          syncState={runner.syncState}
          dailyReturnTo={dailyReturnTo}
          onRetrySync={() => void runner.sync()}
        />
      </div>
    );
  }

  if (!challenge || !stage) {
    return (
      <section className="mission-page">
        <h1>Challenge unavailable</h1>
        <p>This challenge is not stored on this device.</p>
        <p>
          <Link to="/tracks">Back to learning tracks</Link>
        </p>
      </section>
    );
  }

  const completed = runner.stageIndex;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section className="mission-page challenge-page" aria-label="Challenge">
      <header className="mission-header" data-testid="challenge-header">
        <div className="mission-meta">
          <span className="badge">Challenge</span>
          <span className="muted">
            Stage {runner.stageIndex + 1} of {total}
          </span>
        </div>
        <h1>
          <InlineText text={challenge.title} />
        </h1>
        {challenge.description ? (
          <p className="challenge-brief muted">
            <InlineText text={challenge.description} />
          </p>
        ) : null}
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-label="Challenge progress"
        >
          <div
            className="progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      {stage.kind === "learning_node" ? (
        <ChallengeNodeStage
          key={`node-${stage.id}`}
          runner={runner}
          nodeId={stage.node_id}
          domainId={stage.domain_id}
          isLast={isLast}
        />
      ) : (
        <ChallengeQuestionStage runner={runner} isLast={isLast} />
      )}
    </section>
  );
}

/** One question stage: ordinary local scoring and feedback. */
function ChallengeQuestionStage({
  runner,
  isLast,
}: {
  runner: MissionRunner;
  isLast: boolean;
}) {
  const question = runner.question;
  if (!question) {
    return <p role="alert">This stage is unavailable right now.</p>;
  }

  return (
    <>
      <h2 className="challenge-stage-prompt">
        <InlineText text={question.prompt} />
      </h2>
      <QuestionCard
        key={question.id}
        question={question}
        disabled={runner.submitting || runner.phase === "feedback"}
        feedback={runner.feedback}
        canonicalAnswer={question.canonical_answer}
        onSubmit={(answer) => void runner.submit(answer)}
      />

      {runner.error ? <p role="alert">{runner.error}</p> : null}

      {runner.feedback ? (
        <FeedbackPanel
          feedback={runner.feedback}
          question={question}
          submitted={runner.lastAnswer}
          isLast={isLast}
          onRetry={runner.retry}
          onNext={runner.next}
        />
      ) : null}
    </>
  );
}

/**
 * One learning-node stage: the Knowledge Map card, completed locally when the
 * node unlocks. It creates no scored evidence and no per-stage request;
 * reveals queue discovery through the existing local-first pipeline.
 */
function ChallengeNodeStage({
  runner,
  nodeId,
  domainId,
  isLast,
}: {
  runner: MissionRunner;
  nodeId: string | null | undefined;
  domainId: string | null | undefined;
  isLast: boolean;
}) {
  const trackId = runner.mission?.certification_id ?? "";
  const { state } = useLearningDomain(trackId, domainId ?? "");
  const [progress, setProgress] = useState<DomainLearningProgress | null>(null);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const data = state.status === "loaded" ? state.data : null;

  useEffect(() => {
    if (data) {
      setProgress(loadDomainProgress(data.certification_version, data.domain.id));
    }
  }, [data]);

  // Local-first: merge persisted discovery asynchronously; a failure is ignored
  // and the card keeps working from local progress.
  useEffect(() => {
    if (!data) {
      return;
    }
    let cancelled = false;
    void loadServerDiscovery(data.certification_id, data.certification_version).then(
      (server) => {
        if (cancelled || !server) {
          return;
        }
        mergeServerDiscovery(
          data.certification_version,
          data.content_version,
          server,
        );
        setProgress(loadDomainProgress(data.certification_version, data.domain.id));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data]);

  const derived = useMemo(
    () => (data ? deriveLearningState(data, progress) : null),
    [data, progress],
  );

  const node: KnowledgeNode | null = useMemo(() => {
    if (!data || !nodeId) {
      return null;
    }
    return (
      data.modules
        .flatMap((module) => module.nodes)
        .find((candidate) => candidate.id === nodeId) ?? null
    );
  }, [data, nodeId]);

  const moduleTitle = useMemo(() => {
    if (!data || !node) {
      return "";
    }
    return (
      data.modules.find((module) =>
        module.nodes.some((candidate) => candidate.id === node.id),
      )?.title ?? ""
    );
  }, [data, node]);

  const unlocked = Boolean(node && derived?.unlockedNodeIds.has(node.id));

  const reveal = useCallback(
    (promptId: string) => {
      if (!data || !node || !derived) {
        return;
      }
      if (derived.nodeState[node.id] === "locked") {
        return;
      }
      recordStudyActivity("reveal");
      setProgress(
        revealPrompt(
          data.certification_version,
          data.domain.id,
          data.content_version,
          node.id,
          promptId,
        ),
      );
    },
    [data, node, derived],
  );

  const revealElement = useCallback(
    (promptId: string, elementId: string) => {
      if (!data || !node || !derived) {
        return;
      }
      if (derived.nodeState[node.id] === "locked") {
        return;
      }
      recordStudyActivity("table_reveal");
      setProgress(
        revealElementInProgress(
          data.certification_version,
          data.domain.id,
          data.content_version,
          node.id,
          promptId,
          elementId,
        ),
      );
    },
    [data, node, derived],
  );

  const advance = useCallback(() => {
    recordStudyActivity("mission_next");
    runner.next();
  }, [runner]);

  if (state.status === "loading") {
    return <p role="status">Loading stage…</p>;
  }

  if (!data || !node || !derived) {
    return (
      <section className="quest-task" aria-label="Current stage">
        <p role="alert">This stage is unavailable right now.</p>
      </section>
    );
  }

  return (
    <section className="quest-task" aria-label="Current stage">
      <p className="quest-task-kicker">Review stage</p>
      <KnowledgeCard
        node={node}
        moduleTitle={moduleTitle}
        state={derived.nodeState[node.id] ?? "locked"}
        revealedPromptIds={derived.revealedPromptIds[node.id] ?? []}
        revealedElementIds={derived.revealedElementIds[node.id] ?? {}}
        nextNode={null}
        reducedMotion={reducedMotion}
        onReveal={reveal}
        onRevealElement={revealElement}
        onClose={advance}
        onDiscoverNext={() => {}}
        headerAction={null}
        glossary={data.glossary}
        unlockedActions={
          unlocked ? (
            <button type="button" className="primary" onClick={advance}>
              {isLast ? "Finish challenge" : "Next stage →"}
            </button>
          ) : (
            <span className="muted">
              Reveal the prompts to continue.
            </span>
          )
        }
      />
    </section>
  );
}
