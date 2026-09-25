import { useMemo } from "react";

import type { ScenarioStep } from "../api/types";
import { stripInlineCode } from "../lib/inlineCode";
import { shuffledChoices } from "../lib/shuffle";
import InlineText from "./InlineText";

interface BranchingScenarioInteractionProps {
  startStepId: string;
  steps: ScenarioStep[];
  value: string[];
  /**
   * Stable seed (usually the question id) that varies the displayed choice
   * order between questions. Each step mixes it with its own step id.
   */
  seed?: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/**
 * Navigate a deterministic branching scenario one authored step at a time.
 *
 * The component is fully controlled: the answer value is the ordered list of
 * chosen ids, and the current step is replayed from that path. Every choice is a
 * normal button, so the scenario works with tap, click, and keyboard. Used by
 * both `troubleshooting` and `scenario_choice_chain`.
 *
 * Choices are authored with the correct decision listed first, which is why the
 * display order is shuffled (scoring stays keyed by choice id). The authored
 * first option is never rendered first, so the decision cannot be guessed from
 * position.
 */
export default function BranchingScenarioInteraction({
  startStepId,
  steps,
  value,
  seed = "",
  disabled = false,
  onChange,
}: BranchingScenarioInteractionProps) {
  const { labelById, stepIndex, choicesByStepId } = useMemo(() => {
    const labels = new Map<string, string>();
    const index = new Map<string, ScenarioStep>();
    const choices = new Map<string, ScenarioStep["choices"]>();
    for (const step of steps) {
      index.set(step.id, step);
      choices.set(step.id, shuffledChoices(step.choices, `${seed}:${step.id}`));
      for (const choice of step.choices) {
        labels.set(choice.id, choice.label);
      }
    }
    return { labelById: labels, stepIndex: index, choicesByStepId: choices };
  }, [steps, seed]);

  const currentStep = (() => {
    let current = startStepId;
    for (const choiceId of value) {
      const step = stepIndex.get(current);
      if (!step) {
        return null;
      }
      const next = step.next_step_by_choice[choiceId];
      if (!next) {
        return null;
      }
      current = next;
    }
    return stepIndex.get(current) ?? null;
  })();

  return (
    <div className="branching">
      <ol className="branching-path" aria-label="Decisions so far">
        {value.length === 0 ? (
          <li className="muted">No decisions yet.</li>
        ) : (
          value.map((choiceId, index) => (
            <li key={`${choiceId}-${index}`}>
              <span className="branching-step-index">{index + 1}</span>
              <span>{labelById.get(choiceId) ?? choiceId}</span>
            </li>
          ))
        )}
      </ol>

      {currentStep ? (
        <section
          className="branching-step"
          aria-label={stripInlineCode(currentStep.prompt)}
        >
          <p className="branching-prompt">
            <InlineText text={currentStep.prompt} />
          </p>
          <ul className="item-list">
            {(choicesByStepId.get(currentStep.id) ?? currentStep.choices).map(
              (choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    className="item-chip"
                    disabled={disabled}
                    onClick={() => onChange([...value, choice.id])}
                  >
                    <InlineText text={choice.label} terms={[]} />
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : (
        <p className="branching-complete" role="status">
          The scenario has ended. Submit your decisions, or go back to change
          them.
        </p>
      )}

      <div className="branching-controls">
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={() => onChange(value.slice(0, -1))}
        >
          Back
        </button>
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
