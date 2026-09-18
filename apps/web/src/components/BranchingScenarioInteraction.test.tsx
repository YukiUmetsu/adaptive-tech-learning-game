import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ScenarioStep } from "../api/types";
import BranchingScenarioInteraction from "./BranchingScenarioInteraction";

const steps: ScenarioStep[] = [
  {
    id: "start",
    prompt: "What do you inspect first?",
    stage: "diagnosis",
    choices: [
      { id: "a", label: "Target health" },
      { id: "b", label: "RDS metrics" },
    ],
    next_step_by_choice: { a: "next", b: "next" },
  },
  {
    id: "next",
    prompt: "What is the next action?",
    stage: "remediation",
    choices: [{ id: "c", label: "Fix the health path" }],
    next_step_by_choice: {},
  },
];

describe("BranchingScenarioInteraction", () => {
  it("records a decision and advances the step", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BranchingScenarioInteraction
        startStepId="start"
        steps={steps}
        value={[]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("What do you inspect first?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Target health" }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("shows the terminal message once the path is complete", () => {
    render(
      <BranchingScenarioInteraction
        startStepId="start"
        steps={steps}
        value={["a", "c"]}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByText(/The scenario has ended/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix the health path" })).toBeNull();
  });

  it("supports going back and restarting", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <BranchingScenarioInteraction
        startStepId="start"
        steps={steps}
        value={["a"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onChange).toHaveBeenCalledWith([]);

    rerender(
      <BranchingScenarioInteraction
        startStepId="start"
        steps={steps}
        value={["a", "c"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Restart" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("disables back and restart when there is no path", () => {
    render(
      <BranchingScenarioInteraction
        startStepId="start"
        steps={steps}
        value={[]}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeDisabled();
  });
});
