/**
 * Pure TypeScript mirror of the canonical Rust scorer.
 *
 * Local scoring exists for immediate feedback, local mission state, and
 * optimistic reward animation. It is **never** authoritative: `/v1/sync`
 * re-scores the same raw answer primitives against server-known content before
 * accepting evidence, settling Bits, or updating concept state.
 *
 * Every branch here is a deliberate translation of `crates/content/src/scoring.rs`
 * (partial credit, normalization, duplicate handling, tolerant placement,
 * branching-path validation, and structured error conditions). Cross-language
 * golden fixtures in `fixtures/scoring_golden.json` are exercised by both the
 * Rust and TypeScript test suites so the two cannot silently drift.
 */

import type {
  AnswerPayload,
  CanonicalAnswer,
  Interaction,
  PlacementPoint,
} from "../api/types";
import { normalizeTypedAnswer } from "./normalize";

/** The observable outcome of scoring one attempt. */
export interface ScoredAnswer {
  /** Whether the attempt was fully correct. */
  correct: boolean;
  /** Partial score in `[0, 1]`. */
  score: number;
  /** Structured error codes emitted by the scorer. */
  errorCodes: string[];
  /** Short explanation shown after scoring. */
  explanation: string;
  /** Canonical answer, safe to reveal after local scoring. */
  canonicalAnswer: CanonicalAnswer;
}

/**
 * The subset of a [`StudyQuestionView`] the scorer reads.
 *
 * Only ordinary study missions carry these fields; practice tests never do.
 */
export interface ScoreableQuestion {
  interaction: Interaction;
  canonical_answer: CanonicalAnswer;
  explanation: string;
}

/** A malformed answer that cannot be scored. */
export class ScoringError extends Error {
  /** Stable code, mirroring the Rust `ScoringError::code` values. */
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ScoringError";
    this.code = code;
  }
}

type Edge = [string, string];

/** Normalized answer primitives, mirroring Rust `SubmittedAnswer`. */
export type SubmittedAnswer =
  | { kind: "classification"; placements: Record<string, string> }
  | { kind: "ordering"; orderedIds: string[] }
  | { kind: "node_connection"; edges: Edge[] }
  | {
      kind: "reconstruction";
      placements: Record<string, string>;
      edges: Edge[];
    }
  | { kind: "evidence_selection"; selected: string[] }
  | { kind: "spot_the_fault"; selected: string[] }
  | { kind: "fill_slots"; values: Record<string, string> }
  | { kind: "branching"; path: string[] }
  | { kind: "configuration_builder"; assignments: Record<string, string> }
  | { kind: "two_dimensional_placement"; points: Record<string, PlacementPoint> }
  | { kind: "command_assembly"; values: Record<string, string> }
  | { kind: "typed_fill_blank"; values: Record<string, string> }
  | { kind: "multiple_choice"; choiceId: string }
  | { kind: "multiple_response"; choiceIds: string[] }
  | { kind: "python_code"; passed: number; total: number };

/** Scores a raw answer payload against a question's canonical content. */
export function scoreQuestion(
  question: ScoreableQuestion,
  answer: AnswerPayload,
): ScoredAnswer {
  return scoreSubmitted(question, toSubmitted(answer));
}

/** Scores already-normalized answer primitives. */
export function scoreSubmitted(
  question: ScoreableQuestion,
  submitted: SubmittedAnswer,
): ScoredAnswer {
  const outcome = dispatch(question, submitted);
  return {
    correct: outcome.correct,
    score: outcome.score,
    errorCodes: outcome.errorCodes,
    explanation: question.explanation,
    canonicalAnswer: question.canonical_answer,
  };
}

/**
 * Converts the transport `AnswerPayload` into normalized primitives.
 *
 * Exactly one shape must be present, mirroring the API's `to_submitted`.
 */
