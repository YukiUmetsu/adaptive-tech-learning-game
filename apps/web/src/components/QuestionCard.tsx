import { lazy, Suspense, useMemo, useState } from "react";

import type {
  AnswerPayload,
  CanonicalAnswer,
  FeedbackResponse,
  PlacementPoint,
  QuestionView,
  ReconstructionAnswerPayload,
} from "../api/types";
import { firstSourceNodeId } from "../lib/nodeConnection";
import { shuffledChoices, shuffledOrder } from "../lib/shuffle";
import { typedBlankStatuses } from "../lib/typedBlank";
import type { PythonExecutionResult } from "../pythonExecution";
import { toRuntimeTests } from "../pythonExecution/protocol";
import BranchingScenarioInteraction from "./BranchingScenarioInteraction";
import ClassificationInteraction from "./ClassificationInteraction";
import EvidenceSelectionInteraction from "./EvidenceSelectionInteraction";
import FillSlotsInteraction from "./FillSlotsInteraction";
import MultipleChoiceInteraction from "./MultipleChoiceInteraction";
import MultipleResponseInteraction from "./MultipleResponseInteraction";
import NodeConnectionInteraction from "./NodeConnectionInteraction";
import OrderingInteraction from "./OrderingInteraction";
import ReconstructionInteraction from "./ReconstructionInteraction";
import SpotTheFaultInteraction from "./SpotTheFaultInteraction";
import TwoDimensionalPlacementInteraction from "./TwoDimensionalPlacementInteraction";
import TypedFillBlankInteraction from "./TypedFillBlankInteraction";

// Code-split the Python editor and execution client: only a rendered
// `python_code` question downloads them. Non-Python learners never do.
const PythonCodeInteraction = lazy(() => import("./PythonCodeInteraction"));

interface QuestionCardProps {
  question: QuestionView;
  disabled?: boolean;
  /** Server feedback for this question, used for per-blank presentation state. */
  feedback?: FeedbackResponse | null;
  /**
   * Canonical answer shipped with ordinary study missions.
   *
   * Only used to read authored `python_code` tests, which the browser must have
   * before it can execute them. Practice tests never receive it.
   */
  canonicalAnswer?: CanonicalAnswer;
  onSubmit: (answer: AnswerPayload) => void;
}

