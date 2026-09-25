import type {
  AnswerPayload,
  QuestionView,
  ReconstructionAnswerPayload,
} from "../api/types";
import { shuffledChoices, shuffledOrder } from "../lib/shuffle";
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

interface ExamInteractionProps {
  question: QuestionView;
  /** The answer collected so far, or `undefined` while unanswered. */
  value: AnswerPayload | undefined;
  disabled?: boolean;
  /** Called with the whole answer primitive whenever the learner changes it. */
  onChange: (answer: AnswerPayload) => void;
}

const EMPTY_RECONSTRUCTION: ReconstructionAnswerPayload = {
  placements: {},
  edges: [],
};

/**
 * Interaction renderer for the practice-test (exam) surface.
 *
 * Exam items are not limited to choice questions: authored exams may use any
 * interaction type. This renders the controlled interaction for the question
 * and reports the matching [`AnswerPayload`] as the learner works, without any
 * feedback or per-question submission. Full study missions use `QuestionCard`,
 * which adds server feedback and Python execution; exams never do.
 */
export default function ExamInteraction({
  question,
  value,
  disabled = false,
  onChange,
}: ExamInteractionProps) {
  const interaction = question.interaction;

  switch (interaction.type) {
    case "multiple_choice":
      return (
        <MultipleChoiceInteraction
          choices={shuffledChoices(
            interaction.choices,
            `${question.id}:multiple_choice`,
          )}
          value={value?.choice_id ?? null}
          disabled={disabled}
          onChange={(choice_id) => onChange({ choice_id })}
        />
      );
    case "multiple_response":
      return (
        <MultipleResponseInteraction
          choices={shuffledChoices(
            interaction.choices,
            `${question.id}:multiple_response`,
          )}
          requiredSelections={interaction.required_selections}
          value={value?.choice_ids ?? []}
          disabled={disabled}
          onChange={(choice_ids) => onChange({ choice_ids })}
        />
      );
    case "classification":
      return (
        <ClassificationInteraction
          items={interaction.items}
          categories={interaction.categories}
          value={value?.placements ?? {}}
          disabled={disabled}
          onChange={(placements) => onChange({ placements })}
        />
      );
    case "ordering":
      return (
        <OrderingInteraction
          items={interaction.items}
          // Items are authored in answer order, so seed the shuffled view once;
          // the persisted answer takes over as soon as the learner reorders.
          value={
            value?.ordered_ids ??
            shuffledOrder(
              interaction.items.map((item) => item.id),
              question.id,
            )
          }
          disabled={disabled}
          onChange={(ordered_ids) => onChange({ ordered_ids })}
        />
      );
    case "node_connection":
      return (
        <NodeConnectionInteraction
          nodes={interaction.nodes}
          value={value?.edges ?? []}
          disabled={disabled}
          onChange={(edges) => onChange({ edges })}
        />
      );
    case "reconstruction":
      return (
        <ReconstructionInteraction
          layout={interaction.layout}
          fixedNodes={interaction.fixed_nodes}
          pieces={interaction.pieces}
          slots={interaction.slots}
          value={value?.reconstruction ?? EMPTY_RECONSTRUCTION}
          disabled={disabled}
          onChange={(reconstruction) => onChange({ reconstruction })}
        />
      );
    case "evidence_selection":
      return (
        <EvidenceSelectionInteraction
          evidence={interaction.evidence}
          value={value?.evidence_ids ?? []}
          disabled={disabled}
          onChange={(evidence_ids) => onChange({ evidence_ids })}
        />
      );
    case "spot_the_fault":
      return (
        <SpotTheFaultInteraction
          elements={interaction.elements}
          value={value?.faulty_ids ?? []}
          disabled={disabled}
          onChange={(faulty_ids) => onChange({ faulty_ids })}
        />
      );
    case "fill_slots":
      return (
        <FillSlotsInteraction
          slots={interaction.slots}
          options={interaction.options}
          value={value?.slot_values ?? {}}
          disabled={disabled}
          onChange={(slot_values) => onChange({ slot_values })}
        />
      );
    case "configuration_builder":
      return (
        <FillSlotsInteraction
          slots={interaction.slots}
          options={interaction.pieces}
          value={value?.assignments ?? {}}
          disabled={disabled}
          onChange={(assignments) => onChange({ assignments })}
          optionsLabel="Components"
          slotsLabel="Configuration roles"
        />
      );
    case "command_assembly":
      return (
        <FillSlotsInteraction
          slots={interaction.slots}
          options={interaction.tokens}
          value={value?.token_values ?? {}}
          disabled={disabled}
          onChange={(token_values) => onChange({ token_values })}
          optionsLabel="Tokens"
          slotsLabel="Command parts"
        />
      );
    case "two_dimensional_placement":
      return (
        <TwoDimensionalPlacementInteraction
          xAxis={interaction.x_axis}
          yAxis={interaction.y_axis}
          items={interaction.items}
          value={value?.positions ?? {}}
          disabled={disabled}
          onChange={(positions) => onChange({ positions })}
        />
      );
    case "typed_fill_blank":
      return (
        <TypedFillBlankInteraction
          content={interaction.content}
          slots={interaction.slots}
          value={value?.typed_answers ?? {}}
          disabled={disabled}
          onChange={(typed_answers) => onChange({ typed_answers })}
        />
      );
    case "troubleshooting":
    case "scenario_choice_chain":
      return (
        <BranchingScenarioInteraction
          startStepId={interaction.start_step_id}
          steps={interaction.steps}
          value={value?.choice_path ?? []}
          seed={question.id}
          disabled={disabled}
          onChange={(choice_path) => onChange({ choice_path })}
        />
      );
    case "python_code":
      // Practice-test payloads never carry the authored test suite, so the
      // isolated runtime cannot score here.
      return (
        <p role="alert" className="practice-test-unsupported">
          This question type is not supported in exam simulation yet.
        </p>
      );
  }
}