export function toSubmitted(payload: AnswerPayload): SubmittedAnswer {
  const shapeCount = [
    payload.placements,
    payload.ordered_ids,
    payload.edges,
    payload.reconstruction,
    payload.evidence_ids,
    payload.faulty_ids,
    payload.slot_values,
    payload.choice_path,
    payload.assignments,
    payload.positions,
    payload.token_values,
    payload.typed_answers,
    payload.choice_id,
    payload.choice_ids,
    payload.python_results,
  ].filter((value) => value != null).length;

  if (shapeCount !== 1) {
    throw new ScoringError("malformed_answer");
  }

  if (payload.placements != null) {
    return { kind: "classification", placements: payload.placements };
  }
  if (payload.ordered_ids != null) {
    return { kind: "ordering", orderedIds: payload.ordered_ids };
  }
  if (payload.edges != null) {
    return { kind: "node_connection", edges: parseEdges(payload.edges) };
  }
  if (payload.reconstruction != null) {
    return {
      kind: "reconstruction",
      placements: payload.reconstruction.placements,
      edges: parseEdges(payload.reconstruction.edges ?? []),
    };
  }
  if (payload.evidence_ids != null) {
    return { kind: "evidence_selection", selected: payload.evidence_ids };
  }
  if (payload.faulty_ids != null) {
    return { kind: "spot_the_fault", selected: payload.faulty_ids };
  }
  if (payload.slot_values != null) {
    return { kind: "fill_slots", values: payload.slot_values };
  }
  if (payload.choice_path != null) {
    return { kind: "branching", path: payload.choice_path };
  }
  if (payload.assignments != null) {
    return {
      kind: "configuration_builder",
      assignments: payload.assignments,
    };
  }
  if (payload.positions != null) {
    return {
      kind: "two_dimensional_placement",
      points: payload.positions,
    };
  }
  if (payload.token_values != null) {
    return { kind: "command_assembly", values: payload.token_values };
  }
  if (payload.typed_answers != null) {
    return { kind: "typed_fill_blank", values: payload.typed_answers };
  }
  if (payload.choice_id != null) {
    return { kind: "multiple_choice", choiceId: payload.choice_id };
  }
  if (payload.choice_ids != null) {
    return { kind: "multiple_response", choiceIds: payload.choice_ids };
  }
  if (payload.python_results != null) {
    return {
      kind: "python_code",
      passed: payload.python_results.passed,
      total: payload.python_results.total,
    };
  }

  throw new ScoringError("malformed_answer");
}

function parseEdges(edges: string[][]): Edge[] {
  return edges.map((edge) => {
    if (edge.length !== 2) {
      throw new ScoringError("invalid_edge");
    }
    return [edge[0], edge[1]] as Edge;
  });
}

interface Outcome {
  correct: boolean;
  score: number;
  errorCodes: string[];
}

function interactionMismatch(): never {
  throw new ScoringError("interaction_mismatch");
}