export default function QuestionCard({
  question,
  disabled = false,
  feedback = null,
  canonicalAnswer,
  onSubmit,
}: QuestionCardProps) {
  const [classification, setClassification] = useState<Record<string, string>>(
    {},
  );
  const [ordering, setOrdering] = useState<string[]>(() =>
    question.interaction.type === "ordering"
      ? // Authored items are in answer order; shuffle so the puzzle is not
        // pre-solved. Seeded by the question id for stable rendering.
        shuffledOrder(
          question.interaction.items.map((item) => item.id),
          question.id,
        )
      : [],
  );
  const [edges, setEdges] = useState<string[][]>([]);
  const [reconstruction, setReconstruction] =
    useState<ReconstructionAnswerPayload>({ placements: {}, edges: [] });
  const [evidence, setEvidence] = useState<string[]>([]);
  const [faults, setFaults] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<string[]>([]);
  const [positions, setPositions] = useState<Record<string, PlacementPoint>>(
    {},
  );
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [choiceIds, setChoiceIds] = useState<string[]>([]);
  const [pythonCode, setPythonCode] = useState<string>(() =>
    question.interaction.type === "python_code"
      ? question.interaction.starter_code
      : "",
  );
  const [pythonResult, setPythonResult] =
    useState<PythonExecutionResult | null>(null);

  const typedStatuses =
    question.interaction.type === "typed_fill_blank"
      ? typedBlankStatuses(question.interaction.slots, slots, feedback)
      : undefined;

  // The narrow-screen connection builder can be seeded with a starting source
  // from the question. Only one node id crosses into the interaction; the
  // desktop graph ignores it, and no edge or target is exposed.
  const connectionStartNodeId =
    question.interaction.type === "node_connection"
      ? firstSourceNodeId(canonicalAnswer)
      : undefined;

  // Choice options are authored with the correct answer first, so shuffle the
  // display order. Scoring is keyed by choice id, so order is free to change.
  const choiceOptions = useMemo(
    () =>
      question.interaction.type === "multiple_choice" ||
      question.interaction.type === "multiple_response"
        ? shuffledChoices(
            question.interaction.choices,
            `${question.id}:${question.interaction.type}`,
          )
        : [],
    [question],
  );

  const canSubmit = (() => {
    switch (question.interaction.type) {
      case "classification":
        return question.interaction.items.every(
          (item) => classification[item.id],
        );
      case "ordering":
        return ordering.length === question.interaction.items.length;
      case "node_connection":
        return edges.length > 0;
      case "reconstruction":
        return question.interaction.slots.every(
          (slot) => reconstruction.placements[slot.id],
        );
      case "evidence_selection":
        return evidence.length > 0;
      case "spot_the_fault":
        return faults.length > 0;
      case "fill_slots":
      case "configuration_builder":
      case "command_assembly":
        return Object.keys(slots).length > 0;
      case "troubleshooting":
      case "scenario_choice_chain":
        return choices.length > 0;
      case "two_dimensional_placement":
        return question.interaction.items.every((item) => positions[item.id]);
      case "typed_fill_blank":
        return question.interaction.slots.every(
          (slot) => (slots[slot.id] ?? "").trim().length > 0,
        );
      case "multiple_choice":
        return choiceId !== null;
      case "multiple_response":
        return choiceIds.length > 0;
      case "python_code":
        // Tests must have run at least once. A syntax/runtime/timeout result
        // has no test counts to submit, so it is not an attempt yet.
        return (
          pythonResult !== null &&
          (pythonResult.status === "passed" || pythonResult.status === "failed")
        );
    }
  })();

  const handleSubmit = () => {
    switch (question.interaction.type) {
      case "classification":
        onSubmit({ placements: classification });
        return;
      case "ordering":
        onSubmit({ ordered_ids: ordering });
        return;
      case "node_connection":
        onSubmit({ edges });
        return;
      case "reconstruction":
        onSubmit({ reconstruction });
        return;
      case "evidence_selection":
        onSubmit({ evidence_ids: evidence });
        return;
      case "spot_the_fault":
        onSubmit({ faulty_ids: faults });
        return;
      case "fill_slots":
        onSubmit({ slot_values: slots });
        return;
      case "configuration_builder":
        onSubmit({ assignments: slots });
        return;
      case "command_assembly":
        onSubmit({ token_values: slots });
        return;
      case "troubleshooting":
      case "scenario_choice_chain":
        onSubmit({ choice_path: choices });
        return;
      case "two_dimensional_placement":
        onSubmit({ positions });
        return;
      case "typed_fill_blank":
        onSubmit({ typed_answers: slots });
        return;
      case "multiple_choice":
        if (choiceId !== null) {
          onSubmit({ choice_id: choiceId });
        }
        return;
      case "multiple_response":
        onSubmit({ choice_ids: choiceIds });
        return;
      case "python_code": {
        const tests = pythonResult?.tests ?? [];
        const total = tests.length;
        const passed = tests.filter((test) => test.passed).length;
        onSubmit({ python_results: { passed, total } });
        return;
      }
    }
  };

  const pythonTests =
    question.interaction.type === "python_code" &&
    canonicalAnswer?.type === "python_code"
      ? toRuntimeTests(canonicalAnswer.tests)
      : [];

  // If the isolated runtime cannot start, let the learner continue instead of
  // being stuck on this question. It is recorded as a zero-pass attempt, which
  // is the lowest reward tier, so it cannot be abused to gain progress.
  const handlePythonUnavailable = () => {
    if (pythonTests.length > 0) {
      onSubmit({ python_results: { passed: 0, total: pythonTests.length } });
    }
  };

  return (
    <section className="question" aria-label={question.prompt}>
      {question.instruction ? (
        <p className="question-instruction">{question.instruction}</p>
      ) : null}
      {question.interaction.type === "classification" ? (
        <ClassificationInteraction
          items={question.interaction.items}
          categories={question.interaction.categories}
          value={classification}
          disabled={disabled}
          onChange={setClassification}
        />
      ) : null}

      {question.interaction.type === "ordering" ? (
        <OrderingInteraction
          items={question.interaction.items}
          value={ordering}
          disabled={disabled}
          onChange={setOrdering}
        />
      ) : null}

      {question.interaction.type === "node_connection" ? (
        <NodeConnectionInteraction
          nodes={question.interaction.nodes}
          value={edges}
          disabled={disabled}
          onChange={setEdges}
          startNodeId={connectionStartNodeId}
        />
      ) : null}

      {question.interaction.type === "reconstruction" ? (
        <ReconstructionInteraction
          layout={question.interaction.layout}
          fixedNodes={question.interaction.fixed_nodes}
          pieces={question.interaction.pieces}
          slots={question.interaction.slots}
          value={reconstruction}
          disabled={disabled}
          onChange={setReconstruction}
        />
      ) : null}

      {question.interaction.type === "evidence_selection" ? (
        <EvidenceSelectionInteraction
          evidence={question.interaction.evidence}
          value={evidence}
          disabled={disabled}
          onChange={setEvidence}
        />
      ) : null}

      {question.interaction.type === "spot_the_fault" ? (
        <SpotTheFaultInteraction
          elements={question.interaction.elements}
          value={faults}
          disabled={disabled}
          onChange={setFaults}
        />
      ) : null}

      {question.interaction.type === "fill_slots" ? (
        <FillSlotsInteraction
          slots={question.interaction.slots}
          options={question.interaction.options}
          value={slots}
          disabled={disabled}
          onChange={setSlots}
        />
      ) : null}

      {question.interaction.type === "configuration_builder" ? (
        <FillSlotsInteraction
          slots={question.interaction.slots}
          options={question.interaction.pieces}
          value={slots}
          disabled={disabled}
          onChange={setSlots}
          optionsLabel="Components"
          slotsLabel="Configuration roles"
        />
      ) : null}

      {question.interaction.type === "command_assembly" ? (
        <FillSlotsInteraction
          slots={question.interaction.slots}
          options={question.interaction.tokens}
          value={slots}
          disabled={disabled}
          onChange={setSlots}
          optionsLabel="Tokens"
          slotsLabel="Command parts"
        />
      ) : null}

      {question.interaction.type === "two_dimensional_placement" ? (
        <TwoDimensionalPlacementInteraction
          xAxis={question.interaction.x_axis}
          yAxis={question.interaction.y_axis}
          items={question.interaction.items}
          value={positions}
          disabled={disabled}
          onChange={setPositions}
        />
      ) : null}

      {question.interaction.type === "typed_fill_blank" ? (
        <TypedFillBlankInteraction
          content={question.interaction.content}
          slots={question.interaction.slots}
          value={slots}
          disabled={disabled}
          statuses={typedStatuses}
          onChange={setSlots}
        />
      ) : null}

      {question.interaction.type === "multiple_choice" ? (
        <MultipleChoiceInteraction
          choices={choiceOptions}
          value={choiceId}
          disabled={disabled}
          onChange={setChoiceId}
        />
      ) : null}

      {question.interaction.type === "multiple_response" ? (
        <MultipleResponseInteraction
          choices={choiceOptions}
          requiredSelections={question.interaction.required_selections}
          value={choiceIds}
          disabled={disabled}
          onChange={setChoiceIds}
        />
      ) : null}

      {question.interaction.type === "python_code" ? (
        <Suspense
          fallback={
            <p role="status" className="python-code-status">
              Preparing Python editor…
            </p>
          }
        >
          <PythonCodeInteraction
            interaction={question.interaction}
            tests={pythonTests}
            value={pythonCode}
            disabled={disabled}
            onChange={setPythonCode}
            onResult={setPythonResult}
            onUnavailable={
              pythonTests.length > 0 ? handlePythonUnavailable : undefined
            }
          />
        </Suspense>
      ) : null}

      {question.interaction.type === "troubleshooting" ||
      question.interaction.type === "scenario_choice_chain" ? (
        <BranchingScenarioInteraction
          startStepId={question.interaction.start_step_id}
          steps={question.interaction.steps}
          value={choices}
          seed={question.id}
          disabled={disabled}
          onChange={setChoices}
        />
      ) : null}

      <div className="question-actions">
        <button
          type="button"
          className="primary"
          disabled={disabled || !canSubmit}
          onClick={handleSubmit}
        >
          Submit answer
        </button>
      </div>
    </section>
  );
}
