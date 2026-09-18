import { useMemo } from "react";

import type { ScenarioStep } from "../api/types";

interface BranchingScenarioInteractionProps {
  startStepId: string;
  steps: ScenarioStep[];
  value: string[];
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
 */
export default function BranchingScenarioInteraction({
  startStepId,
  steps,
  value,
  disabled = false,
  onChange,
}: BranchingScenarioInteractionProps) {
  const { labelById, stepIndex } = useMemo(() => {
    const labels = new Map<string, string>();
    const index = new Map<string, ScenarioStep>();
    for (const step of steps) {
      index.set(step.id, step);
      for (const choice of step.choices) {
        labels.set(choice.id, choice.label);
      }
    }
    return { labelById: labels, stepIndex: index };
  }, [steps]);

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
        <section className="branching-step" aria-label={currentStep.prompt}>
          <p className="branching-prompt">{currentStep.prompt}</p>
          <ul className="item-list">
            {currentStep.choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="item-chip"
                  disabled={disabled}
                  onClick={() => onChange([...value, choice.id])}
                >
                  {choice.label}
                </button>
              </li>
            ))}
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