/** Narrows a canonical answer to the type the interaction requires. */
function canonicalOf<T extends CanonicalAnswer["type"]>(
  canonical: CanonicalAnswer,
  type: T,
): Extract<CanonicalAnswer, { type: T }> {
  if (canonical.type !== type) {
    interactionMismatch();
  }
  return canonical as Extract<CanonicalAnswer, { type: T }>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function dispatch(
  question: ScoreableQuestion,
  submitted: SubmittedAnswer,
): Outcome {
  const { interaction, canonical_answer: canonical } = question;

  switch (interaction.type) {
    case "classification":
      if (submitted.kind !== "classification") interactionMismatch();
      return scoreClassification(
        interaction,
        canonicalOf(canonical, "classification"),
        submitted.placements,
      );
    case "ordering":
      if (submitted.kind !== "ordering") interactionMismatch();
      return scoreOrdering(
        interaction,
        canonicalOf(canonical, "ordering"),
        submitted.orderedIds,
      );
    case "node_connection":
      if (submitted.kind !== "node_connection") interactionMismatch();
      return scoreConnection(
        interaction,
        canonicalOf(canonical, "node_connection"),
        submitted.edges,
      );
    case "reconstruction":
      if (submitted.kind !== "reconstruction") interactionMismatch();
      return scoreReconstruction(
        interaction,
        canonicalOf(canonical, "reconstruction"),
        submitted.placements,
        submitted.edges,
      );
    case "evidence_selection":
      if (submitted.kind !== "evidence_selection") interactionMismatch();
      return scoreEvidenceSelection(
        interaction,
        canonicalOf(canonical, "evidence_selection"),
        submitted.selected,
      );
    case "spot_the_fault":
      if (submitted.kind !== "spot_the_fault") interactionMismatch();
      return scoreSpotTheFault(
        interaction,
        canonicalOf(canonical, "spot_the_fault"),
        submitted.selected,
      );
    case "fill_slots":
      if (submitted.kind !== "fill_slots") interactionMismatch();
      return scoreFillSlots(
        interaction,
        canonicalOf(canonical, "fill_slots"),
        submitted.values,
      );
    case "troubleshooting":
      if (submitted.kind !== "branching") interactionMismatch();
      return scoreBranching(
        interaction,
        canonicalOf(canonical, "troubleshooting"),
        submitted.path,
        "troubleshooting",
      );
    case "scenario_choice_chain":
      if (submitted.kind !== "branching") interactionMismatch();
      return scoreBranching(
        interaction,
        canonicalOf(canonical, "scenario_choice_chain"),
        submitted.path,
        "scenario_choice",
      );
    case "configuration_builder":
      if (submitted.kind !== "configuration_builder") interactionMismatch();
      return scoreConfiguration(
        interaction,
        canonicalOf(canonical, "configuration_builder"),
        submitted.assignments,
      );
    case "two_dimensional_placement":
      if (submitted.kind !== "two_dimensional_placement") {
        interactionMismatch();
      }
      return scorePlacement(
        interaction,
        canonicalOf(canonical, "two_dimensional_placement"),
        submitted.points,
      );
    case "command_assembly":
      if (submitted.kind !== "command_assembly") interactionMismatch();
      return scoreCommandAssembly(
        interaction,
        canonicalOf(canonical, "command_assembly"),
        submitted.values,
      );
    case "typed_fill_blank":
      if (submitted.kind !== "typed_fill_blank") interactionMismatch();
      return scoreTypedFillBlank(
        interaction,
        canonicalOf(canonical, "typed_fill_blank"),
        submitted.values,
      );
    case "multiple_choice":
      if (submitted.kind !== "multiple_choice") interactionMismatch();
      return scoreMultipleChoice(
        interaction,
        canonicalOf(canonical, "multiple_choice"),
        submitted.choiceId,
      );
    case "multiple_response":
      if (submitted.kind !== "multiple_response") interactionMismatch();
      return scoreMultipleResponse(
        interaction,
        canonicalOf(canonical, "multiple_response"),
        submitted.choiceIds,
      );
    case "python_code":
      if (submitted.kind !== "python_code") interactionMismatch();
      return scorePythonCode(
        canonicalOf(canonical, "python_code"),
        submitted.passed,
        submitted.total,
      );
  }
}

type ClassificationInteraction = Extract<Interaction, { type: "classification" }>;
type OrderingInteraction = Extract<Interaction, { type: "ordering" }>;
type ConnectionInteraction = Extract<
  Interaction,
  { type: "node_connection" }
>;
type ReconstructionInteraction = Extract<
  Interaction,
  { type: "reconstruction" }
>;
type EvidenceInteraction = Extract<
  Interaction,
  { type: "evidence_selection" }
>;
type FaultInteraction = Extract<Interaction, { type: "spot_the_fault" }>;
type FillSlotsInteraction = Extract<Interaction, { type: "fill_slots" }>;
type BranchingInteraction = Extract<
  Interaction,
  { type: "troubleshooting" } | { type: "scenario_choice_chain" }
>;
type ConfigurationInteraction = Extract<
  Interaction,
  { type: "configuration_builder" }
>;
type PlacementInteraction = Extract<
  Interaction,
  { type: "two_dimensional_placement" }
>;
type CommandInteraction = Extract<Interaction, { type: "command_assembly" }>;
type TypedInteraction = Extract<Interaction, { type: "typed_fill_blank" }>;
type MultipleChoiceInteraction = Extract<
  Interaction,
  { type: "multiple_choice" }
>;
type MultipleResponseInteraction = Extract<
  Interaction,
  { type: "multiple_response" }
>;

function scoreClassification(
  interaction: ClassificationInteraction,
  canonical: Extract<CanonicalAnswer, { type: "classification" }>,
  placements: Record<string, string>,
): Outcome {
  const itemIds = new Set(interaction.items.map((item) => item.id));
  const categoryIds = new Set(interaction.categories.map((c) => c.id));

  for (const [item, category] of Object.entries(placements)) {
    if (!itemIds.has(item)) throw new ScoringError("unknown_item");
    if (!categoryIds.has(category)) {
      throw new ScoringError("unknown_category");
    }
  }

  let correctCount = 0;
  let misplaced = false;
  let incomplete = false;

  for (const item of interaction.items) {
    const category = placements[item.id];
    if (category === undefined) {
      incomplete = true;
    } else if (canonical.placements[item.id] === category) {
      correctCount += 1;
    } else {
      misplaced = true;
    }
  }

  const score = correctCount / interaction.items.length;
  const errorCodes: string[] = [];
  if (misplaced) errorCodes.push("classification_misplaced");
  if (incomplete) errorCodes.push("classification_incomplete");

  return { correct: score >= 1, score, errorCodes };
}

function scoreOrdering(
  interaction: OrderingInteraction,
  canonical: Extract<CanonicalAnswer, { type: "ordering" }>,
  orderedIds: string[],
): Outcome {
  const itemIds = new Set(interaction.items.map((item) => item.id));
  const submitted = new Set(orderedIds);

  if (
    orderedIds.length !== interaction.items.length ||
    submitted.size !== orderedIds.length
  ) {
    throw new ScoringError("invalid_ordering");
  }
  for (const id of orderedIds) {
    if (!itemIds.has(id)) throw new ScoringError("unknown_item");
  }

  let matches = 0;
  canonical.ordered_ids.forEach((expected, index) => {
    if (expected === orderedIds[index]) matches += 1;
  });
  const score = matches / canonical.ordered_ids.length;
  const errorCodes =
    score >= 1 ? [] : ["ordering_invalid_sequence"];

  return { correct: score >= 1, score, errorCodes };
}

function scoreConnection(
  interaction: ConnectionInteraction,
  canonical: Extract<CanonicalAnswer, { type: "node_connection" }>,
  edges: Edge[],
): Outcome {
  const nodeIds = new Set(interaction.nodes.map((node) => node.id));
  const submitted = new Set<string>();

  for (const [from, to] of edges) {
    if (from === to || from === "" || to === "") {
      throw new ScoringError("invalid_edge");
    }
    if (!nodeIds.has(from)) throw new ScoringError("unknown_node");
    if (!nodeIds.has(to)) throw new ScoringError("unknown_node");
    submitted.add(edgeKey(from, to));
  }

  const canonicalEdges = new Set(
    canonical.edges
      .filter((edge) => edge.length === 2)
      .map((edge) => edgeKey(edge[0], edge[1])),
  );

  let hits = 0;
  for (const edge of submitted) {
    if (canonicalEdges.has(edge)) hits += 1;
  }
  const wrong = submitted.size - hits;
  const total = Math.max(canonicalEdges.size, 1);
  const score = clamp((hits - wrong) / total, 0, 1);

  const errorCodes: string[] = [];
  if (hits < canonicalEdges.size) {
    errorCodes.push("connection_missing_relationship");
  }
  if (wrong > 0) errorCodes.push("connection_invalid_relationship");

  return { correct: score >= 1, score, errorCodes };
}

interface SelectionOutcome {
  hits: number;
  falsePositives: number;
  missed: number;
}

function evaluateSelection(
  canonical: string[],
  selected: string[],
): SelectionOutcome {
  const canonicalSet = new Set(canonical);
  const unique = new Set(selected);

  let hits = 0;
  for (const id of unique) {
    if (canonicalSet.has(id)) hits += 1;
  }

  return {
    hits,
    falsePositives: unique.size - hits,
    missed: canonicalSet.size - hits,
  };
}

const GRAPH_PLACEMENT_WEIGHT = 0.7;
const GRAPH_EDGE_WEIGHT = 0.3;

function scoreReconstruction(
  interaction: ReconstructionInteraction,
  canonical: Extract<CanonicalAnswer, { type: "reconstruction" }>,
  placements: Record<string, string>,
  edges: Edge[],
): Outcome {
  const pieceIds = new Set(interaction.pieces.map((piece) => piece.id));
  const nodeIds = new Set<string>([
    ...pieceIds,
    ...interaction.fixed_nodes.map((node) => node.id),
  ]);
  const slotIds = new Set(interaction.slots.map((slot) => slot.id));

  for (const [slotId, pieceId] of Object.entries(placements)) {
    if (!slotIds.has(slotId)) throw new ScoringError("unknown_slot");
    if (!pieceIds.has(pieceId)) throw new ScoringError("unknown_piece");
  }

  const submittedEdges = new Set<string>();
  for (const [from, to] of edges) {
    if (from === to || from === "" || to === "") {
      throw new ScoringError("invalid_edge");
    }
    if (!nodeIds.has(from)) throw new ScoringError("unknown_piece");
    if (!nodeIds.has(to)) throw new ScoringError("unknown_piece");
    submittedEdges.add(edgeKey(from, to));
  }

  const requiredPieces = new Set(Object.values(canonical.placements));
  const placed = new Set(Object.values(placements));
  const linear = interaction.layout === "linear";

  let correctSlots = 0;
  let unfilled = false;
  let wrongPosition = false;
  let wrongComponent = false;

  if (linear) {
    // Slot order is the structure, so each slot must hold its exact piece.
    for (const slot of interaction.slots) {
      const piece = placements[slot.id];
      if (piece === undefined) {
        unfilled = true;
      } else if (canonical.placements[slot.id] === piece) {
        correctSlots += 1;
      } else if (requiredPieces.has(piece)) {
        wrongPosition = true;
      } else {
        wrongComponent = true;
      }
    }
  } else {
    // In a graph, authored slot positions are only a display scaffold: the
    // topology is defined by relationships, so a required piece counts
    // wherever it was placed.
    for (const piece of requiredPieces) {
      if (placed.has(piece)) correctSlots += 1;
    }
    for (const piece of placed) {
      if (!requiredPieces.has(piece)) wrongComponent = true;
    }
    unfilled = interaction.slots.some(
      (slot) => placements[slot.id] === undefined,
    );
  }

  const missingComponents = [...requiredPieces].filter(
    (piece) => !placed.has(piece),
  ).length;

  const denominator = Math.max(Object.keys(canonical.placements).length, 1);
  const placementScore = correctSlots / denominator;

  const canonicalEdgeSet = new Set(
    (canonical.edges ?? [])
      .filter((edge) => edge.length === 2)
      .map((edge) => edgeKey(edge[0], edge[1])),
  );

  const useEdges = !linear && canonicalEdgeSet.size > 0;

  let hitsEdges = 0;
  for (const edge of submittedEdges) {
    if (canonicalEdgeSet.has(edge)) hitsEdges += 1;
  }
  const invalidEdges = submittedEdges.size - hitsEdges;
  const missingEdges = canonicalEdgeSet.size - hitsEdges;
  const edgeScore = clamp(
    (hitsEdges - invalidEdges) / Math.max(canonicalEdgeSet.size, 1),
    0,
    1,
  );

  const score = useEdges
    ? clamp(
        GRAPH_PLACEMENT_WEIGHT * placementScore +
          GRAPH_EDGE_WEIGHT * edgeScore,
        0,
        1,
      )
    : placementScore;

  const errorCodes: string[] = [];
  if (unfilled) errorCodes.push("reconstruction_unfilled_slot");
  if (wrongPosition) errorCodes.push("reconstruction_wrong_position");
  if (wrongComponent) errorCodes.push("reconstruction_wrong_component");
  if (missingComponents > 0) {
    errorCodes.push("reconstruction_missing_component");
  }
  if (useEdges) {
    if (missingEdges > 0) {
      errorCodes.push("reconstruction_missing_relationship");
    }
    if (invalidEdges > 0) {
      errorCodes.push("reconstruction_invalid_relationship");
    }
  }

  const placementsPerfect = linear
    ? correctSlots === interaction.slots.length && missingComponents === 0
    : correctSlots === requiredPieces.size &&
      missingComponents === 0 &&
      !wrongComponent;
  const topologyPerfect =
    !useEdges || (missingEdges === 0 && invalidEdges === 0);
  const correct = placementsPerfect && topologyPerfect;

  return { correct, score, errorCodes };
}

function scoreEvidenceSelection(
  interaction: EvidenceInteraction,
  canonical: Extract<CanonicalAnswer, { type: "evidence_selection" }>,
  selected: string[],
): Outcome {
  const available = new Set(interaction.evidence.map((entry) => entry.id));
  for (const id of selected) {
    if (!available.has(id)) throw new ScoringError("unknown_evidence");
  }

  const outcome = evaluateSelection(canonical.relevant_ids, selected);
  const score = clamp(
    (outcome.hits - outcome.falsePositives) /
      Math.max(canonical.relevant_ids.length, 1),
    0,
    1,
  );

  const errorCodes: string[] = [];
  if (outcome.missed > 0) errorCodes.push("evidence_missing_relevant");
  if (outcome.falsePositives > 0) {
    errorCodes.push("evidence_selected_irrelevant");
  }

  return { correct: score >= 1, score, errorCodes };
}

function scoreSpotTheFault(
  interaction: FaultInteraction,
  canonical: Extract<CanonicalAnswer, { type: "spot_the_fault" }>,
  selected: string[],
): Outcome {
  const available = new Set(interaction.elements.map((entry) => entry.id));
  for (const id of selected) {
    if (!available.has(id)) throw new ScoringError("unknown_element");
  }

  const outcome = evaluateSelection(canonical.faulty_ids, selected);
  const score = clamp(
    (outcome.hits - outcome.falsePositives) /
      Math.max(canonical.faulty_ids.length, 1),
    0,
    1,
  );

  const errorCodes: string[] = [];
  if (outcome.missed > 0) errorCodes.push("fault_missed");
  if (outcome.falsePositives > 0) errorCodes.push("fault_false_positive");

  return { correct: score >= 1, score, errorCodes };
}

function scoreFillSlots(
  interaction: FillSlotsInteraction,
  canonical: Extract<CanonicalAnswer, { type: "fill_slots" }>,
  values: Record<string, string>,
): Outcome {
  const slotIds = new Set(interaction.slots.map((slot) => slot.id));
  const optionIds = new Set(interaction.options.map((option) => option.id));

  for (const [slotId, optionId] of Object.entries(values)) {
    if (!slotIds.has(slotId)) throw new ScoringError("unknown_slot");
    if (!optionIds.has(optionId)) throw new ScoringError("unknown_option");
  }

  let correctCount = 0;
  let incorrect = false;
  let unfilled = false;

  for (const slot of interaction.slots) {
    const option = values[slot.id];
    if (option === undefined) {
      unfilled = true;
    } else if (canonical.values[slot.id] === option) {
      correctCount += 1;
    } else {
      incorrect = true;
    }
  }

  const score =
    interaction.slots.length === 0
      ? 0
      : correctCount / interaction.slots.length;

  const errorCodes: string[] = [];
  if (incorrect) errorCodes.push("slot_incorrect");
  if (unfilled) errorCodes.push("slot_unfilled");

  return { correct: score >= 1, score, errorCodes };
}

interface BranchingDecision {
  stage: "diagnosis" | "action" | "remediation" | "verification";
  correct: boolean;
}

function scoreBranching(
  interaction: BranchingInteraction,
  canonical:
    | Extract<CanonicalAnswer, { type: "troubleshooting" }>
    | Extract<CanonicalAnswer, { type: "scenario_choice_chain" }>,
  path: string[],
  prefix: string,
): Outcome {
  const stepIds = new Set(interaction.steps.map((step) => step.id));
  if (!stepIds.has(interaction.start_step_id)) {
    throw new ScoringError("invalid_scenario_path");
  }

  const decisions: BranchingDecision[] = [];
  let current = interaction.start_step_id;

  for (let index = 0; index < path.length; index += 1) {
    const choiceId = path[index];
    const step = interaction.steps.find((entry) => entry.id === current);
    if (!step) throw new ScoringError("invalid_scenario_path");
    if (!step.choices.some((choice) => choice.id === choiceId)) {
      throw new ScoringError("invalid_scenario_path");
    }

    const correctIds = canonical.correct_choice_ids[step.id];
    const correct = correctIds?.includes(choiceId) ?? false;
    decisions.push({ stage: step.stage, correct });

    const next = step.next_step_by_choice[choiceId];
    if (next !== undefined) {
      current = next;
    } else if (index + 1 !== path.length) {
      throw new ScoringError("invalid_scenario_path");
    }
  }

  const hits = decisions.filter((decision) => decision.correct).length;
  const wrong = decisions.length - hits;
  const denominator = Math.max(canonical.expected_path.length, 1);
  const score = clamp((hits - wrong) / denominator, 0, 1);

  const errorCodes: string[] = [];
  const push = (code: string): void => {
    if (!errorCodes.includes(code)) errorCodes.push(code);
  };
  for (const decision of decisions) {
    if (decision.correct) continue;
    const suffix = {
      diagnosis: "wrong_diagnosis",
      action: "wrong_next_action",
      remediation: "wrong_remediation",
      verification: "wrong_verification",
    }[decision.stage];
    push(`${prefix}_${suffix}`);
  }
  if (path.length < canonical.expected_path.length) {
    push(`${prefix}_incomplete_path`);
  }

  return { correct: score >= 1, score, errorCodes };
}

function scoreConfiguration(
  interaction: ConfigurationInteraction,
  canonical: Extract<CanonicalAnswer, { type: "configuration_builder" }>,
  assignments: Record<string, string>,
): Outcome {
  const slotIds = new Set(interaction.slots.map((slot) => slot.id));
  const pieceIds = new Set(interaction.pieces.map((piece) => piece.id));

  for (const [slotId, pieceId] of Object.entries(assignments)) {
    if (!slotIds.has(slotId)) throw new ScoringError("unknown_slot");
    if (!pieceIds.has(pieceId)) throw new ScoringError("unknown_piece");
  }

  const required = new Set(Object.values(canonical.assignments));
  let correct = 0;
  let missing = false;
  let wrongAssignment = false;
  let unnecessary = false;

  for (const [slotId, expectedPiece] of Object.entries(canonical.assignments)) {
    const piece = assignments[slotId];
    if (piece === undefined) {
      missing = true;
    } else if (piece === expectedPiece) {
      correct += 1;
    } else if (required.has(piece)) {
      wrongAssignment = true;
    } else {
      unnecessary = true;
    }
  }

  const denominator = Math.max(
    Object.keys(canonical.assignments).length,
    1,
  );
  const penalty = unnecessary ? 1 : 0;
  const score = clamp((correct - penalty) / denominator, 0, 1);

  const errorCodes: string[] = [];
  if (missing) errorCodes.push("config_missing_required");
  if (wrongAssignment) errorCodes.push("config_wrong_assignment");
  if (unnecessary) errorCodes.push("config_unnecessary_component");

  return { correct: score >= 1, score, errorCodes };
}

function scorePlacement(
  interaction: PlacementInteraction,
  canonical: Extract<CanonicalAnswer, { type: "two_dimensional_placement" }>,
  points: Record<string, PlacementPoint>,
): Outcome {
  const itemIds = new Set(interaction.items.map((item) => item.id));

  for (const [itemId, point] of Object.entries(points)) {
    if (!itemIds.has(itemId)) throw new ScoringError("unknown_item");
    if (
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      throw new ScoringError("invalid_placement");
    }
  }

  let correctAxes = 0;
  let wrongX = false;
  let wrongY = false;
  let missing = false;

  for (const item of interaction.items) {
    const point = points[item.id];
    if (!point) {
      missing = true;
      continue;
    }
    const region = canonical.regions[item.id];
    if (!region) interactionMismatch();

    const xOk =
      region.x.length === 2 && point.x >= region.x[0] && point.x <= region.x[1];
    const yOk =
      region.y.length === 2 && point.y >= region.y[0] && point.y <= region.y[1];
    if (xOk) correctAxes += 1;
    else wrongX = true;
    if (yOk) correctAxes += 1;
    else wrongY = true;
  }

  const totalAxes = interaction.items.length * 2;
  const score = totalAxes === 0 ? 0 : correctAxes / totalAxes;

  const errorCodes: string[] = [];
  if (missing) errorCodes.push("placement_missing");
  if (wrongX) errorCodes.push("placement_wrong_x");
  if (wrongY) errorCodes.push("placement_wrong_y");

  return { correct: score >= 1, score, errorCodes };
}

function scoreCommandAssembly(
  interaction: CommandInteraction,
  canonical: Extract<CanonicalAnswer, { type: "command_assembly" }>,
  values: Record<string, string>,
): Outcome {
  const slotIds = new Set(interaction.slots.map((slot) => slot.id));
  const tokenIds = new Set(interaction.tokens.map((token) => token.id));

  for (const [slotId, tokenId] of Object.entries(values)) {
    if (!slotIds.has(slotId)) throw new ScoringError("unknown_slot");
    if (!tokenIds.has(tokenId)) throw new ScoringError("unknown_token");
  }

  const required = new Set(Object.values(canonical.values));
  let correct = 0;
  let missing = false;
  let orderWrong = false;
  let tokenWrong = false;

  for (const slot of interaction.slots) {
    const token = values[slot.id];
    if (token === undefined) {
      missing = true;
    } else if (canonical.values[slot.id] === token) {
      correct += 1;
    } else if (required.has(token)) {
      orderWrong = true;
    } else {
      tokenWrong = true;
    }
  }

  const score =
    interaction.slots.length === 0
      ? 0
      : correct / interaction.slots.length;

  const errorCodes: string[] = [];
  if (missing) errorCodes.push("command_token_missing");
  if (orderWrong) errorCodes.push("command_order_wrong");
  if (tokenWrong) errorCodes.push("command_token_wrong");

  return { correct: score >= 1, score, errorCodes };
}

function scoreTypedFillBlank(
  interaction: TypedInteraction,
  canonical: Extract<CanonicalAnswer, { type: "typed_fill_blank" }>,
  values: Record<string, string>,
): Outcome {
  const slotIds = new Set(interaction.slots.map((slot) => slot.id));
  for (const slotId of Object.keys(values)) {
    if (!slotIds.has(slotId)) throw new ScoringError("unknown_slot");
  }

  let correctCount = 0;
  let incorrect = false;
  let incomplete = false;

  for (const slot of interaction.slots) {
    const normalized = normalizeTypedAnswer(values[slot.id] ?? "");
    if (normalized.length === 0) {
      incomplete = true;
      continue;
    }

    const answer = canonical.answers[slot.id];
    if (!answer) interactionMismatch();

    if (
      answer.accepted_answers.some(
        (accepted) => normalizeTypedAnswer(accepted) === normalized,
      )
    ) {
      correctCount += 1;
    } else {
      incorrect = true;
    }
  }

  const score =
    interaction.slots.length === 0
      ? 0
      : correctCount / interaction.slots.length;

  const errorCodes: string[] = [];
  if (incorrect) errorCodes.push("typed_fill_blank_incorrect");
  if (incomplete) errorCodes.push("typed_fill_blank_incomplete");

  return { correct: score >= 1, score, errorCodes };
}

function scoreMultipleChoice(
  interaction: MultipleChoiceInteraction,
  canonical: Extract<CanonicalAnswer, { type: "multiple_choice" }>,
  choiceId: string,
): Outcome {
  const available = new Set(interaction.choices.map((choice) => choice.id));
  if (!available.has(choiceId)) {
    throw new ScoringError("unknown_choice");
  }

  const correct = choiceId === canonical.choice_id;
  return {
    correct,
    score: correct ? 1 : 0,
    errorCodes: correct ? [] : ["multiple_choice_incorrect"],
  };
}

function scoreMultipleResponse(
  interaction: MultipleResponseInteraction,
  canonical: Extract<CanonicalAnswer, { type: "multiple_response" }>,
  choiceIds: string[],
): Outcome {
  const available = new Set(interaction.choices.map((choice) => choice.id));
  for (const choiceId of choiceIds) {
    if (!available.has(choiceId)) {
      throw new ScoringError("unknown_choice");
    }
  }

  const submitted = new Set<string>();
  for (const choiceId of choiceIds) {
    if (submitted.has(choiceId)) {
      throw new ScoringError("duplicate_choice");
    }
    submitted.add(choiceId);
  }

  const canonicalSet = new Set(canonical.choice_ids);
  const correct =
    submitted.size === canonicalSet.size &&
    [...submitted].every((choiceId) => canonicalSet.has(choiceId));

  const errorCodes: string[] = [];
  if (!correct) {
    if (submitted.size < canonicalSet.size) {
      errorCodes.push("multiple_response_incomplete");
    }
    if (submitted.size > canonicalSet.size) {
      errorCodes.push("multiple_response_extra");
    }
    if (submitted.size === canonicalSet.size) {
      errorCodes.push("multiple_response_incorrect");
    }
  }

  return { correct, score: correct ? 1 : 0, errorCodes };
}

/**
 * Scores a browser-executed Python attempt from its reported test counts.
 *
 * Mirrors the Rust scorer: execution happens client-side, so the server can
 * validate the shape and total but cannot re-run the learner's program. The
 * reported total must match the authored test count.
 */
function scorePythonCode(
  canonical: Extract<CanonicalAnswer, { type: "python_code" }>,
  passed: number,
  total: number,
): Outcome {
  const expected = canonical.tests.length;
  if (total !== expected) {
    throw new ScoringError("python_test_count_mismatch");
  }
  if (passed < 0 || passed > total) {
    throw new ScoringError("python_result_invalid");
  }

  const score = expected === 0 ? 0 : passed / expected;
  const correct = expected > 0 && passed === expected;
  const errorCodes = correct ? [] : ["python_tests_failed"];

  return { correct, score, errorCodes };
}
